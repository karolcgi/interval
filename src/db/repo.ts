// Repository: maps rows <-> domain objects and builds SQL statements.
// Mutation helpers return Statement[] so callers can compose atomic batches.

import type { DbDriver, SqlValue, Statement } from "./driver";
import type { Block, BlockStatus, Budget, PersonalAchievement, Category, DailyNote, DayTemplate, EntryKind, FocusRun, Id, JournalEntry, Session, SessionMode, Settings, Tag, TemplateBlock } from "../domain/types";
import type { RecurrenceRule } from "../domain/recurrence";
import { DEFAULT_SETTINGS } from "../domain/types";

export function newId(): Id {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// ---------------------------------------------------------------- categories

function toCategory(r: Row): Category {
  return {
    id: String(r.id),
    name: String(r.name),
    color: String(r.color),
    icon: str(r.icon),
    emoji: str(r.emoji),
    parentId: str(r.parent_id),
    sortOrder: Number(r.sort_order),
    shortcut: str(r.shortcut),
    isBreak: Number(r.is_break) === 1,
    archivedAt: num(r.archived_at),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export async function listCategories(db: DbDriver): Promise<Category[]> {
  const rows = await db.select<Row>("SELECT * FROM categories ORDER BY sort_order, created_at");
  return rows.map(toCategory);
}

export function upsertCategoryStmt(c: Category): Statement {
  return {
    sql: `INSERT INTO categories (id, name, color, icon, emoji, parent_id, sort_order, shortcut, is_break, archived_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, icon=excluded.icon, emoji=excluded.emoji,
            parent_id=excluded.parent_id, sort_order=excluded.sort_order, shortcut=excluded.shortcut,
            is_break=excluded.is_break, archived_at=excluded.archived_at, updated_at=excluded.updated_at`,
    params: [c.id, c.name, c.color, c.icon, c.emoji ?? null, c.parentId, c.sortOrder, c.shortcut, c.isBreak ? 1 : 0, c.archivedAt, c.createdAt, c.updatedAt],
  };
}

export async function categoryUsage(db: DbDriver, id: Id): Promise<number> {
  const r = await db.select<{ n: number }>(
    "SELECT (SELECT COUNT(*) FROM blocks WHERE category_id = ?) + (SELECT COUNT(*) FROM sessions WHERE category_id = ?) AS n",
    [id, id],
  );
  return Number(r[0]?.n ?? 0);
}

export const DEFAULT_CATEGORIES: Array<Pick<Category, "name" | "color" | "icon" | "isBreak" | "shortcut">> = [
  { name: "Freelance work", color: "#8298d7", icon: "briefcase", isBreak: false, shortcut: "1" },
  { name: "Studying", color: "#8bbca0", icon: "graduation-cap", isBreak: false, shortcut: "2" },
  { name: "Personal art", color: "#ba9ad0", icon: "palette", isBreak: false, shortcut: "3" },
  { name: "Creative research", color: "#77b3bf", icon: "telescope", isBreak: false, shortcut: "4" },
  { name: "Asset development", color: "#d49a72", icon: "box", isBreak: false, shortcut: "5" },
  { name: "Administration", color: "#c6ae76", icon: "file-text", isBreak: false, shortcut: "6" },
  { name: "Personal time", color: "#9a9ba2", icon: "user", isBreak: false, shortcut: "7" },
  { name: "Breaks", color: "#6c6d73", icon: "coffee", isBreak: true, shortcut: "8" },
];

export async function seedDefaults(db: DbDriver): Promise<boolean> {
  const existing = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM categories");
  if (Number(existing[0]?.n) > 0) return false;
  const now = Date.now();
  await db.batch(
    DEFAULT_CATEGORIES.map((c, i) =>
      upsertCategoryStmt({ ...c, id: newId(), parentId: null, sortOrder: i, archivedAt: null, createdAt: now, updatedAt: now }),
    ),
  );
  return true;
}

// ---------------------------------------------------------------------- tags

function toTag(r: Row): Tag {
  return { id: String(r.id), name: String(r.name), color: str(r.color), archivedAt: num(r.archived_at), createdAt: Number(r.created_at) };
}

export async function listTags(db: DbDriver): Promise<Tag[]> {
  return (await db.select<Row>("SELECT * FROM tags ORDER BY name COLLATE NOCASE")).map(toTag);
}

export function upsertTagStmt(t: Tag): Statement {
  return {
    sql: `INSERT INTO tags (id, name, color, archived_at, created_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, archived_at=excluded.archived_at`,
    params: [t.id, t.name.trim(), t.color, t.archivedAt, t.createdAt],
  };
}

// -------------------------------------------------------------------- blocks

const BLOCK_SELECT = `SELECT b.*, (SELECT group_concat(tag_id) FROM block_tags bt WHERE bt.block_id = b.id) AS tag_ids FROM blocks b`;

function splitIds(v: unknown): Id[] {
  return v ? String(v).split(",").filter(Boolean).sort() : [];
}

function toBlock(r: Row): Block {
  return {
    id: String(r.id),
    startAt: Number(r.start_at),
    endAt: Number(r.end_at),
    tz: String(r.tz),
    categoryId: String(r.category_id),
    title: str(r.title),
    notes: str(r.notes),
    link: str(r.link),
    status: String(r.status) as BlockStatus,
    recurrenceId: str(r.recurrence_id),
    tagIds: splitIds(r.tag_ids),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** Blocks overlapping [start, end). */
export async function listBlocks(db: DbDriver, start: number, end: number): Promise<Block[]> {
  const rows = await db.select<Row>(`${BLOCK_SELECT} WHERE b.start_at < ? AND b.end_at > ? ORDER BY b.start_at`, [end, start]);
  return rows.map(toBlock);
}

export async function listAllBlocks(db: DbDriver): Promise<Block[]> {
  return (await db.select<Row>(`${BLOCK_SELECT} ORDER BY b.start_at`)).map(toBlock);
}

export async function getBlock(db: DbDriver, id: Id): Promise<Block | null> {
  const rows = await db.select<Row>(`${BLOCK_SELECT} WHERE b.id = ?`, [id]);
  return rows[0] ? toBlock(rows[0]) : null;
}

export function upsertBlockStmts(b: Block): Statement[] {
  return [
    {
      sql: `INSERT INTO blocks (id, start_at, end_at, tz, category_id, title, notes, link, status, recurrence_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET start_at=excluded.start_at, end_at=excluded.end_at, tz=excluded.tz,
              category_id=excluded.category_id, title=excluded.title, notes=excluded.notes, link=excluded.link,
              status=excluded.status, recurrence_id=excluded.recurrence_id, updated_at=excluded.updated_at`,
      params: [b.id, b.startAt, b.endAt, b.tz, b.categoryId, b.title, b.notes, b.link, b.status, b.recurrenceId, b.createdAt, b.updatedAt],
    },
    { sql: "DELETE FROM block_tags WHERE block_id = ?", params: [b.id] },
    ...b.tagIds.map((t) => ({ sql: "INSERT OR IGNORE INTO block_tags (block_id, tag_id) VALUES (?, ?)", params: [b.id, t] })),
  ];
}

export function deleteBlockStmts(id: Id): Statement[] {
  return [{ sql: "DELETE FROM blocks WHERE id = ?", params: [id] }];
}

// ------------------------------------------------------------------ sessions

const SESSION_SELECT = `SELECT s.*, (SELECT group_concat(tag_id) FROM session_tags st WHERE st.session_id = s.id) AS tag_ids FROM sessions s`;

function toSession(r: Row): Session {
  return {
    id: String(r.id),
    startAt: Number(r.start_at),
    endAt: num(r.end_at),
    tz: String(r.tz),
    categoryId: String(r.category_id),
    blockId: str(r.block_id),
    title: str(r.title),
    notes: str(r.notes),
    mode: String(r.mode) as SessionMode,
    tagIds: splitIds(r.tag_ids),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** Sessions overlapping [start, end), including a running session that started before `end`. */
export async function listSessions(db: DbDriver, start: number, end: number): Promise<Session[]> {
  const rows = await db.select<Row>(
    `${SESSION_SELECT} WHERE s.start_at < ? AND (s.end_at IS NULL OR s.end_at > ?) ORDER BY s.start_at`,
    [end, start],
  );
  return rows.map(toSession);
}

export async function listAllSessions(db: DbDriver): Promise<Session[]> {
  return (await db.select<Row>(`${SESSION_SELECT} ORDER BY s.start_at`)).map(toSession);
}

export async function getRunningSession(db: DbDriver): Promise<Session | null> {
  const rows = await db.select<Row>(`${SESSION_SELECT} WHERE s.end_at IS NULL LIMIT 1`);
  return rows[0] ? toSession(rows[0]) : null;
}

export async function sessionsForBlock(db: DbDriver, blockId: Id): Promise<Session[]> {
  return (await db.select<Row>(`${SESSION_SELECT} WHERE s.block_id = ? ORDER BY s.start_at`, [blockId])).map(toSession);
}

export async function earliestRecord(db: DbDriver): Promise<number | null> {
  const r = await db.select<{ t: number | null }>(
    "SELECT MIN(t) AS t FROM (SELECT MIN(start_at) AS t FROM sessions UNION ALL SELECT MIN(start_at) FROM blocks)",
  );
  return num(r[0]?.t);
}

export function upsertSessionStmts(s: Session): Statement[] {
  return [
    {
      sql: `INSERT INTO sessions (id, start_at, end_at, tz, category_id, block_id, title, notes, mode, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET start_at=excluded.start_at, end_at=excluded.end_at, tz=excluded.tz,
              category_id=excluded.category_id, block_id=excluded.block_id, title=excluded.title, notes=excluded.notes,
              mode=excluded.mode, updated_at=excluded.updated_at`,
      params: [s.id, s.startAt, s.endAt, s.tz, s.categoryId, s.blockId, s.title, s.notes, s.mode, s.createdAt, s.updatedAt],
    },
    { sql: "DELETE FROM session_tags WHERE session_id = ?", params: [s.id] },
    ...s.tagIds.map((t) => ({ sql: "INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)", params: [s.id, t] })),
  ];
}

export function deleteSessionStmts(id: Id): Statement[] {
  return [{ sql: "DELETE FROM sessions WHERE id = ?", params: [id] }];
}

// ------------------------------------------------------------------ settings

export async function loadSettings(db: DbDriver): Promise<Settings> {
  const rows = await db.select<{ key: string; value: string }>("SELECT key, value FROM settings");
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try {
      s[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore corrupt value, keep default */
    }
  }
  // Object settings saved by an older version get keys added since then (e.g. the Quick Capture shortcut).
  s.globalShortcuts = { ...DEFAULT_SETTINGS.globalShortcuts, ...(s.globalShortcuts as object) };
  return s as unknown as Settings;
}

export function setSettingStmt(key: string, value: unknown): Statement {
  return {
    sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    params: [key, JSON.stringify(value)],
  };
}

export async function getSetting<T>(db: DbDriver, key: string): Promise<T | null> {
  const r = await db.select<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  if (!r[0]) return null;
  try {
    return JSON.parse(r[0].value) as T;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- daily notes

function toDailyNote(x: Row): DailyNote {
  return {
    date: String(x.date),
    intention: str(x.intention),
    reflection: str(x.reflection),
    plannedAt: num(x.planned_at),
    reviewedAt: num(x.reviewed_at),
    updatedAt: Number(x.updated_at),
  };
}

export async function getDailyNote(db: DbDriver, date: string): Promise<DailyNote | null> {
  const r = await db.select<Row>("SELECT * FROM daily_notes WHERE date = ?", [date]);
  return r[0] ? toDailyNote(r[0]) : null;
}

export function upsertDailyNoteStmt(n: DailyNote): Statement {
  return {
    sql: `INSERT INTO daily_notes (date, intention, reflection, planned_at, reviewed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(date) DO UPDATE SET intention=excluded.intention, reflection=excluded.reflection,
            planned_at=excluded.planned_at, reviewed_at=excluded.reviewed_at, updated_at=excluded.updated_at`,
    params: [n.date, n.intention, n.reflection, n.plannedAt ?? null, n.reviewedAt ?? null, n.updatedAt],
  };
}

export async function listDailyNotes(db: DbDriver): Promise<DailyNote[]> {
  return (await db.select<Row>("SELECT * FROM daily_notes ORDER BY date")).map(toDailyNote);
}

// ---------------------------------------------------------------- recurrence

function parseIds(v: unknown): Id[] {
  try {
    const a = JSON.parse(String(v ?? "[]"));
    return Array.isArray(a) ? a.map(String).sort() : [];
  } catch {
    return [];
  }
}

function toRule(r: Row): RecurrenceRule {
  return {
    id: String(r.id),
    rrule: String(r.rrule),
    startMinute: Number(r.start_minute),
    durationMinutes: Number(r.duration_minutes),
    categoryId: String(r.category_id),
    title: str(r.title),
    tagIds: parseIds(r.tag_ids),
    startsOn: String(r.starts_on),
    endsOn: str(r.ends_on),
    materializedUntil: str(r.materialized_until),
    createdAt: Number(r.created_at),
  };
}

export async function listRules(db: DbDriver): Promise<RecurrenceRule[]> {
  return (await db.select<Row>("SELECT * FROM recurrence_rules ORDER BY created_at")).map(toRule);
}

export function upsertRuleStmt(r: RecurrenceRule): Statement {
  return {
    sql: `INSERT INTO recurrence_rules (id, rrule, start_minute, duration_minutes, category_id, title, tag_ids, starts_on, ends_on, materialized_until, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET rrule=excluded.rrule, start_minute=excluded.start_minute, duration_minutes=excluded.duration_minutes,
            category_id=excluded.category_id, title=excluded.title, tag_ids=excluded.tag_ids, starts_on=excluded.starts_on,
            ends_on=excluded.ends_on, materialized_until=excluded.materialized_until`,
    params: [r.id, r.rrule, r.startMinute, r.durationMinutes, r.categoryId, r.title, JSON.stringify(r.tagIds), r.startsOn, r.endsOn, r.materializedUntil, r.createdAt],
  };
}

/** Planned occurrences of a rule starting at or after `from` that have no recorded time. */
export async function futurePlannedOccurrences(db: DbDriver, ruleId: Id, from: number): Promise<Block[]> {
  const rows = await db.select<Row>(
    `${BLOCK_SELECT} WHERE b.recurrence_id = ? AND b.start_at >= ? AND b.status = 'planned'
       AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.block_id = b.id) ORDER BY b.start_at`,
    [ruleId, from],
  );
  return rows.map(toBlock);
}

// ----------------------------------------------------------------- templates

export async function listTemplates(db: DbDriver): Promise<DayTemplate[]> {
  const ts = await db.select<Row>("SELECT * FROM templates ORDER BY sort_order, created_at");
  const bs = await db.select<Row>("SELECT * FROM template_blocks ORDER BY start_minute");
  return ts.map((t) => ({
    id: String(t.id),
    name: String(t.name),
    sortOrder: Number(t.sort_order ?? 0),
    createdAt: Number(t.created_at),
    blocks: bs
      .filter((b) => b.template_id === t.id)
      .map(
        (b): TemplateBlock => ({
          id: String(b.id),
          startMinute: Number(b.start_minute),
          durationMinutes: Number(b.duration_minutes),
          categoryId: String(b.category_id),
          title: str(b.title),
          tagIds: parseIds(b.tag_ids),
        }),
      ),
  }));
}

export function upsertTemplateStmts(t: DayTemplate): Statement[] {
  return [
    {
      sql: `INSERT INTO templates (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order`,
      params: [t.id, t.name, t.sortOrder, t.createdAt],
    },
    { sql: "DELETE FROM template_blocks WHERE template_id = ?", params: [t.id] },
    ...t.blocks.map((b) => ({
      sql: "INSERT INTO template_blocks (id, template_id, start_minute, duration_minutes, category_id, title, tag_ids) VALUES (?, ?, ?, ?, ?, ?, ?)",
      params: [b.id, t.id, b.startMinute, b.durationMinutes, b.categoryId, b.title, JSON.stringify(b.tagIds)],
    })),
  ];
}

export function deleteTemplateStmts(id: Id): Statement[] {
  return [
    { sql: "DELETE FROM template_blocks WHERE template_id = ?", params: [id] },
    { sql: "DELETE FROM templates WHERE id = ?", params: [id] },
  ];
}

// ------------------------------------------------------------------- budgets

function toBudget(r: Row): Budget {
  return {
    id: String(r.id),
    targetType: r.target_type === "tag" ? "tag" : "category",
    targetId: String(r.target_id),
    period: String(r.period) as Budget["period"],
    minMinutes: num(r.min_minutes),
    maxMinutes: num(r.max_minutes),
    archivedAt: num(r.archived_at),
    createdAt: Number(r.created_at),
  };
}

export async function listBudgets(db: DbDriver): Promise<Budget[]> {
  return (await db.select<Row>("SELECT * FROM budgets ORDER BY created_at")).map(toBudget);
}

export function upsertBudgetStmt(b: Budget): Statement {
  return {
    sql: `INSERT INTO budgets (id, target_type, target_id, period, min_minutes, max_minutes, archived_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET target_type=excluded.target_type, target_id=excluded.target_id, period=excluded.period,
            min_minutes=excluded.min_minutes, max_minutes=excluded.max_minutes, archived_at=excluded.archived_at`,
    params: [b.id, b.targetType, b.targetId, b.period, b.minMinutes, b.maxMinutes, b.archivedAt, b.createdAt],
  };
}

export function deleteBudgetStmt(id: Id): Statement {
  return { sql: "DELETE FROM budgets WHERE id = ?", params: [id] };
}

// ------------------------------------------------------------ achievements

function toAchievement(r: Row): PersonalAchievement {
  return {
    id: String(r.id),
    title: String(r.title),
    note: r.note == null ? null : String(r.note),
    targetType: r.target_type == null ? null : (String(r.target_type) as "category" | "tag"),
    targetId: r.target_id == null ? null : String(r.target_id),
    achievedOn: String(r.achieved_on),
    createdAt: Number(r.created_at),
  };
}

export async function listAchievements(db: DbDriver): Promise<PersonalAchievement[]> {
  return (await db.select<Row>("SELECT * FROM achievements ORDER BY achieved_on DESC, created_at DESC")).map(toAchievement);
}

export function upsertAchievementStmt(a: PersonalAchievement): Statement {
  return {
    sql: `INSERT INTO achievements (id, title, note, target_type, target_id, achieved_on, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET title=excluded.title, note=excluded.note, target_type=excluded.target_type,
            target_id=excluded.target_id, achieved_on=excluded.achieved_on`,
    params: [a.id, a.title, a.note, a.targetType, a.targetId, a.achievedOn, a.createdAt],
  };
}

export function deleteAchievementStmt(id: Id): Statement {
  return { sql: "DELETE FROM achievements WHERE id = ?", params: [id] };
}

// -------------------------------------------------------------- focus runs

function toFocusRun(r: Row): FocusRun {
  return {
    id: String(r.id),
    cycleId: String(r.cycle_id),
    kind: String(r.kind) as FocusRun["kind"],
    phase: String(r.phase) as FocusRun["phase"],
    round: Number(r.round),
    startedAt: Number(r.started_at),
    endedAt: num(r.ended_at),
    plannedMs: num(r.planned_ms),
    activeMs: Number(r.active_ms ?? 0),
    outcome: (str(r.outcome) as FocusRun["outcome"]) ?? null,
    endsCycle: Number(r.ends_cycle) === 1,
    categoryId: str(r.category_id),
    blockId: str(r.block_id),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** Focus runs that started in [start, end). */
export async function listFocusRuns(db: DbDriver, start: number, end: number): Promise<FocusRun[]> {
  return (await db.select<Row>("SELECT * FROM focus_runs WHERE started_at < ? AND started_at >= ? ORDER BY started_at", [end, start])).map(toFocusRun);
}

export async function listAllFocusRuns(db: DbDriver): Promise<FocusRun[]> {
  return (await db.select<Row>("SELECT * FROM focus_runs ORDER BY started_at")).map(toFocusRun);
}

export function upsertFocusRunStmt(f: FocusRun): Statement {
  return {
    sql: `INSERT INTO focus_runs (id, cycle_id, kind, phase, round, started_at, ended_at, planned_ms, active_ms, outcome, ends_cycle, category_id, block_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET ended_at=excluded.ended_at, planned_ms=excluded.planned_ms, active_ms=excluded.active_ms,
            outcome=excluded.outcome, ends_cycle=excluded.ends_cycle, category_id=excluded.category_id, block_id=excluded.block_id,
            round=excluded.round, updated_at=excluded.updated_at`,
    params: [f.id, f.cycleId, f.kind, f.phase, f.round, f.startedAt, f.endedAt, f.plannedMs, Math.round(f.activeMs), f.outcome, f.endsCycle ? 1 : 0, f.categoryId, f.blockId, f.createdAt, f.updatedAt],
  };
}

export function deleteFocusRunStmt(id: Id): Statement {
  return { sql: "DELETE FROM focus_runs WHERE id = ?", params: [id] };
}

// ---------------------------------------------------------- journal entries

function toEntry(r: Row): JournalEntry {
  return {
    id: String(r.id),
    at: Number(r.at),
    kind: String(r.kind) as EntryKind,
    text: String(r.text),
    sessionId: str(r.session_id),
    blockId: str(r.block_id),
    source: String(r.source) as JournalEntry["source"],
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** Entries in [start, end), oldest first. */
export async function listEntries(db: DbDriver, start: number, end: number): Promise<JournalEntry[]> {
  return (await db.select<Row>("SELECT * FROM journal_entries WHERE at >= ? AND at < ? ORDER BY at, created_at", [start, end])).map(toEntry);
}

export async function listAllEntries(db: DbDriver): Promise<JournalEntry[]> {
  return (await db.select<Row>("SELECT * FROM journal_entries ORDER BY at, created_at")).map(toEntry);
}

/** Entries written on a session, on a block, or on any of the given sessions; oldest first. */
export async function listEntriesFor(db: DbDriver, t: { sessionId?: Id; blockId?: Id; sessionIds?: Id[] }): Promise<JournalEntry[]> {
  const ids = [...(t.sessionIds ?? []), ...(t.sessionId ? [t.sessionId] : [])];
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (ids.length) (where.push(`session_id IN (${ids.map(() => "?").join(",")})`), params.push(...ids));
  if (t.blockId) (where.push("block_id = ?"), params.push(t.blockId));
  if (!where.length) return [];
  return (await db.select<Row>(`SELECT * FROM journal_entries WHERE ${where.join(" OR ")} ORDER BY at, created_at`, params)).map(toEntry);
}

export function upsertEntryStmt(e: JournalEntry): Statement {
  return {
    sql: `INSERT INTO journal_entries (id, at, kind, text, session_id, block_id, source, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET at=excluded.at, kind=excluded.kind, text=excluded.text, session_id=excluded.session_id,
            block_id=excluded.block_id, source=excluded.source, updated_at=excluded.updated_at`,
    params: [e.id, e.at, e.kind, e.text, e.sessionId, e.blockId, e.source, e.createdAt, e.updatedAt],
  };
}

export function deleteEntryStmt(id: Id): Statement {
  return { sql: "DELETE FROM journal_entries WHERE id = ?", params: [id] };
}
