// v0.9: end-of-round notes reach the Day log, and the weekly template drops categories (migration 9).
// Against real SQLite (sql.js).
import initSqlJs from "sql.js";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { t, testDb } from "../test/helpers";
import { store } from "./store";
import * as A from "./actions";
import * as J from "./journal";
import * as L from "./library";
import * as repo from "../db/repo";
import { SqlJsDriver } from "../db/sqljs-driver";
import { MIGRATIONS, migrate } from "../db/migrations";
import { buildDayLog, dayLogItems, dayLogMarkdown } from "../domain/daylog";
import { startOfDay } from "../domain/time";
import { refDay } from "../domain/weekTemplate";

const require = createRequire(import.meta.url);
const MINUTE = 60_000;

async function boot(db: SqlJsDriver, now = t(2026, 11, 26, 8)) {
  store.reset();
  A.clearHistory();
  store.set({ db, date: startOfDay(now), ready: true });
  await A.reloadMeta();
  await A.refresh();
}

describe("end-of-round notes in the Day log", () => {
  it("an annotation typed when a pomodoro ends shows in the Day log and its Markdown", async () => {
    const db = await testDb();
    await boot(db);
    await J.addEntry({ text: "Finished the noise setup", kind: "accomplishment", at: t(2026, 11, 26, 9, 25), source: "annotation" });
    await J.addEntry({ text: "render farm is slow", kind: "note", at: t(2026, 11, 26, 9, 40), source: "capture" });
    await J.addEntry({ text: "yesterday", kind: "note", at: t(2026, 11, 25, 22), source: "annotation" });
    const entries = await repo.listEntries(db, t(2026, 11, 25), t(2026, 11, 27));
    const log = buildDayLog(t(2026, 11, 26), [], [], store.get().categories, [], t(2026, 11, 26, 12), entries);
    expect(dayLogItems(log).map((i) => (i.kind === "note" ? [i.note.text, i.note.source, i.note.kind] : null))).toEqual([
      ["Finished the noise setup", "annotation", "accomplishment"],
      ["render farm is slow", "capture", "note"],
    ]);
    const md = dayLogMarkdown(log, { heading: false });
    expect(md).toContain("*Accomplishment:* Finished the noise setup");
    expect(md).toContain("*Note:* render farm is slow");
  });
});

describe("weekly template without categories", () => {
  it("migration 9 keeps each template block's look and name, then clears its category", async () => {
    const SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
    const db = await SqlJsDriver.create(SQL, "v8", null);
    await db.batch([{ sql: "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)" }]);
    for (const m of MIGRATIONS.filter((x) => x.version <= 8))
      await db.batch([...m.up.map((sql) => ({ sql })), { sql: "INSERT INTO schema_migrations VALUES (?, ?, ?)", params: [m.version, m.name, 0] }]);
    await db.batch([
      { sql: "INSERT INTO categories (id, name, color, icon, sort_order, is_break, created_at, updated_at) VALUES ('study', 'Studying', '#8bbca0', 'graduation-cap', 0, 0, 0, 0)" },
      ...[
        ["a", null, null, null],
        ["b", "Houdini", "atom", "#d98c9a"],
        ["c", "  ", null, "#111111"],
      ].map(([id, title, icon, color]) => ({
        sql: "INSERT INTO week_template_blocks (id, weekday, start_minute, duration_minutes, category_id, title, icon, color, created_at, updated_at) VALUES (?, 0, 540, 60, 'study', ?, ?, ?, 0, 0)",
        params: [id, title, icon, color],
      })),
    ]);
    expect(await migrate(db)).toEqual({ from: 8, to: 9 });
    const rows = Object.fromEntries((await repo.listWeekTemplate(db)).map((x) => [x.id, [x.categoryId, x.title, x.icon, x.color]]));
    expect(rows).toEqual({
      a: ["", "Studying", "graduation-cap", "#8bbca0"],
      b: ["", "Houdini", "atom", "#d98c9a"],
      c: ["", "Studying", "graduation-cap", "#111111"],
    });
  });

  it("drawing in the template makes a named, coloured block with no category", async () => {
    const db = await testDb();
    await boot(db);
    const tb = await L.drawTemplateBlock({ start: refDay(1) + 9 * 60 * MINUTE, end: refDay(1) + 10 * 60 * MINUTE });
    expect(tb).toBeTruthy();
    expect(tb!.categoryId).toBe("");
    expect(L.TEMPLATE_COLORS).toContain(tb!.color);
    expect(store.get().tplRenaming).toBe(tb!.id);
  });
});
