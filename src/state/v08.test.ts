// v0.8: Lucide icons replace emoji, presets carry their own icon and colour onto blocks, and quick notes
// from the floating timer land in the day log. Against real SQLite (sql.js).
import initSqlJs from "sql.js";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { t, testDb } from "../test/helpers";
import { store } from "./store";
import * as A from "./actions";
import * as L from "./library";
import * as J from "./journal";
import * as P from "./planning";
import * as F from "./focus";
import * as repo from "../db/repo";
import { SqlJsDriver } from "../db/sqljs-driver";
import { MIGRATIONS, migrate } from "../db/migrations";
import { EMOJI_TO_ICON } from "../domain/iconMap";
import { ICON_NAMES } from "../ui/icons";
import { buildDayLog, dayLogMarkdown } from "../domain/daylog";
import { startOfDay } from "../domain/time";

const require = createRequire(import.meta.url);

async function boot(db: SqlJsDriver, now = t(2026, 11, 25, 8)) {
  store.reset();
  A.clearHistory();
  store.set({ db, date: startOfDay(now), ready: true });
  await A.reloadMeta();
  await A.refresh();
}
const catId = (name: string) => store.get().categories.find((c) => c.name === name)!.id;

describe("Lucide icons replace emoji", () => {
  it("every mapped emoji points at an icon in the bundled set", () => {
    const missing = Object.values(EMOJI_TO_ICON).filter((n) => !ICON_NAMES.includes(n));
    expect(missing).toEqual([]);
  });

  it("migration 8 maps category emoji to icons and clears the unused v1 names", async () => {
    const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
    const db = await SqlJsDriver.create(SQL, "v7", null);
    await db.batch([{ sql: "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)" }]);
    for (const m of MIGRATIONS.filter((x) => x.version <= 7))
      await db.batch([...m.up.map((sql) => ({ sql })), { sql: "INSERT INTO schema_migrations VALUES (?, ?, ?)", params: [m.version, m.name, 0] }]);
    const ins = (id: string, icon: string | null, emoji: string | null) => ({
      sql: "INSERT INTO categories (id, name, color, icon, emoji, sort_order, is_break, created_at, updated_at) VALUES (?, ?, '#888', ?, ?, 0, 0, 0, 0)",
      params: [id, id, icon, emoji],
    });
    await db.batch([ins("work", "briefcase", "💼"), ins("dogs", null, "🐕"), ins("plain", "user", null), ins("odd", null, "🦄"), ins("gym", null, "🏋️")]);
    expect(await migrate(db)).toEqual({ from: 7, to: 8 });
    const icon = Object.fromEntries((await repo.listCategories(db)).map((c) => [c.id, c.icon]));
    expect(icon).toEqual({ work: "briefcase", dogs: "dog", plain: null, odd: null, gym: "dumbbell" });
  });
});

describe("preset icon and colour", () => {
  it("a dropped block keeps the preset's icon and colour; editing either side never changes the other", async () => {
    const db = await testDb();
    await boot(db);
    const p = await L.savePreset(L.newPreset({ name: "Houdini", categoryId: catId("Studying"), durationMinutes: 60, icon: "atom", color: "#d98c9a" }));
    expect(store.get().presets[0]).toMatchObject({ icon: "atom", color: "#d98c9a" });
    await L.dropPresetOnDay(p.id, t(2026, 11, 25, 15));
    const b = store.get().blocks.find((x) => x.presetId === p.id)!;
    expect([b.icon, b.color]).toEqual(["atom", "#d98c9a"]);
    await L.savePreset({ ...store.get().presets[0], color: null, icon: null });
    expect(store.get().blocks.find((x) => x.id === b.id)!.color).toBe("#d98c9a");
    // duplicate, split and the template keep it; repeating copies it onto every occurrence
    await A.duplicateBlock(b.id);
    expect(store.get().blocks.filter((x) => x.color === "#d98c9a")).toHaveLength(2);
    await P.repeatFromBlock(b.id, "FREQ=DAILY");
    await A.refresh();
    store.set({ date: startOfDay(t(2026, 11, 27)) });
    await A.refresh();
    const next = store.get().blocks.find((x) => x.recurrenceId);
    expect([next?.icon, next?.color]).toEqual(["atom", "#d98c9a"]);
    const tb = await L.dropPresetOnTemplate(store.get().presets[0].id, t(2024, 1, 3, 9));
    expect([tb?.icon, tb?.color]).toEqual([null, null]); // the preset no longer has its own look
  });
});

describe("quick notes from the floating timer", () => {
  it("adds a timestamped note linked to the running session and shows it in the day log", async () => {
    const db = await testDb();
    await boot(db, t(2026, 11, 25, 10));
    await A.startTimer({ categoryId: catId("Freelance work") });
    const sid = store.get().running!.id;
    await F.runCommand({ type: "note", text: "  client wants the logo bigger  ", at: t(2026, 11, 25, 10, 42) }, 999);
    const entries = await repo.listEntries(db, t(2026, 11, 25), t(2026, 11, 26));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ text: "client wants the logo bigger", source: "capture", kind: "note", sessionId: sid, at: t(2026, 11, 25, 10, 42) });
    const log = buildDayLog(t(2026, 11, 25), [], [], store.get().categories, [], t(2026, 11, 25, 12), entries);
    expect(log.notes.map((n) => n.text)).toEqual(["client wants the logo bigger"]);
    expect(dayLogMarkdown(log, { heading: false })).toContain("- 10:42 *Note:* client wants the logo bigger");
    await J.addQuickNote("   ");
    expect(await repo.listEntries(db, t(2026, 11, 25), t(2026, 11, 26))).toHaveLength(1);
  });
});
