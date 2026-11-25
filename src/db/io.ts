// Export / import of user data. JSON is a complete, lossless dump. CSV is a flat
// "time entries" table for spreadsheets and other tools.

import type { DbDriver, Statement } from "./driver";
import * as repo from "./repo";
import { LATEST_VERSION } from "./migrations";
import type { Block, Category, DailyNote, Session, Tag } from "../domain/types";
import { parseCsv, toCsv } from "../domain/csv";
import { isoLocal } from "../domain/format";
import { currentTimeZone, dayKey } from "../domain/time";

export interface ExportBundle {
  app: "interval";
  format: 1;
  schemaVersion: number;
  exportedAt: string;
  timeZone: string;
  categories: Category[];
  tags: Tag[];
  blocks: Block[];
  sessions: Session[];
  dailyNotes: DailyNote[];
  settings: Record<string, unknown>;
}

export async function exportJson(db: DbDriver): Promise<ExportBundle> {
  const settingsRows = await db.select<{ key: string; value: string }>("SELECT key, value FROM settings");
  const settings: Record<string, unknown> = {};
  for (const r of settingsRows) {
    try {
      settings[r.key] = JSON.parse(r.value);
    } catch {
      /* skip */
    }
  }
  return {
    app: "interval",
    format: 1,
    schemaVersion: LATEST_VERSION,
    exportedAt: isoLocal(Date.now()),
    timeZone: currentTimeZone(),
    categories: await repo.listCategories(db),
    tags: await repo.listTags(db),
    blocks: await repo.listAllBlocks(db),
    sessions: await repo.listAllSessions(db),
    dailyNotes: await repo.listDailyNotes(db),
    settings,
  };
}

/** Merge a JSON export into the database (upsert by id). Returns counts. */
export async function importJson(db: DbDriver, data: unknown): Promise<{ blocks: number; sessions: number }> {
  const b = data as Partial<ExportBundle>;
  if (!b || b.app !== "interval" || !Array.isArray(b.categories)) throw new Error("Not an Interval export file.");
  const stmts: Statement[] = [];
  for (const c of b.categories) stmts.push(repo.upsertCategoryStmt(c));
  // Tags are unique by name; map imported tag ids onto existing ones with the same name.
  const existingTags = await repo.listTags(db);
  const tagMap = new Map<string, string>();
  for (const t of b.tags ?? []) {
    const same = existingTags.find((e) => e.name.toLowerCase() === t.name.toLowerCase());
    if (same) tagMap.set(t.id, same.id);
    else {
      tagMap.set(t.id, t.id);
      stmts.push(repo.upsertTagStmt(t));
    }
  }
  const mapTags = (ids: string[]) => ids.map((id) => tagMap.get(id) ?? id).filter((id, i, a) => a.indexOf(id) === i);
  for (const blk of b.blocks ?? []) stmts.push(...repo.upsertBlockStmts({ ...blk, tagIds: mapTags(blk.tagIds) }));
  const running = await repo.getRunningSession(db);
  for (const s of b.sessions ?? []) {
    // Never import a second running session; close it at its last known point instead.
    const fixed = s.endAt === null && running && running.id !== s.id ? { ...s, endAt: s.updatedAt } : s;
    stmts.push(...repo.upsertSessionStmts({ ...fixed, tagIds: mapTags(s.tagIds) }));
  }
  for (const n of b.dailyNotes ?? []) stmts.push(repo.upsertDailyNoteStmt(n));
  await db.batch(stmts);
  return { blocks: b.blocks?.length ?? 0, sessions: b.sessions?.length ?? 0 };
}

export const CSV_HEADER = [
  "kind",
  "id",
  "date",
  "start",
  "end",
  "duration_minutes",
  "category",
  "parent_category",
  "tags",
  "title",
  "notes",
  "status",
  "mode",
  "block_id",
  "time_zone",
];

export async function exportCsv(db: DbDriver, opts: { includePlanned: boolean } = { includePlanned: true }): Promise<string> {
  const cats = new Map((await repo.listCategories(db)).map((c) => [c.id, c]));
  const tags = new Map((await repo.listTags(db)).map((t) => [t.id, t.name]));
  const catName = (id: string) => cats.get(id)?.name ?? "";
  const parentName = (id: string) => {
    const p = cats.get(id)?.parentId;
    return p ? catName(p) : "";
  };
  const tagNames = (ids: string[]) => ids.map((i) => tags.get(i) ?? "").filter(Boolean).join("; ");
  const rows: unknown[][] = [];
  for (const s of await repo.listAllSessions(db)) {
    if (s.endAt === null) continue; // running session: not yet a complete record
    rows.push([
      "actual",
      s.id,
      dayKey(s.startAt),
      isoLocal(s.startAt),
      isoLocal(s.endAt),
      Math.round((s.endAt - s.startAt) / 60_000),
      catName(s.categoryId),
      parentName(s.categoryId),
      tagNames(s.tagIds),
      s.title ?? "",
      s.notes ?? "",
      "",
      s.mode,
      s.blockId ?? "",
      s.tz,
    ]);
  }
  if (opts.includePlanned) {
    for (const b of await repo.listAllBlocks(db)) {
      rows.push([
        "planned",
        b.id,
        dayKey(b.startAt),
        isoLocal(b.startAt),
        isoLocal(b.endAt),
        Math.round((b.endAt - b.startAt) / 60_000),
        catName(b.categoryId),
        parentName(b.categoryId),
        tagNames(b.tagIds),
        b.title ?? "",
        b.notes ?? "",
        b.status,
        "",
        "",
        b.tz,
      ]);
    }
  }
  rows.sort((a, b) => String(a[3]).localeCompare(String(b[3])));
  return toCsv(CSV_HEADER, rows);
}

/**
 * Import a CSV in the export format above. Categories and tags are matched by name
 * (case-insensitive) and created if missing. Rows with an existing id are updated.
 */
export async function importCsv(db: DbDriver, text: string): Promise<{ blocks: number; sessions: number }> {
  const rows = parseCsv(text);
  if (rows.length === 0) return { blocks: 0, sessions: 0 };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  for (const required of ["kind", "start", "end", "category"]) {
    if (col(required) === -1) throw new Error(`CSV is missing the "${required}" column.`);
  }
  const now = Date.now();
  const cats = await repo.listCategories(db);
  const tags = await repo.listTags(db);
  const stmts: Statement[] = [];
  const catFor = (name: string): string => {
    const n = name.trim() || "Imported";
    let c = cats.find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (!c) {
      c = { id: repo.newId(), name: n, color: "#9a9ba2", icon: null, parentId: null, sortOrder: cats.length, shortcut: null, isBreak: false, archivedAt: null, createdAt: now, updatedAt: now };
      cats.push(c);
      stmts.push(repo.upsertCategoryStmt(c));
    }
    return c.id;
  };
  const tagFor = (name: string): string => {
    let t = tags.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!t) {
      t = { id: repo.newId(), name, color: null, archivedAt: null, createdAt: now };
      tags.push(t);
      stmts.push(repo.upsertTagStmt(t));
    }
    return t.id;
  };
  let blocks = 0;
  let sessions = 0;
  const get = (r: string[], name: string) => (col(name) >= 0 ? (r[col(name)] ?? "").trim() : "");
  for (const r of rows.slice(1)) {
    const start = Date.parse(get(r, "start"));
    const end = Date.parse(get(r, "end"));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const categoryId = catFor(get(r, "category"));
    const tagIds = get(r, "tags")
      .split(/[;|]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(tagFor);
    const id = get(r, "id") || repo.newId();
    const tz = get(r, "time_zone") || currentTimeZone();
    const title = get(r, "title") || null;
    const notes = get(r, "notes") || null;
    if (get(r, "kind") === "planned") {
      const status = (["planned", "in_progress", "completed", "skipped"].includes(get(r, "status")) ? get(r, "status") : "planned") as Block["status"];
      stmts.push(...repo.upsertBlockStmts({ id, startAt: start, endAt: end, tz, categoryId, title, notes, link: null, status: status === "in_progress" ? "planned" : status, recurrenceId: null, tagIds, createdAt: now, updatedAt: now }));
      blocks++;
    } else {
      const mode = (["manual", "stopwatch", "pomodoro", "flowtime"].includes(get(r, "mode")) ? get(r, "mode") : "manual") as Session["mode"];
      stmts.push(...repo.upsertSessionStmts({ id, startAt: start, endAt: end, tz, categoryId, blockId: null, title, notes, mode, tagIds, createdAt: now, updatedAt: now }));
      sessions++;
    }
  }
  await db.batch(stmts);
  return { blocks, sessions };
}
