// Obsidian & TaskNotes integration, Phase 2: PLAN blocks from tasks, projects and activities.
import { afterEach, describe, expect, it, vi } from "vitest";
import { t, testDb } from "../test/helpers";
import { store } from "./store";
import * as A from "./actions";
import * as L from "./library";
import * as repo from "../db/repo";
import { startOfDay } from "../domain/time";
import { DEFAULT_INTEGRATION, blockLabel, groupTasks, hexColor, pickCategory, taskMinutes, type ExtTask } from "../domain/integration";
import { refreshIntegration } from "./integration";
import { computeStats } from "../domain/stats";

const MINUTE = 60_000;

function fakeApi(tasks: Record<string, unknown>[]) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url.replace(/^http:\/\/[^/]+/, "")}`);
      const done = init?.body && String(init.body).includes("is-checked\"");
      return new Response(JSON.stringify({ success: true, data: { tasks: done ? [] : tasks } }), { status: 200 });
    }),
  );
  return calls;
}

async function boot(tasks: Partial<typeof DEFAULT_INTEGRATION.tasks> = { categoryField: "taskType" }) {
  const db = await testDb();
  store.reset();
  A.clearHistory();
  store.set({ db, date: startOfDay(t(2026, 11, 27, 8)), ready: true });
  await A.reloadMeta();
  await A.updateSettings({ integration: { ...DEFAULT_INTEGRATION, enabled: true, tasks: { ...DEFAULT_INTEGRATION.tasks, ...tasks } } });
  await A.refresh();
  return db;
}

const houdini = { path: "TaskNotes/Particle lesson.md", title: "Particle lesson", status: "open", timeEstimate: 50, customProperties: { taskType: "Study" } };

describe("PLAN blocks from Obsidian", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pure helpers: category guess, colours, estimates, labels, grouping", () => {
    const cats = [
      { id: "f", name: "Freelance work", isBreak: false, archivedAt: null, parentId: null },
      { id: "s", name: "Studying", isBreak: false, archivedAt: null, parentId: null },
      { id: "b", name: "Breaks", isBreak: true, archivedAt: null, parentId: null },
    ];
    expect(pickCategory(["Studying"], cats)).toBe("s");
    expect(pickCategory([null, "freelance"], cats)).toBe("f");
    expect(pickCategory(["Breaks"], cats)).toBe("f"); // never a break
    expect(pickCategory([], cats)).toBe("f");
    expect(hexColor("d49a72")).toBe("#d49a72");
    expect(hexColor("red")).toBeNull();
    expect(taskMinutes({ timeEstimate: 50 }, 60)).toBe(50);
    expect(taskMinutes({ timeEstimate: 2000 }, 60)).toBe(60);
    expect(blockLabel({ title: null, sourceRef: "a.md", sourceTitle: "Old" }, "Live", "Cat")).toBe("Live");
    expect(blockLabel({ title: null, sourceRef: "a.md", sourceTitle: "Old" }, undefined, "Cat")).toBe("Old");
    expect(blockLabel({ title: "Mine", sourceRef: "a.md", sourceTitle: "Old" }, "Live", "Cat")).toBe("Mine");
    const mk = (group: string | null, projects: string[] = []) => ({ data: { group, projects, status: "open" } as unknown as ExtTask });
    const g = groupTasks([mk("Study"), mk(null), mk("Deep Work"), mk("Study")], "field", (r) => r);
    expect(g.map((x) => [x.key, x.items.length])).toEqual([["Deep Work", 1], ["Study", 2], ["", 1]]);
  });

  it("dropping a task creates a local block (repeatable, undoable) and never writes to TaskNotes", async () => {
    const db = await boot();
    const calls = fakeApi([houdini]);
    await refreshIntegration(t(2026, 11, 27, 8));
    const before = calls.length;
    const item = { kind: "task" as const, ref: houdini.path, label: houdini.title, color: null, minutes: 50 };
    await L.dropItemOnDay(item, t(2026, 11, 27, 9));
    await L.dropItemOnDay(item, t(2026, 11, 27, 14));
    const blocks = await repo.listBlocks(db, t(2026, 11, 27), t(2026, 11, 28));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ sourceKind: "task", sourceRef: houdini.path, sourceTitle: "Particle lesson", title: null, status: "planned" });
    expect(blocks[0].endAt - blocks[0].startAt).toBe(50 * MINUTE);
    expect(store.get().categories.find((c) => c.id === blocks[0].categoryId)?.name).toBe("Studying"); // from taskType "Study"
    expect(calls.length).toBe(before); // no API call at all for a drop
    // Nothing recorded: a PLAN block is not actual time
    const st = computeStats({ sessions: store.get().sessions, blocks: [], categories: store.get().categories, range: { start: t(2026, 11, 27), end: t(2026, 11, 28) }, now: t(2026, 11, 27, 20) });
    expect(st.recordedMs).toBe(0);
    await A.undo();
    expect(await repo.listBlocks(db, t(2026, 11, 27), t(2026, 11, 28))).toHaveLength(1);
  });

  it("renamed in Obsidian: the block follows; renamed here: the override stays; deleted: last title stays", async () => {
    const db = await boot();
    fakeApi([houdini]);
    await refreshIntegration(1000);
    await L.dropItemOnDay({ kind: "task", ref: houdini.path, label: houdini.title, color: null, minutes: 0 }, t(2026, 11, 27, 9));
    await L.dropItemOnDay({ kind: "task", ref: houdini.path, label: houdini.title, color: null, minutes: 0 }, t(2026, 11, 27, 11));
    const [a, b] = await repo.listBlocks(db, t(2026, 11, 27), t(2026, 11, 28));
    await A.updateBlock(b.id, { title: "Sim practice" }, "Rename block");

    fakeApi([{ ...houdini, title: "Particle lesson 2" }]);
    await refreshIntegration(2000);
    const live = store.get().extTasks.find((x) => x.ref === houdini.path)!.title;
    expect(blockLabel((await repo.getBlock(db, a.id))!, live, "x")).toBe("Particle lesson 2");
    expect(blockLabel((await repo.getBlock(db, b.id))!, live, "x")).toBe("Sim practice");

    fakeApi([]); // deleted in Obsidian
    await refreshIntegration(3000);
    const after = (await repo.getBlock(db, a.id))!;
    expect(after.sourceTitle).toBe("Particle lesson 2");
    expect(blockLabel(after, undefined, "x")).toBe("Particle lesson 2");
    expect(store.get().extTasks).toHaveLength(0);
  });

  it("a task moved to another path keeps its blocks when TaskNotes gives a stable uid", async () => {
    const db = await boot();
    fakeApi([{ ...houdini, uid: "u-1" }]);
    await refreshIntegration(1000);
    await L.dropItemOnDay({ kind: "task", ref: houdini.path, label: houdini.title, color: null, minutes: 0 }, t(2026, 11, 27, 9));
    fakeApi([{ ...houdini, uid: "u-1", path: "Archive/Particle lesson.md" }]);
    await refreshIntegration(2000);
    const [blk] = await repo.listBlocks(db, t(2026, 11, 27), t(2026, 11, 28));
    expect(blk.sourceRef).toBe("Archive/Particle lesson.md");
  });

  it("projects and activities drop too; duplicates keep the source", async () => {
    const db = await boot();
    await db.batch([repo.upsertExtItemStmt({ kind: "project", ref: "Projects/Roger AMEX.md", uid: null, title: "Roger AMEX", status: "Active", active: true, data: { ref: "Projects/Roger AMEX.md", title: "Roger AMEX", status: "Active", active: true, cover: null, category: "Freelance", client: "Perception", color: "#d49a72", tags: [] } }, 1)]);
    const { refreshIntegration: _r, ...i } = await import("./integration");
    void _r;
    void i;
    store.set({ extProjects: await repo.listExtItems(db, "project") });
    await L.dropItemOnDay({ kind: "project", ref: "Projects/Roger AMEX.md", label: "Roger AMEX", color: "#d49a72", minutes: 0 }, t(2026, 11, 27, 10));
    const studying = store.get().categories.find((c) => c.name === "Studying")!;
    await L.dropItemOnDay({ kind: "activity", categoryId: studying.id, label: "Studying", color: studying.color, minutes: 0 }, t(2026, 11, 27, 15));
    const blocks = await repo.listBlocks(db, t(2026, 11, 27), t(2026, 11, 28));
    expect(blocks.map((b) => [b.sourceKind ?? null, b.color ?? null])).toEqual([["project", "#d49a72"], [null, null]]);
    expect(blocks[1].categoryId).toBe(studying.id);
    expect(store.get().categories.find((c) => c.id === blocks[0].categoryId)?.name).toBe("Freelance work");
    await A.duplicateBlock(blocks[0].id, 1);
    const tomorrow = await repo.listBlocks(db, t(2026, 11, 28), t(2026, 11, 29));
    expect(tomorrow[0]).toMatchObject({ sourceKind: "project", sourceRef: "Projects/Roger AMEX.md", sourceTitle: "Roger AMEX" });
  });
});
