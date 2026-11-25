// Repository: maps rows <-> domain objects and builds SQL statements.
// Mutation helpers return Statement[] so callers can compose atomic batches.

import type { DbDriver, Statement } from "./driver";
import type { Block, BlockStatus, Category, DailyNote, Id, Session, SessionMode, Settings, Tag } from "../domain/types";
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
    sql: `INSERT INTO categories (id, name, color, icon, parent_id, sort_order, shortcut, is_break, archived_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, color=excluded.color, icon=excluded.icon,
            parent_id=excluded.parent_id, sort_order=excluded.sort_order, shortcut=excluded.shortcut,
            is_break=excluded.is_break, archived_at=excluded.archived_at, updated_at=excluded.updated_at`,
    params: [c.id, c.name, c.color, c.icon, c.parentId, c.sortOrder, c.shortcut, c.isBreak ? 1 : 0, c.archivedAt, c.createdAt, c.updatedAt],
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

export async function getDailyNote(db: DbDriver, date: string): Promise<DailyNote | null> {
  const r = await db.select<Row>("SELECT * FROM daily_notes WHERE date = ?", [date]);
  if (!r[0]) return null;
  return { date, intention: str(r[0].intention), reflection: str(r[0].reflection), updatedAt: Number(r[0].updated_at) };
}

export function upsertDailyNoteStmt(n: DailyNote): Statement {
  return {
    sql: `INSERT INTO daily_notes (date, intention, reflection, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(date) DO UPDATE SET intention=excluded.intention, reflection=excluded.reflection, updated_at=excluded.updated_at`,
    params: [n.date, n.intention, n.reflection, n.updatedAt],
  };
}

export async function listDailyNotes(db: DbDriver): Promise<DailyNote[]> {
  const r = await db.select<Row>("SELECT * FROM daily_notes ORDER BY date");
  return r.map((x) => ({ date: String(x.date), intention: str(x.intention), reflection: str(x.reflection), updatedAt: Number(x.updated_at) }));
}
