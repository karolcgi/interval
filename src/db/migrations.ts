import type { DbDriver } from "./driver";

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
