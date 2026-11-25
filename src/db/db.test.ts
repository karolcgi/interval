// Integration tests: real SQLite (sql.js) + the same actions the UI calls.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDisk, t, testDb } from "../test/helpers";
import { SqlJsDriver } from "./sqljs-driver";
import { LATEST_VERSION, migrate } from "./migrations";
import * as repo from "./repo";
import { exportCsv, exportJson, importCsv, importJson } from "./io";
import { generateDemoData } from "./fixtures";
import { store } from "../state/store";
import * as A from "../state/actions";
import * as P from "../state/planning";
import * as F from "../state/focus";
import { budgetHistory, budgetProgress, periodRange } from "../domain/budgets";
import { computeStats } from "../domain/stats";
import { resolveRange, startOfDay, HOUR, MINUTE } from "../domain/time";

async function boot(db: SqlJsDriver, now = t(2026, 11, 25, 8)) {
  store.reset();
  A.clearHistory();
  store.set({ db, date: startOfDay(now), ready: true });
  await A.reloadMeta();
  await A.refresh();
}
const catId = (name: string) => store.get().categories.find((c) => c.name === name)!.id;

describe("schema & persistence", () => {
  it("migrates once and is idempotent", async () => {
    const db = await testDb();
    expect(await migrate(db)).toEqual({ from: LATEST_VERSION, to: LATEST_VERSION });
    const cats = await repo.listCategories(db);
    expect(cats.map((c) => c.name)).toEqual(["Freelance work", "Studying", "Personal art", "Creative research", "Asset development", "Administration", "Personal time", "Breaks"]);
    expect(await repo.seedDefaults(db)).toBe(false);
  });

  it("survives closing and reopening (acceptance #12)", async () => {
    const disk = memoryDisk();
    const db1 = await testDb(disk);
    await boot(db1);
    await A.createBlock({ start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 11, 30) }, catId("Freelance work"));
    await db1.close();

    const db2 = await testDb(disk);
    const blocks = await repo.listBlocks(db2, t(2026, 11, 25), t(2026, 11, 26));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].endAt - blocks[0].startAt).toBe(150 * MINUTE);
  });

  it("enforces a single running session at the database level", async () => {
    const db = await testDb();
    const cid = (await repo.listCategories(db))[0].id;
    const mk = (id: string) => ({ id, startAt: Date.now(), endAt: null, tz: "UTC", categoryId: cid, blockId: null, title: null, notes: null, mode: "stopwatch" as const, tagIds: [], createdAt: 0, updatedAt: 0 });
    await db.batch(repo.upsertSessionStmts(mk("a")));
    await expect(db.batch(repo.upsertSessionStmts(mk("b")))).rejects.toThrow();
    expect(await repo.listAllSessions(db)).toHaveLength(1); // batch rolled back atomically
  });

  it("rejects blocks with end before start", async () => {
    const db = await testDb();
    await boot(db);
    const b = A.newBlock({ start: t(2026, 11, 25, 10), end: t(2026, 11, 25, 9) }, catId("Studying"));
    await expect(db.batch(repo.upsertBlockStmts(b))).rejects.toThrow();
  });
});

describe("calendar actions with undo/redo", () => {
  let db: SqlJsDriver;
  beforeEach(async () => {
    db = await testDb();
    await boot(db);
  });

  it("create, move, resize, undo, redo", async () => {
    const b = await A.createBlock({ start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 10) }, catId("Studying"));
    await A.updateBlock(b.id, { startAt: t(2026, 11, 25, 14), endAt: t(2026, 11, 25, 15) }, "Move block");
    await A.updateBlock(b.id, { endAt: t(2026, 11, 25, 15, 30) }, "Resize block");
    expect(store.get().blocks[0].endAt).toBe(t(2026, 11, 25, 15, 30));
    await A.undo();
    expect(store.get().blocks[0].endAt).toBe(t(2026, 11, 25, 15));
    await A.undo();
    expect(store.get().blocks[0].startAt).toBe(t(2026, 11, 25, 9));
    await A.undo();
    expect(store.get().blocks).toHaveLength(0);
    await A.redo();
    await A.redo();
    expect(store.get().blocks[0].startAt).toBe(t(2026, 11, 25, 14));
  });

  it("split and merge are inverse and undoable", async () => {
    const b = await A.createBlock({ start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 11) }, catId("Freelance work"));
    await A.splitBlock(b.id);
    expect(store.get().blocks.map((x) => [x.startAt, x.endAt])).toEqual([
      [t(2026, 11, 25, 9), t(2026, 11, 25, 10)],
      [t(2026, 11, 25, 10), t(2026, 11, 25, 11)],
    ]);
    await A.mergeBlock(b.id);
    expect(store.get().blocks).toHaveLength(1);
    expect(store.get().blocks[0].endAt).toBe(t(2026, 11, 25, 11));
    await A.undo();
    expect(store.get().blocks).toHaveLength(2);
  });

  it("duplicate, copy/paste to another day", async () => {
    const b = await A.createBlock({ start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 10) }, catId("Studying"), { tagIds: [] });
    await A.duplicateBlock(b.id);
    expect(store.get().blocks.map((x) => x.startAt)).toEqual([t(2026, 11, 25, 9), t(2026, 11, 25, 10)]);
    A.copyBlocks([b.id]);
    await A.pasteBlocks(t(2026, 11, 27));
    const pasted = await repo.listBlocks(db, t(2026, 11, 27), t(2026, 11, 28));
    expect(pasted[0].startAt).toBe(t(2026, 11, 27, 9));
  });

  it("deleting a plan never deletes recorded time, and undo relinks it", async () => {
    const b = await A.createBlock({ start: t(2026, 11, 25, 6), end: t(2026, 11, 25, 7) }, catId("Studying"));
    await A.completeBlockManually(b.id);
    const [s] = await repo.sessionsForBlock(db, b.id);
    expect(s.endAt! - s.startAt).toBe(HOUR);
    await A.deleteBlocks([b.id]);
    expect((await repo.listAllSessions(db))[0].blockId).toBeNull();
    await A.undo();
    expect((await repo.listAllSessions(db))[0].blockId).toBe(b.id);
  });

  it("names blocks inline: rename, clear back to the category name, undo", async () => {
    const b = await A.createBlock({ start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 10) }, catId("Studying"), { title: "Houdini VEX" });
    expect(store.get().blocks[0].title).toBe("Houdini VEX");
    A.startRename({ kind: "block", id: b.id });
    expect(store.get().renaming).toEqual({ kind: "block", id: b.id });
    await A.renameItem({ kind: "block", id: b.id }, "  Pyro sim  ");
    expect(store.get().renaming).toBeNull();
    expect(store.get().blocks[0].title).toBe("Pyro sim");
    await A.renameItem({ kind: "block", id: b.id }, "   ");
    expect(store.get().blocks[0].title).toBeNull();
    const depth = store.get().undoDepth;
    await A.renameItem({ kind: "block", id: b.id }, ""); // unchanged: no history entry
    expect(store.get().undoDepth).toBe(depth);
    await A.undo();
    expect(store.get().blocks[0].title).toBe("Pyro sim");
    const [row] = await repo.listBlocks(store.get().db!, t(2026, 11, 25), t(2026, 11, 26));
    expect(row.title).toBe("Pyro sim");
  });

  it("changing a category updates history-derived stats immediately", async () => {
    const s = await A.createSession({ start: t(2026, 11, 25, 6), end: t(2026, 11, 25, 7) }, catId("Studying"));
    await A.updateSession(s.id, { categoryId: catId("Personal art") }, "Change category");
    const st = computeStats({ sessions: store.get().sessions, blocks: [], categories: store.get().categories, range: { start: t(2026, 11, 25), end: t(2026, 11, 26) }, now: t(2026, 11, 25, 8) });
    expect(st.byCategory.map((c) => c.categoryId)).toEqual([catId("Personal art")]);
  });

  it("archiving a used category keeps its history", async () => {
    const id = catId("Creative research");
    await A.createSession({ start: t(2026, 11, 25, 6), end: t(2026, 11, 25, 7) }, id);
    expect(await A.deleteOrArchiveCategory(id)).toBe("archived");
    expect(store.get().categories.find((c) => c.id === id)!.archivedAt).not.toBeNull();
    expect((await repo.listAllSessions(db))[0].categoryId).toBe(id);
    const unused = catId("Asset development");
    expect(await A.deleteOrArchiveCategory(unused)).toBe("deleted");
  });
});

describe("recurring blocks and templates", () => {
  let db: SqlJsDriver;
  beforeEach(async () => {
    db = await testDb();
    await boot(db, t(2026, 11, 25, 8)); // Wednesday
  });
  const onDay = async (y: number, m: number, d: number) => (await repo.listBlocks(db, t(y, m, d), t(y, m, d + 1)));

  it("materialises weekday occurrences as normal blocks, at the same local time across DST", async () => {
    const b = await A.createBlock({ start: t(2026, 11, 25, 16), end: t(2026, 11, 25, 17) }, catId("Studying"), { title: "Houdini", tagIds: [] });
    await P.repeatFromBlock(b.id, "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    const rule = store.get().rules[0];
    expect(rule.startMinute).toBe(16 * 60);
    expect(await onDay(2026, 11, 28)).toHaveLength(0); // Saturday
    const mon = await onDay(2026, 11, 30);
    expect(mon).toHaveLength(1);
    expect(mon[0]).toMatchObject({ title: "Houdini", recurrenceId: rule.id, status: "planned" });
    expect(new Date(mon[0].startAt).getHours()).toBe(16);
    // navigating further ahead extends the series; a day already generated is never regenerated
    store.set({ date: t(2027, 3, 31) });
    await A.refresh();
    const afterDst = await onDay(2027, 3, 31); // Wednesday after spring-forward
    expect(new Date(afterDst[0].startAt).getHours()).toBe(16);
    expect(afterDst[0].endAt - afterDst[0].startAt).toBe(HOUR);
    await A.refresh();
    expect(await onDay(2027, 3, 31)).toHaveLength(1);
  });

  it("a deleted occurrence stays deleted", async () => {
    const b = await A.createBlock({ start: t(2026, 11, 25, 13), end: t(2026, 11, 25, 14) }, catId("Personal time"), { title: "Lunch" });
    await P.repeatFromBlock(b.id, "FREQ=DAILY");
    const thu = (await onDay(2026, 11, 26))[0];
    store.set({ date: t(2026, 11, 26) });
    await A.refresh();
    await A.deleteBlocks([thu.id]);
    await A.refresh();
    expect(await onDay(2026, 11, 26)).toHaveLength(0);
    expect(await onDay(2026, 11, 27)).toHaveLength(1);
  });

  it("apply to following splits the series; earlier occurrences are untouched", async () => {
    const b = await A.createBlock({ start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 10) }, catId("Studying"));
    await P.repeatFromBlock(b.id, "FREQ=DAILY");
    store.set({ date: t(2026, 11, 27) });
    await A.refresh();
    const fri = store.get().blocks[0];
    await A.updateBlock(fri.id, { startAt: t(2026, 11, 27, 10), endAt: t(2026, 11, 27, 12) });
    const moved = (await onDay(2026, 11, 27))[0];
    expect(P.differsFromRule(moved, P.ruleOf(moved)!)).toBe(true);
    await P.repeatFromBlock(fri.id, null);
    const [oldRule, newRule] = store.get().rules;
    expect(oldRule.endsOn).toBe("2026-11-26");
    expect(newRule.startsOn).toBe("2026-11-27");
    expect(new Date((await onDay(2026, 11, 26))[0].startAt).getHours()).toBe(9);
    const sat = await onDay(2026, 11, 28);
    expect(sat).toHaveLength(1);
    expect(sat[0].recurrenceId).toBe(newRule.id);
    expect(new Date(sat[0].startAt).getHours()).toBe(10);
    expect(sat[0].endAt - sat[0].startAt).toBe(2 * HOUR);
  });

  it("stop repeating keeps recorded and past occurrences, removes later planned ones", async () => {
    const b = await A.createBlock({ start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 10) }, catId("Studying"));
    await P.repeatFromBlock(b.id, "FREQ=DAILY");
    await A.completeBlockManually(b.id);
    store.set({ date: t(2026, 11, 27) });
    await A.refresh();
    const fri = store.get().blocks[0];
    await P.stopRepeating(fri.id);
    expect(await onDay(2026, 11, 25)).toHaveLength(1);
    expect(await onDay(2026, 11, 27)).toHaveLength(1);
    expect(await onDay(2026, 11, 28)).toHaveLength(0);
    store.set({ date: t(2026, 12, 20) });
    await A.refresh();
    expect(await onDay(2026, 12, 20)).toHaveLength(0);
    expect(await repo.listAllSessions(db)).toHaveLength(1);
  });

  it("delete this and following", async () => {
    const b = await A.createBlock({ start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 10) }, catId("Studying"));
    await P.repeatFromBlock(b.id, "FREQ=DAILY");
    const thu = (await onDay(2026, 11, 26))[0];
    await P.deleteFollowing(thu.id);
    expect(await onDay(2026, 11, 25)).toHaveLength(1);
    expect(await onDay(2026, 11, 26)).toHaveLength(0);
    expect(await onDay(2026, 12, 3)).toHaveLength(0);
  });

  it("saves a day as a template and applies it to another day (undoable)", async () => {
    await A.createBlock({ start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 12) }, catId("Freelance work"), { title: "Client" });
    await A.createBlock({ start: t(2026, 11, 25, 13), end: t(2026, 11, 25, 13, 45) }, catId("Personal time"), { title: "Lunch" });
    const tpl = await P.saveDayAsTemplate(t(2026, 11, 25), "Freelance day");
    expect(tpl!.blocks.map((b) => [b.startMinute, b.durationMinutes, b.title])).toEqual([[540, 180, "Client"], [780, 45, "Lunch"]]);
    await P.applyTemplate(tpl!.id, t(2027, 3, 29)); // the Monday after spring-forward
    const applied = await onDay(2027, 3, 29);
    expect(applied.map((b) => [new Date(b.startAt).getHours(), (b.endAt - b.startAt) / MINUTE])).toEqual([[9, 180], [13, 45]]);
    await A.undo();
    expect(await onDay(2027, 3, 29)).toHaveLength(0);
    await P.renameTemplate(tpl!.id, "Client day");
    expect(store.get().templates[0].name).toBe("Client day");
    await P.deleteTemplate(tpl!.id);
    expect(store.get().templates).toHaveLength(0);
  });

  it("rules, templates and budgets survive a JSON round trip", async () => {
    const b = await A.createBlock({ start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 10) }, catId("Studying"));
    await P.repeatFromBlock(b.id, "FREQ=WEEKLY;BYDAY=WE");
    await P.saveDayAsTemplate(t(2026, 11, 25), "Study day");
    const bundle = await exportJson(db);
    const fresh = await testDb(null, false);
    await importJson(fresh, JSON.parse(JSON.stringify(bundle)));
    expect(await repo.listRules(fresh)).toHaveLength(1);
    expect((await repo.listTemplates(fresh))[0].blocks).toHaveLength(1);
  });
});

describe("timer", () => {
  it("start from a planned block, stop, keep plan and actual separately (acceptance #4-7)", async () => {
    vi.useFakeTimers();
    try {
      const db = await testDb();
      vi.setSystemTime(t(2026, 11, 25, 8));
      await boot(db);
      const houdini = await A.ensureTag("Houdini");
      const plan = await A.createBlock({ start: t(2026, 11, 25, 15), end: t(2026, 11, 25, 16, 30) }, catId("Studying"), { tagIds: [houdini.id] });

      vi.setSystemTime(t(2026, 11, 25, 15, 10));
      await A.startTimer({ blockId: plan.id });
      expect(store.get().running?.blockId).toBe(plan.id);
      expect(store.get().blocks[0].status).toBe("in_progress");

      vi.setSystemTime(t(2026, 11, 25, 16, 20));
      await A.stopTimer();
      expect(store.get().running).toBeNull();
      const [s] = await repo.sessionsForBlock(db, plan.id);
      expect(s.endAt! - s.startAt).toBe(70 * MINUTE);
      expect(s.tagIds).toEqual([houdini.id]);
      const b = (await repo.getBlock(db, plan.id))!;
      expect(b.status).toBe("completed");
      expect(b.endAt - b.startAt).toBe(90 * MINUTE); // plan preserved

      const st = computeStats({ sessions: await repo.listAllSessions(db), blocks: await repo.listAllBlocks(db), categories: store.get().categories, range: resolveRange("today", Date.now(), 1), now: Date.now() });
      expect(st.recordedMs).toBe(70 * MINUTE);
      expect(st.plannedMs).toBe(90 * MINUTE);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a running timer survives a crash: it is reloaded from the database", async () => {
    const disk = memoryDisk();
    const db1 = await testDb(disk);
    await boot(db1);
    await A.startTimer({ categoryId: catId("Freelance work") });
    await db1.flush();
    // simulate crash: no stop, open a fresh connection on the same file
    const db2 = await testDb(disk);
    await boot(db2);
    expect(store.get().running?.categoryId).toBe(catId("Freelance work"));
  });

  it("starting a new timer stops the previous one", async () => {
    const db = await testDb();
    await boot(db);
    await A.startTimer({ categoryId: catId("Freelance work") });
    await A.startTimer({ categoryId: catId("Studying") });
    const all = await repo.listAllSessions(db);
    expect(all).toHaveLength(2);
    expect(all.filter((s) => s.endAt === null)).toHaveLength(1);
  });

  it("pause and resume produce separate segments, sleep gaps can be excluded", async () => {
    vi.useFakeTimers();
    try {
      const db = await testDb();
      vi.setSystemTime(t(2026, 11, 25, 9));
      await boot(db);
      await A.startTimer({ categoryId: catId("Studying") });
      vi.setSystemTime(t(2026, 11, 25, 9, 30));
      await A.pauseTimer();
      expect(store.get().paused?.accumulatedMs).toBe(30 * MINUTE);
      vi.setSystemTime(t(2026, 11, 25, 9, 45));
      await A.resumeTimer();
      // the computer sleeps from 10:00 to 11:00
      vi.setSystemTime(t(2026, 11, 25, 11));
      await A.heartbeat(t(2026, 11, 25, 10));
      expect(store.get().sleepGap).toEqual({ sessionId: store.get().running!.id, from: t(2026, 11, 25, 10), to: t(2026, 11, 25, 11) });
      await A.resolveSleepGap("exclude");
      vi.setSystemTime(t(2026, 11, 25, 11, 15));
      await A.stopTimer();
      const total = (await repo.listAllSessions(db)).reduce((a, s) => a + (s.endAt! - s.startAt), 0);
      expect(total).toBe(30 * MINUTE + 15 * MINUTE + 15 * MINUTE); // 9:00-9:30, 9:45-10:00, 11:00-11:15
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Pomodoro and Flowtime", () => {
  const withClock = async (fn: (db: SqlJsDriver) => Promise<void>) => {
    vi.useFakeTimers();
    try {
      const db = await testDb();
      vi.setSystemTime(t(2026, 11, 25, 9));
      await boot(db);
      store.set({ settings: { ...store.get().settings, sounds: false, notifications: false } });
      await fn(db);
    } finally {
      vi.useRealTimers();
    }
  };
  const all = async (db: SqlJsDriver) => (await repo.listAllSessions(db)).sort((a, b) => a.startAt - b.startAt);

  it("pomodoro: 25 min focus, 5 min break recorded as a break, then waits for the next round", () =>
    withClock(async (db) => {
      await F.startPomodoro({ categoryId: catId("Studying"), title: "VEX" }, { focus: 25, brk: 5, long: 15, every: 4 });
      expect(store.get().running?.mode).toBe("pomodoro");
      vi.setSystemTime(t(2026, 11, 25, 9, 25) + 30_000);
      await F.tickFocus();
      expect(store.get().focus?.phase).toBe("break");
      expect(store.get().running?.categoryId).toBe(catId("Breaks"));
      vi.setSystemTime(t(2026, 11, 25, 9, 31));
      await F.tickFocus();
      expect(store.get().focus?.phase).toBe("ready");
      expect(store.get().running).toBeNull();
      const [focus, brk] = await all(db);
      expect([focus.startAt, focus.endAt]).toEqual([t(2026, 11, 25, 9), t(2026, 11, 25, 9, 25)]); // exact, not tick time
      expect([brk.startAt, brk.endAt]).toEqual([t(2026, 11, 25, 9, 25), t(2026, 11, 25, 9, 30)]);
      expect(focus.title).toBe("VEX");
      await F.nextRound();
      expect(store.get().running).toMatchObject({ categoryId: catId("Studying"), title: "VEX", mode: "pomodoro" });
      expect(store.get().focus).toMatchObject({ phase: "focus", round: 1 });
    }));

  it("pomodoro catches up after sleep and gives the long break after every Nth round", () =>
    withClock(async (db) => {
      await F.startPomodoro({ categoryId: catId("Studying") }, { focus: 25, brk: 5, long: 15, every: 1 });
      vi.setSystemTime(t(2026, 11, 25, 11)); // slept through focus end AND break end
      await F.tickFocus();
      expect(store.get().focus?.phase).toBe("ready");
      const [focus, brk] = await all(db);
      expect(focus.endAt).toBe(t(2026, 11, 25, 9, 25));
      expect(brk.endAt! - brk.startAt).toBe(15 * MINUTE);
    }));

  it("pause keeps the remaining time of the round", () =>
    withClock(async () => {
      await F.startPomodoro({ categoryId: catId("Studying") }, { focus: 25, brk: 5, long: 15, every: 4 });
      vi.setSystemTime(t(2026, 11, 25, 9, 10));
      await A.pauseTimer();
      expect(store.get().focus?.pausedRemaining).toBe(15 * MINUTE);
      vi.setSystemTime(t(2026, 11, 25, 10));
      await F.tickFocus(); // paused: nothing happens
      expect(store.get().focus?.phase).toBe("focus");
      await A.resumeTimer();
      expect(store.get().focus?.phaseEnd).toBe(t(2026, 11, 25, 10, 15));
      expect(store.get().running?.mode).toBe("pomodoro");
    }));

  it("flowtime: stop suggests a proportional break; accepting records it and then ends", () =>
    withClock(async (db) => {
      await F.startFlowtime({ categoryId: catId("Personal art") });
      vi.setSystemTime(t(2026, 11, 25, 10, 2));
      await A.stopTimer();
      expect(store.get().focus).toMatchObject({ phase: "suggest", suggestedBreakMin: 10 });
      await F.startSuggestedBreak();
      expect(store.get().running?.categoryId).toBe(catId("Breaks"));
      vi.setSystemTime(t(2026, 11, 25, 10, 13));
      await F.tickFocus();
      expect(store.get().focus).toBeNull();
      expect(store.get().running).toBeNull();
      const [work, brk] = await all(db);
      expect(work.endAt! - work.startAt).toBe(62 * MINUTE);
      expect(work.mode).toBe("flowtime");
      expect(brk.endAt! - brk.startAt).toBe(10 * MINUTE);
    }));

  it("starting an ordinary timer ends a focus cycle", () =>
    withClock(async () => {
      await F.startPomodoro({ categoryId: catId("Studying") });
      await A.startTimer({ categoryId: catId("Freelance work") });
      expect(store.get().focus).toBeNull();
      expect(store.get().running?.mode).toBe("stopwatch");
    }));
});

describe("time budgets", () => {
  it("weekly minimum for a category and tag, with planned time ahead and history", async () => {
    vi.useFakeTimers();
    try {
      const db = await testDb();
      vi.setSystemTime(t(2026, 11, 25, 12)); // Wednesday
      await boot(db);
      const houdini = await A.ensureTag("Houdini");
      const studying = catId("Studying");
      // last week: 3h; this week: 2h recorded (one Houdini), 2h planned later this week
      await A.createSession({ start: t(2026, 11, 17, 9), end: t(2026, 11, 17, 12) }, studying);
      await A.createSession({ start: t(2026, 11, 24, 9), end: t(2026, 11, 24, 10) }, studying, { tagIds: [houdini.id] });
      await A.createSession({ start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 10) }, studying);
      await A.createBlock({ start: t(2026, 11, 27, 9), end: t(2026, 11, 27, 11) }, studying);
      await A.createBlock({ start: t(2026, 11, 28, 9), end: t(2026, 11, 28, 10) }, studying, { status: "skipped" });
      await A.saveBudget({ id: "b1", targetType: "category", targetId: studying, period: "week", minMinutes: 5 * 60, maxMinutes: null, archivedAt: null, createdAt: 0 });
      await A.saveBudget({ id: "b2", targetType: "tag", targetId: houdini.id, period: "week", minMinutes: null, maxMinutes: 30, archivedAt: null, createdAt: 0 });
      const [b1, b2] = store.get().budgets;
      const sessions = await repo.listAllSessions(db);
      const blocks = await repo.listAllBlocks(db);
      const cats = store.get().categories;
      const p1 = budgetProgress(b1, sessions, blocks, cats, Date.now(), 1);
      expect(p1.doneMs).toBe(2 * HOUR);
      expect(p1.plannedAheadMs).toBe(2 * HOUR); // skipped block not counted
      expect(p1.remainingMs).toBe(3 * HOUR);
      expect(p1.status).toBe("behind"); // 2 + 2 < 5
      const p2 = budgetProgress(b2, sessions, blocks, cats, Date.now(), 1);
      expect(p2.doneMs).toBe(HOUR);
      expect(p2.status).toBe("over");
      const hist = budgetHistory(b1, sessions, blocks, cats, Date.now(), 1, 2);
      expect(hist.map((h) => h.doneMs)).toEqual([0, 3 * HOUR]);
      expect(hist.map((h) => h.ok)).toEqual([false, false]);
      await expect(A.saveBudget({ ...b1, minMinutes: null, maxMinutes: null })).rejects.toThrow();
      await A.deleteBudget("b2");
      expect(store.get().budgets).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("period ranges are local and DST-safe", () => {
    const w = periodRange("week", t(2026, 3, 29, 12), 1);
    expect(w.end - w.start).toBe(7 * 24 * HOUR - HOUR); // spring-forward week is 167h
    expect(new Date(periodRange("month", t(2026, 2, 10), 1, -1).start).getMonth()).toBe(0);
    expect(new Date(periodRange("year", t(2026, 6, 1), 1).start).getFullYear()).toBe(2026);
  });
});

describe("import / export (acceptance #13)", () => {
  it("JSON round-trips losslessly into a fresh database", async () => {
    const db = await testDb();
    await boot(db);
    const tag = await A.ensureTag("Houdini");
    await A.createBlock({ start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 11, 30) }, catId("Freelance work"), { title: "Client, \"production\"" });
    await A.createSession({ start: t(2026, 11, 25, 6), end: t(2026, 11, 25, 7) }, catId("Studying"), { tagIds: [tag.id] });
    const bundle = await exportJson(db);

    const fresh = await testDb(null, false);
    await importJson(fresh, JSON.parse(JSON.stringify(bundle)));
    const again = await exportJson(fresh);
    expect(again.blocks).toEqual(bundle.blocks);
    expect(again.sessions).toEqual(bundle.sessions);
    expect(again.categories).toEqual(bundle.categories);
  });

  it("CSV export contains actual and planned rows and re-imports by name", async () => {
    const db = await testDb();
    await boot(db);
    const tag = await A.ensureTag("Houdini");
    await A.createBlock({ start: t(2026, 11, 25, 15), end: t(2026, 11, 25, 16, 30) }, catId("Studying"), { tagIds: [tag.id] });
    await A.createSession({ start: t(2026, 11, 25, 6), end: t(2026, 11, 25, 7, 10) }, catId("Studying"), { tagIds: [tag.id] });
    const csv = await exportCsv(db);
    expect(csv.split("\r\n")[0]).toContain("kind,id,date,start,end,duration_minutes,category");
    expect(csv).toContain("actual");
    expect(csv).toContain(",70,Studying,,Houdini,");

    const fresh = await testDb();
    const res = await importCsv(fresh, csv);
    expect(res).toEqual({ blocks: 1, sessions: 1 });
    const sessions = await repo.listAllSessions(fresh);
    expect(sessions[0].endAt! - sessions[0].startAt).toBe(70 * MINUTE);
    expect((await repo.listTags(fresh)).map((x) => x.name)).toEqual(["Houdini"]);
  });
});

describe("demo fixtures", () => {
  it("generate a realistic, internally consistent history", async () => {
    const db = await testDb();
    await generateDemoData(db, { days: 30, now: t(2026, 11, 25, 12), seed: 7 });
    const sessions = await repo.listAllSessions(db);
    const blocks = await repo.listAllBlocks(db);
    expect(sessions.length).toBeGreaterThan(40);
    expect(blocks.some((b) => b.status === "planned" && b.startAt > t(2026, 11, 25, 12))).toBe(true);
    expect(sessions.every((s) => s.endAt !== null && s.endAt <= t(2026, 11, 25, 12))).toBe(true);
  });
});
