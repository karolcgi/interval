// v0.7: activity presets and the weekly template, against real SQLite (sql.js).
import { describe, expect, it } from "vitest";
import { memoryDisk, t, testDb } from "../test/helpers";
import { store } from "./store";
import * as A from "./actions";
import * as L from "./library";
import * as repo from "../db/repo";
import { exportJson, importJson } from "../db/io";
import { computeStats } from "../domain/stats";
import { addDays, dayKey, MINUTE, startOfDay } from "../domain/time";
import { fromRefInterval, refDay, suggestionsForDay, templateTotals, toRefBlock, weekdayOf, REF_WEEK } from "../domain/weekTemplate";
import type { SqlJsDriver } from "../db/sqljs-driver";

async function boot(db: SqlJsDriver, now = t(2026, 11, 25, 8)) {
  store.reset();
  A.clearHistory();
  store.set({ db, date: startOfDay(now), ready: true });
  await A.reloadMeta();
  await A.refresh();
}
const catId = (name: string) => store.get().categories.find((c) => c.name === name)!.id;
const WED = t(2026, 12, 2); // a future Wednesday
const goTo = async (day: number) => (store.set({ date: startOfDay(day) }), A.refresh());

describe("weekly template domain", () => {
  it("maps weekdays Monday-first and round-trips the reference week", () => {
    expect(weekdayOf(t(2026, 11, 25))).toBe(2); // Wednesday
    expect(weekdayOf(t(2026, 11, 29))).toBe(6); // Sunday
    expect(REF_WEEK.map(weekdayOf)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const b = toRefBlock({ id: "x", weekday: 2, startMinute: 900, durationMinutes: 90, categoryId: "c", title: null, notes: null, tagIds: [], presetId: null, createdAt: 0, updatedAt: 0 });
    expect(fromRefInterval({ start: b.startAt, end: b.endAt })).toEqual({ weekday: 2, startMinute: 900, durationMinutes: 90 });
    // clipped at midnight
    expect(fromRefInterval({ start: refDay(1) + 23 * 60 * MINUTE, end: refDay(2) + 60 * MINUTE }).durationMinutes).toBe(60);
  });

  it("suggests on matching weekdays, not on past days, and hides confirmed and dismissed ones", () => {
    const tb = { id: "w", weekday: 2, startMinute: 900, durationMinutes: 90, categoryId: "c", title: "H", notes: null, tagIds: [], presetId: null, createdAt: 0, updatedAt: 0 };
    const now = t(2026, 11, 25, 8);
    expect(suggestionsForDay(WED, [tb], [], new Set(), { now, includePast: false }).visible).toHaveLength(1);
    expect(suggestionsForDay(addDays(WED, 1), [tb], [], new Set(), { now, includePast: false }).visible).toHaveLength(0);
    expect(suggestionsForDay(t(2026, 11, 18), [tb], [], new Set(), { now, includePast: false }).visible).toHaveLength(0);
    expect(suggestionsForDay(t(2026, 11, 18), [tb], [], new Set(), { now, includePast: true }).visible).toHaveLength(1);
    const s = suggestionsForDay(WED, [tb], [], new Set(), { now, includePast: false }).visible[0];
    expect(s.startAt).toBe(t(2026, 12, 2, 15));
    expect(s.endAt).toBe(t(2026, 12, 2, 16, 30));
    const linked = A.newBlock({ start: t(2026, 12, 2, 17), end: t(2026, 12, 2, 18, 30) }, "c", { templateBlockId: "w" });
    expect(suggestionsForDay(WED, [tb], [linked], new Set(), { now, includePast: false }).confirmed).toHaveLength(1);
    expect(suggestionsForDay(WED, [tb], [], new Set([`${dayKey(WED)}|w`]), { now, includePast: false }).dismissed).toHaveLength(1);
    expect(templateTotals([tb, { ...tb, id: "v", weekday: 4 }]).byDay).toEqual([0, 0, 90, 0, 90, 0, 0]);
  });
});

describe("activity presets and weekly template", () => {
  it("presets: create, drop onto a day as an independent copy, persist (acceptance 2–4, 12)", async () => {
    const disk = memoryDisk();
    const db = await testDb(disk);
    await boot(db);
    const tag = await A.ensureTag("Houdini");
    const p = await L.savePreset(L.newPreset({ name: "Houdini studying", categoryId: catId("Studying"), durationMinutes: 90, tagIds: [tag.id] }));
    await L.dropPresetOnDay(p.id, t(2026, 11, 25, 15));
    const b = store.get().blocks.find((x) => x.presetId === p.id)!;
    expect([b.startAt, b.endAt, b.title, b.categoryId, b.tagIds]).toEqual([t(2026, 11, 25, 15), t(2026, 11, 25, 16, 30), "Houdini studying", catId("Studying"), [tag.id]]);
    expect(store.get().running).toBeNull(); // never starts a timer
    // editing either side never changes the other
    await A.updateBlock(b.id, { endAt: t(2026, 11, 25, 17), tagIds: [] });
    expect(store.get().presets[0].durationMinutes).toBe(90);
    expect(store.get().presets[0].tagIds).toEqual([tag.id]);
    await L.savePreset({ ...store.get().presets[0], name: "Houdini", durationMinutes: 60 });
    expect(store.get().blocks.find((x) => x.id === b.id)!.title).toBe("Houdini studying");
    await expect(L.savePreset(L.newPreset({ name: " " }))).rejects.toThrow(/name/);
    await db.close();
    const db2 = await testDb(disk);
    await boot(db2);
    expect(store.get().presets.map((x) => x.name)).toEqual(["Houdini"]);
    expect(store.get().blocks.find((x) => x.id === b.id)?.presetId).toBe(p.id);
  });

  it("reorders, duplicates, favourites and saves a block as a preset", async () => {
    await boot(await testDb());
    const a = await L.savePreset(L.newPreset({ name: "A", categoryId: catId("Studying") }));
    const b = await L.savePreset(L.newPreset({ name: "B", categoryId: catId("Studying") }));
    const c = await L.savePreset(L.newPreset({ name: "C", categoryId: catId("Studying") }));
    await L.movePreset(c.id, a.id);
    expect(store.get().presets.map((x) => x.name)).toEqual(["C", "A", "B"]);
    await L.duplicatePreset(a.id);
    expect(store.get().presets.map((x) => x.name)).toEqual(["C", "A", "A copy", "B"]);
    await L.toggleFavorite(b.id);
    expect(store.get().presets.find((x) => x.id === b.id)!.favorite).toBe(true);
    const blk = await A.createBlock({ start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 11) }, catId("Freelance work"), { title: "Client cut" });
    const saved = await L.saveBlockAsPreset(blk);
    expect([saved.name, saved.durationMinutes, saved.categoryId]).toEqual(["Client cut", 120, catId("Freelance work")]);
    await L.deletePreset(a.id);
    expect(store.get().presets.some((x) => x.id === a.id)).toBe(false);
  });

  it("template: suggestions, confirm, move, apply without duplicates, dismiss; stats untouched (acceptance 5–11)", async () => {
    const db = await testDb();
    await boot(db);
    const p = await L.savePreset(L.newPreset({ name: "Houdini studying", categoryId: catId("Studying"), durationMinutes: 90 }));
    await L.dropPresetOnTemplate(p.id, refDay(2) + 15 * 60 * MINUTE);
    await L.createTemplateBlock({ start: refDay(2) + 9 * 60 * MINUTE, end: refDay(2) + 11 * 60 * MINUTE }, catId("Freelance work"), { title: "Client production" });
    expect(store.get().weekTemplate.map((x) => [x.weekday, x.startMinute, x.durationMinutes])).toEqual([[2, 540, 120], [2, 900, 90]]);

    await goTo(WED);
    expect(L.daySuggestions(WED).visible).toHaveLength(2);
    // 11: suggestions add nothing to planned or recorded time
    const before = computeStats({ sessions: store.get().sessions, blocks: store.get().blocks, categories: store.get().categories, range: { start: WED, end: addDays(WED, 1) }, now: t(2026, 11, 25, 8) });
    expect([before.plannedMs, before.recordedMs]).toEqual([0, 0]);

    // 7: confirm one
    const tbH = store.get().weekTemplate.find((x) => x.startMinute === 900)!;
    const confirmed = (await L.confirmSuggestion(tbH.id, WED))!;
    expect(confirmed.templateBlockId).toBe(tbH.id);
    expect(L.daySuggestions(WED).visible.map((s) => s.tb.id)).not.toContain(tbH.id);
    // 8: move it, template unchanged and suggestion still hidden
    await A.updateBlock(confirmed.id, { startAt: t(2026, 12, 2, 17), endAt: t(2026, 12, 2, 18, 30) }, "Move block");
    expect(store.get().weekTemplate.find((x) => x.id === tbH.id)!.startMinute).toBe(900);
    expect(L.daySuggestions(WED).visible).toHaveLength(1);
    // 9: apply twice, no duplicates
    await L.applyDayTemplate(WED);
    await L.applyDayTemplate(WED);
    expect(store.get().blocks.filter((b) => b.templateBlockId)).toHaveLength(2);
    // template edits affect future suggestions, not confirmed blocks
    await L.updateTemplateBlock(tbH.id, { title: "Renamed" });
    expect(store.get().blocks.find((b) => b.id === confirmed.id)!.title).toBe("Houdini studying");

    // conflicts: skip by default, keep when asked
    const WED2 = addDays(WED, 7);
    await goTo(WED2);
    await A.createBlock({ start: t(2026, 12, 9, 15, 30), end: t(2026, 12, 9, 16, 30) }, catId("Administration"));
    expect(L.applyPlan(WED2).conflicts).toHaveLength(1);
    await L.applyDayTemplate(WED2);
    expect(store.get().blocks.filter((b) => b.templateBlockId)).toHaveLength(1);
    await L.applyDayTemplate(WED2, [tbH.id]);
    expect(store.get().blocks.filter((b) => b.templateBlockId)).toHaveLength(2);

    // 10: dismiss one date only, restore
    const WED3 = addDays(WED, 14);
    await goTo(WED3);
    await L.dismissSuggestion(tbH.id, WED3);
    expect(L.daySuggestions(WED3).visible).toHaveLength(1);
    expect(L.daySuggestions(WED3).dismissed).toHaveLength(1);
    await goTo(addDays(WED3, 7));
    expect(L.daySuggestions(addDays(WED3, 7)).visible).toHaveLength(2);
    await goTo(WED3);
    await L.restoreSuggestions(WED3);
    expect(L.daySuggestions(WED3).visible).toHaveLength(2);

    // undo / redo of template edits
    await L.deleteTemplateBlocks([tbH.id]);
    expect(store.get().weekTemplate).toHaveLength(1);
    await A.undo();
    expect(store.get().weekTemplate).toHaveLength(2);
    await A.redo();
    expect(store.get().weekTemplate).toHaveLength(1);
  });

  it("copies a day, imports a day template, and round-trips through JSON export", async () => {
    const db = await testDb();
    await boot(db);
    await L.createTemplateBlock({ start: refDay(0) + 9 * 60 * MINUTE, end: refDay(0) + 12 * 60 * MINUTE }, catId("Freelance work"));
    await L.copyTemplateDay(0, [1, 2, 3, 4], true);
    expect(templateTotals(store.get().weekTemplate).byDay).toEqual([180, 180, 180, 180, 180, 0, 0]);
    await L.copyTemplateDay(0, [1], true); // replace: still one block on Tuesday
    expect(store.get().weekTemplate.filter((x) => x.weekday === 1)).toHaveLength(1);
    await db.batch(repo.upsertTemplateStmts({ id: "d", name: "Light day", sortOrder: 0, createdAt: 0, blocks: [{ id: "b1", startMinute: 600, durationMinutes: 60, categoryId: catId("Studying"), title: null, tagIds: [] }] }));
    await A.reloadMeta();
    await L.importDayTemplate("d", 5);
    expect(store.get().weekTemplate.filter((x) => x.weekday === 5).map((x) => x.startMinute)).toEqual([600]);
    await L.savePreset(L.newPreset({ name: "P", categoryId: catId("Studying") }));
    await goTo(t(2026, 11, 30));
    await L.dismissSuggestion(store.get().weekTemplate.find((x) => x.weekday === 0)!.id, t(2026, 11, 30));

    const bundle = await exportJson(db);
    const db2 = await testDb();
    await importJson(db2, JSON.parse(JSON.stringify(bundle)));
    expect(await repo.listWeekTemplate(db2)).toHaveLength(6);
    expect(await repo.listPresets(db2)).toHaveLength(1);
    expect(await repo.listDismissals(db2)).toHaveLength(1);
  });
});
