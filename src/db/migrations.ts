import type { DbDriver } from "./driver";
import { emojiToIconSql } from "../domain/iconMap";

// Append-only list. Never edit a migration that has shipped; add a new one.
// Tables for Phase 2/3 features (budgets, recurrence, templates, milestones) are created
// now so the model is stable, even though the UI for them arrives later.
export const MIGRATIONS: Array<{ version: number; name: string; up: string[] }> = [
  {
    version: 1,
    name: "initial schema",
    up: [
      `CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        icon TEXT,
        parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        shortcut TEXT,
        is_break INTEGER NOT NULL DEFAULT 0,
        archived_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        color TEXT,
        archived_at INTEGER,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE blocks (
        id TEXT PRIMARY KEY,
        start_at INTEGER NOT NULL,
        end_at INTEGER NOT NULL,
        tz TEXT NOT NULL,
        category_id TEXT NOT NULL REFERENCES categories(id),
        title TEXT,
        notes TEXT,
        link TEXT,
        status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','skipped')),
        recurrence_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (end_at > start_at)
      )`,
      `CREATE INDEX idx_blocks_range ON blocks(start_at, end_at)`,
      `CREATE TABLE block_tags (
        block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (block_id, tag_id)
      )`,
      `CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        start_at INTEGER NOT NULL,
        end_at INTEGER,
        tz TEXT NOT NULL,
        category_id TEXT NOT NULL REFERENCES categories(id),
        block_id TEXT REFERENCES blocks(id) ON DELETE SET NULL,
        title TEXT,
        notes TEXT,
        mode TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual','stopwatch','pomodoro','flowtime')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (end_at IS NULL OR end_at >= start_at)
      )`,
      `CREATE INDEX idx_sessions_range ON sessions(start_at, end_at)`,
      `CREATE INDEX idx_sessions_block ON sessions(block_id)`,
      // At most one running session, enforced by the database itself.
      `CREATE UNIQUE INDEX idx_sessions_single_running ON sessions((end_at IS NULL)) WHERE end_at IS NULL`,
      `CREATE TABLE session_tags (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (session_id, tag_id)
      )`,
      `CREATE TABLE daily_notes (
        date TEXT PRIMARY KEY,
        intention TEXT,
        reflection TEXT,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
      `CREATE TABLE budgets (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL CHECK (target_type IN ('category','tag')),
        target_id TEXT NOT NULL,
        period TEXT NOT NULL CHECK (period IN ('day','week','month','year','lifetime')),
        min_minutes INTEGER,
        max_minutes INTEGER,
        archived_at INTEGER,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE recurrence_rules (
        id TEXT PRIMARY KEY,
        rrule TEXT NOT NULL,
        start_minute INTEGER NOT NULL,
        duration_minutes INTEGER NOT NULL,
        category_id TEXT NOT NULL REFERENCES categories(id),
        title TEXT,
        tag_ids TEXT NOT NULL DEFAULT '[]',
        starts_on TEXT NOT NULL,
        ends_on TEXT,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE TABLE template_blocks (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
        start_minute INTEGER NOT NULL,
        duration_minutes INTEGER NOT NULL,
        category_id TEXT NOT NULL REFERENCES categories(id),
        title TEXT,
        tag_ids TEXT NOT NULL DEFAULT '[]'
      )`,
      `CREATE TABLE milestones (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL CHECK (target_type IN ('category','tag','all')),
        target_id TEXT,
        hours INTEGER NOT NULL,
        achieved_at INTEGER,
        confirmed_at INTEGER,
        note TEXT
      )`,
    ],
  },
  {
    version: 2,
    name: "phase 2: recurrence bookkeeping, review timestamps",
    up: [
      // Last local day for which a rule's occurrences were generated. Occurrences are only ever
      // generated forward from here, so a deleted occurrence never comes back.
      `ALTER TABLE recurrence_rules ADD COLUMN materialized_until TEXT`,
      `ALTER TABLE templates ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE daily_notes ADD COLUMN planned_at INTEGER`,
      `ALTER TABLE daily_notes ADD COLUMN reviewed_at INTEGER`,
      `CREATE INDEX idx_blocks_recurrence ON blocks(recurrence_id)`,
    ],
  },
  {
    version: 3,
    name: "phase 3: personal achievements",
    up: [
      // Achievements the user records by hand ("time spent does not equal skill acquired").
      // Automatic achievements and hour milestones are derived from sessions and never stored.
      `CREATE TABLE achievements (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        note TEXT,
        target_type TEXT CHECK (target_type IN ('category','tag')),
        target_id TEXT,
        achieved_on TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_achievements_day ON achievements(achieved_on)`,
    ],
  },
  {
    version: 4,
    name: "focus timer history",
    up: [
      // One row per focus or break phase run by the focus timer. Recorded time itself stays in
      // `sessions` (that is what statistics, budgets and progress read); this table adds what sessions
      // cannot express: whether a round was completed, skipped or stopped, the planned length, cycles,
      // and break time even when breaks are not recorded as sessions.
      `CREATE TABLE focus_runs (
        id TEXT PRIMARY KEY,
        cycle_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('pomodoro','flowtime','stopwatch')),
        phase TEXT NOT NULL CHECK (phase IN ('focus','short_break','long_break')),
        round INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        planned_ms INTEGER,
        active_ms INTEGER NOT NULL DEFAULT 0,
        outcome TEXT CHECK (outcome IN ('completed','skipped','stopped')),
        ends_cycle INTEGER NOT NULL DEFAULT 0,
        category_id TEXT,
        block_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (ended_at IS NULL OR ended_at >= started_at)
      )`,
      `CREATE INDEX idx_focus_runs_start ON focus_runs(started_at)`,
    ],
  },
  {
    version: 5,
    name: "category emoji",
    // An optional emoji shown in front of a category's name. (`icon` keeps the unused v1 icon names.)
    up: [`ALTER TABLE categories ADD COLUMN emoji TEXT`],
  },
  {
    version: 6,
    name: "creative diary",
    up: [
      // Notes, learnings, ideas, accomplishments and milestones the user wrote when a round ended or later
      // on a recorded entry. No foreign keys: a note outlives a deleted session. 'capture' is reserved.
      `CREATE TABLE journal_entries (
        id TEXT PRIMARY KEY,
        at INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('note','learning','idea','accomplishment','milestone')),
        text TEXT NOT NULL,
        session_id TEXT,
        block_id TEXT,
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('capture','annotation','manual')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_journal_at ON journal_entries(at)`,
      `CREATE INDEX idx_journal_session ON journal_entries(session_id)`,
    ],
  },
  {
    version: 7,
    name: "presets and weekly template",
    up: [
      // Reusable block configurations. Tags are a JSON array (like day templates): presets are never
      // counted anywhere, so they need no join table for statistics.
      `CREATE TABLE activity_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category_id TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
        tag_ids TEXT NOT NULL DEFAULT '[]',
        notes TEXT,
        focus_preset_id TEXT,
        favorite INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      // The one universal weekly template: weekday (0 = Monday) + local start minute + duration.
      // Suggestions on real days are computed from these at render time and never stored.
      `CREATE TABLE week_template_blocks (
        id TEXT PRIMARY KEY,
        weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
        start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
        duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
        category_id TEXT NOT NULL,
        title TEXT,
        notes TEXT,
        tag_ids TEXT NOT NULL DEFAULT '[]',
        preset_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_wtb_weekday ON week_template_blocks(weekday)`,
      // A suggestion hidden for one date only. Deleting the row restores it.
      `CREATE TABLE template_dismissals (
        day TEXT NOT NULL,
        template_block_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (day, template_block_id)
      )`,
      // Where a planned block came from. Independent copies: no foreign keys, nothing cascades.
      `ALTER TABLE blocks ADD COLUMN preset_id TEXT`,
      `ALTER TABLE blocks ADD COLUMN template_block_id TEXT`,
      `CREATE INDEX idx_blocks_template ON blocks(template_block_id)`,
    ],
  },
  {
    version: 8,
    name: "lucide icons and preset colours",
    up: [
      // Lucide icons replace category emoji. `icon` (unused since v1) now holds a Lucide name; each emoji is
      // mapped to its closest icon, and categories without an emoji lose the old v1 names so nothing changes
      // look unexpectedly. `emoji` stays in the table (unused) so a downgrade still reads.
      emojiToIconSql(),
      // Presets get their own icon and colour (null = the category's). Blocks and template blocks carry a
      // copy, so a block dropped from a coloured preset keeps that colour on the calendar.
      `ALTER TABLE activity_presets ADD COLUMN icon TEXT`,
      `ALTER TABLE activity_presets ADD COLUMN color TEXT`,
      `ALTER TABLE blocks ADD COLUMN icon TEXT`,
      `ALTER TABLE blocks ADD COLUMN color TEXT`,
      `ALTER TABLE week_template_blocks ADD COLUMN icon TEXT`,
      `ALTER TABLE week_template_blocks ADD COLUMN color TEXT`,
      `ALTER TABLE recurrence_rules ADD COLUMN icon TEXT`,
      `ALTER TABLE recurrence_rules ADD COLUMN color TEXT`,
    ],
  },
  {
    version: 9,
    name: "template blocks without categories",
    up: [
      // The weekly template is a visual guide only (v0.9): no categories. Each block keeps the look it had
      // (its own icon/colour, else its category's), then the category is cleared (column stays NOT NULL).
      `UPDATE week_template_blocks SET
         color = COALESCE(color, (SELECT c.color FROM categories c WHERE c.id = week_template_blocks.category_id)),
         icon = COALESCE(icon, (SELECT c.icon FROM categories c WHERE c.id = week_template_blocks.category_id)),
         title = COALESCE(NULLIF(TRIM(title), ''), (SELECT c.name FROM categories c WHERE c.id = week_template_blocks.category_id)),
         category_id = ''`,
    ],
  },
  {
    version: 10,
    name: "obsidian integration cache",
    up: [
      // Read-only cache of TaskNotes tasks and Obsidian project notes (integration Phase 1). Obsidian owns them;
      // rows are never deleted by sync: a note that disappears gets gone_at and keeps its last title.
      `CREATE TABLE ext_items (
         kind TEXT NOT NULL CHECK (kind IN ('task','project')),
         ref TEXT NOT NULL,
         uid TEXT,
         title TEXT NOT NULL,
         status TEXT,
         active INTEGER NOT NULL DEFAULT 1,
         data TEXT NOT NULL DEFAULT '{}',
         raw TEXT,
         mtime INTEGER,
         seen_at INTEGER NOT NULL,
         gone_at INTEGER,
         updated_at INTEGER NOT NULL,
         PRIMARY KEY (kind, ref)
       )`,
      `CREATE INDEX ext_items_uid ON ext_items(kind, uid) WHERE uid IS NOT NULL`,
    ],
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export async function migrate(db: DbDriver): Promise<{ from: number; to: number }> {
  await db.batch([
    { sql: "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)" },
  ]);
  const rows = await db.select<{ v: number | null }>("SELECT MAX(version) AS v FROM schema_migrations");
  const from = rows[0]?.v ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= from) continue;
    // Each migration and its bookkeeping row are applied atomically.
    await db.batch([
      ...m.up.map((sql) => ({ sql })),
      { sql: "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", params: [m.version, m.name, Date.now()] },
    ]);
  }
  return { from, to: LATEST_VERSION };
}
