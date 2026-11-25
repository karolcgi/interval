// Application actions. Every calendar mutation goes through `commit`, which writes the new
// row states atomically and records the previous states for undo/redo.

import { store, type AppState, type CalendarMode, type View } from "./store";
import type { DbDriver, Statement } from "../db/driver";
import { normalizeFocus } from "../domain/focus";
import * as repo from "../db/repo";
import type { Block, Budget, PersonalAchievement, Category, DailyNote, Id, Interval, Session, SessionMode, Settings, Tag, WeekTemplateBlock } from "../domain/types";
import { addDays, addMonths, currentTimeZone, dayKey, MINUTE, shiftDaysKeepClock, startOfDay, startOfMonth, startOfWeek } from "../domain/time";
import { ensureOccurrences } from "./planning";
import * as Focus from "./focus";
import { findMergeCandidate, mergedInterval, splitInterval, splitPoint } from "../domain/calendar";

// ------------------------------------------------------------------ helpers

function db(): DbDriver {
  const d = store.get().db;
  if (!d) throw new Error("Database not ready");
  return d;
}

let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function toast(message: string, undo = false) {
  const id = ++toastSeq;
  store.set({ toast: { id, message, undo } });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (store.get().toast?.id === id) store.set({ toast: null });
  }, 4000);
}

export function reportError(e: unknown) {
  console.error(e);
  toast(e instanceof Error ? e.message : String(e));
}

// ---------------------------------------------------------- undo / redo core

export type Change =
  | { type: "block"; before: Block | null; after: Block | null }
  | { type: "session"; before: Session | null; after: Session | null }
  | { type: "tblock"; before: WeekTemplateBlock | null; after: WeekTemplateBlock | null };

const undoStack: Array<{ label: string; changes: Change[] }> = [];
const redoStack: Array<{ label: string; changes: Change[] }> = [];
const MAX_UNDO = 200;

function stmtsFor(type: Change["type"], id: Id, row: Block | Session | WeekTemplateBlock | null): Statement[] {
  if (type === "tblock") return [row ? repo.upsertWeekBlockStmt(row as WeekTemplateBlock) : repo.deleteWeekBlockStmt(id)];
  if (type === "block") return row ? repo.upsertBlockStmts(row as Block) : repo.deleteBlockStmts(id);
  return row ? repo.upsertSessionStmts(row as Session) : repo.deleteSessionStmts(id);
}

function idOf(c: Change): Id {
  return (c.after ?? c.before)!.id;
}

/** Statements to move from "before" to "after". Sessions are written after blocks they reference. */
function forward(changes: Change[]): Statement[] {
  const blocks = changes.filter((c) => c.type === "block");
  const sessions = changes.filter((c) => c.type === "session");
  // Deleting: sessions first; creating: blocks first. Ordering: block upserts, session changes, block deletes.
  return [
    ...blocks.filter((c) => c.after).flatMap((c) => stmtsFor("block", idOf(c), c.after)),
    // close sessions before opening others, to respect the single-running-session index
    ...sessions
      .slice()
      .sort((a, b) => Number(a.after?.endAt === null) - Number(b.after?.endAt === null))
      .flatMap((c) => stmtsFor("session", idOf(c), c.after)),
    ...blocks.filter((c) => !c.after).flatMap((c) => stmtsFor("block", idOf(c), null)),
    ...changes.filter((c) => c.type === "tblock").flatMap((c) => stmtsFor("tblock", idOf(c), c.after)),
  ];
}

function invert(changes: Change[]): Change[] {
  return changes.map((c) => ({ ...c, before: c.after, after: c.before }) as Change);
}

export async function commit(label: string, changes: Change[], opts: { undoable?: boolean; silent?: boolean; extra?: Statement[] } = {}) {
  if (changes.length === 0 && !opts.extra?.length) return;
  // `extra` statements (e.g. recurrence rule edits) run first, in the same transaction.
  await db().batch([...(opts.extra ?? []), ...forward(changes)]);
  if (opts.undoable !== false) {
    undoStack.push({ label, changes });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
  }
  store.set({ undoDepth: undoStack.length, redoDepth: redoStack.length });
  await refresh();
  if (!opts.silent && opts.undoable !== false && /delete|split|merge|paste|duplicate/i.test(label)) toast(label, true);
}

export async function undo() {
  const entry = undoStack.pop();
  if (!entry) return;
  try {
    await db().batch(forward(invert(entry.changes)));
    redoStack.push(entry);
  } catch (e) {
    undoStack.push(entry);
    reportError(e);
  }
  store.set({ undoDepth: undoStack.length, redoDepth: redoStack.length, toast: { id: ++toastSeq, message: `Undid: ${entry.label}` } });
  await refresh();
}

export async function redo() {
  const entry = redoStack.pop();
  if (!entry) return;
  try {
    await db().batch(forward(entry.changes));
    undoStack.push(entry);
  } catch (e) {
    redoStack.push(entry);
    reportError(e);
  }
  store.set({ undoDepth: undoStack.length, redoDepth: redoStack.length, toast: { id: ++toastSeq, message: `Redid: ${entry.label}` } });
  await refresh();
}

export function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  store.set({ undoDepth: 0, redoDepth: 0 });
}

// ----------------------------------------------------------------- loading

export function visibleRange(date: number, mode: CalendarMode, weekStartsOn: 0 | 1): Interval {
  if (mode === "day") return { start: startOfDay(date), end: addDays(date, 1) };
  if (mode === "week") {
    const s = startOfWeek(date, weekStartsOn);
    return { start: s, end: addDays(s, 7) };
  }
  const gridStart = startOfWeek(startOfMonth(date), weekStartsOn);
  return { start: gridStart, end: Math.max(addDays(gridStart, 42), addMonths(startOfMonth(date), 1)) };
}

let refreshSeq = 0;
export async function refresh() {
  const s = store.get();
  if (!s.db) return;
  const seq = ++refreshSeq;
  const range = visibleRange(s.date, s.calendarMode, s.settings.weekStartsOn);
  const today = startOfDay(Date.now());
  await ensureOccurrences(Math.max(range.end - 1, addDays(today, 14)));
  if (seq !== refreshSeq) return;
  const [blocks, sessions, tBlocks, tSessions, running, note, weekTemplate, dismissals] = await Promise.all([
    repo.listBlocks(s.db, range.start, range.end),
    repo.listSessions(s.db, range.start, range.end),
    repo.listBlocks(s.db, today, addDays(today, 1)),
    repo.listSessions(s.db, today, addDays(today, 1)),
    repo.getRunningSession(s.db),
    repo.getDailyNote(s.db, dayKey(s.date)),
    repo.listWeekTemplate(s.db),
    repo.listDismissals(s.db, dayKey(Math.min(range.start, today)), dayKey(Math.max(range.end - 1, today))),
  ]);
  if (seq !== refreshSeq) return; // a newer refresh superseded this one
  const sel = s.selection;
  const selectionAlive =
    !sel || (sel.kind === "block" ? blocks.some((b) => b.id === sel.id) : sessions.some((x) => x.id === sel.id));
  store.set({
    blocks,
    sessions,
    today: { blocks: tBlocks, sessions: tSessions },
    running,
    dailyNote: note,
    selection: selectionAlive ? sel : null,
    weekTemplate,
    dismissed: new Set(dismissals.map((d) => `${d.day}|${d.templateBlockId}`)),
    tplSelection: s.tplSelection && weekTemplate.some((t) => t.id === s.tplSelection) ? s.tplSelection : null,
  });
}

export async function reloadMeta() {
  const d = db();
  const [categories, tags, settings, paused, acc, rules, templates, budgets, achievements, presets] = await Promise.all([
    repo.listCategories(d),
    repo.listTags(d),
    repo.loadSettings(d),
    repo.getSetting<AppState["paused"]>(d, "timer.paused"),
    repo.getSetting<number>(d, "timer.accumulated"),
    repo.listRules(d),
    repo.listTemplates(d),
    repo.listBudgets(d),
    repo.listAchievements(d),
    repo.listPresets(d),
  ]);
  const focus = normalizeFocus(await repo.getSetting<unknown>(d, "timer.focus"));
  store.set({ categories, tags, settings, paused, runAccumulatedMs: acc ?? 0, rules, templates, budgets, achievements, focus, presets });
}

// -------------------------------------------------------------- navigation

export function setView(view: View) {
  store.set({ view });
}

export function goToday() {
  store.set({ view: "calendar", date: startOfDay(Date.now()) });
  void refresh();
}

export function openDay(date: number) {
  store.set({ view: "calendar", calendarMode: "day", date: startOfDay(date) });
  void refresh();
}

export function setDate(date: number) {
  store.set({ date: startOfDay(date) });
  void refresh();
}

export function setCalendarMode(mode: CalendarMode) {
  store.set({ view: "calendar", calendarMode: mode });
  void refresh();
}

export function stepDate(dir: -1 | 1) {
  const { date, calendarMode } = store.get();
  const next = calendarMode === "day" ? addDays(date, dir) : calendarMode === "week" ? addDays(date, 7 * dir) : addMonths(startOfMonth(date), dir);
  setDate(next);
}

export function select(selection: { kind: "block" | "session"; id: Id } | null) {
  store.set({ selection });
}

/** Begin editing an item's name inline on the timeline (F2, double-click, context menu). */
export function startRename(target: { kind: "block" | "session"; id: Id }) {
  store.set({ selection: target, renaming: target });
}

export function cancelRename() {
  if (store.get().renaming) store.set({ renaming: null });
}

/** Commit an inline rename. An empty name clears it (the category name shows instead). */
export async function renameItem(target: { kind: "block" | "session"; id: Id }, name: string) {
  store.set({ renaming: null });
  const title = name.trim() || null;
  const s = store.get();
  if (target.kind === "block") {
    const b = s.blocks.find((x) => x.id === target.id);
    if (b && b.title !== title) await updateBlock(b.id, { title }, "Rename block");
  } else {
    const x = s.sessions.find((y) => y.id === target.id);
    if (x && x.title !== title) await updateSession(x.id, { title }, "Rename session");
  }
}

// ------------------------------------------------------------ settings/meta

export async function updateSettings(patch: Partial<Settings>) {
  const next = { ...store.get().settings, ...patch };
  store.set({ settings: next });
  await db().batch(Object.entries(patch).map(([k, v]) => repo.setSettingStmt(k, v)));
  if ("weekStartsOn" in patch) await refresh();
}

export async function saveCategory(c: Category) {
  await db().batch([repo.upsertCategoryStmt({ ...c, updatedAt: Date.now() })]);
  await reloadMeta();
}

export async function createCategory(partial: Partial<Category> & { name: string }) {
  const now = Date.now();
  const cats = store.get().categories;
  const c: Category = {
    id: repo.newId(),
    color: "#9a9ba2",
    icon: null,
    parentId: null,
    sortOrder: cats.length ? Math.max(...cats.map((x) => x.sortOrder)) + 1 : 0,
    shortcut: null,
    isBreak: false,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
  await saveCategory(c);
  return c;
}

export async function reorderCategories(ids: Id[]) {
  const cats = store.get().categories;
  const now = Date.now();
  await db().batch(
    ids.map((id, i) => {
      const c = cats.find((x) => x.id === id)!;
      return repo.upsertCategoryStmt({ ...c, sortOrder: i, updatedAt: now });
    }),
  );
  await reloadMeta();
}

/** Delete only if never used; otherwise archive (history is preserved). */
export async function deleteOrArchiveCategory(id: Id): Promise<"deleted" | "archived"> {
  const used = await repo.categoryUsage(db(), id);
  const c = store.get().categories.find((x) => x.id === id)!;
  if (used > 0) {
    await saveCategory({ ...c, archivedAt: Date.now() });
    return "archived";
  }
  await db().batch([
    { sql: "UPDATE categories SET parent_id = NULL WHERE parent_id = ?", params: [id] },
    { sql: "DELETE FROM categories WHERE id = ?", params: [id] },
  ]);
  await reloadMeta();
  return "deleted";
}

export async function ensureTag(name: string): Promise<Tag> {
  const clean = name.trim().replace(/^#/, "");
  const existing = store.get().tags.find((t) => t.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const t: Tag = { id: repo.newId(), name: clean, color: null, archivedAt: null, createdAt: Date.now() };
  await db().batch([repo.upsertTagStmt(t)]);
  await reloadMeta();
  return t;
}

export async function saveTag(t: Tag) {
  const clash = store.get().tags.find((x) => x.id !== t.id && x.name.toLowerCase() === t.name.trim().toLowerCase());
  if (clash) throw new Error(`A tag named “${clash.name}” already exists.`);
  await db().batch([repo.upsertTagStmt(t)]);
  await reloadMeta();
}

export async function deleteTag(id: Id) {
  await db().batch([{ sql: "DELETE FROM tags WHERE id = ?", params: [id] }]);
  await reloadMeta();
  await refresh();
}

export async function saveDailyNote(patch: Partial<Pick<DailyNote, "intention" | "reflection" | "plannedAt" | "reviewedAt">>, date = dayKey(store.get().date)) {
  const s = store.get();
  const current = s.dailyNote?.date === date ? s.dailyNote : await repo.getDailyNote(db(), date);
  const note: DailyNote = {
    date,
    intention: current?.intention ?? null,
    reflection: current?.reflection ?? null,
    plannedAt: current?.plannedAt ?? null,
    reviewedAt: current?.reviewedAt ?? null,
    ...patch,
    updatedAt: Date.now(),
  };
  await db().batch([repo.upsertDailyNoteStmt(note)]);
  if (dayKey(store.get().date) === date) store.set({ dailyNote: note });
  return note;
}

// ------------------------------------------------------------------ budgets

export async function saveBudget(b: Budget) {
  if (b.minMinutes === null && b.maxMinutes === null) throw new Error("Set a target, a limit, or both.");
  if (b.minMinutes !== null && b.maxMinutes !== null && b.maxMinutes < b.minMinutes) throw new Error("The limit is below the target.");
  await db().batch([repo.upsertBudgetStmt(b)]);
  store.set({ budgets: await repo.listBudgets(db()) });
}

export async function deleteBudget(id: Id) {
  await db().batch([repo.deleteBudgetStmt(id)]);
  store.set({ budgets: await repo.listBudgets(db()) });
}

// ------------------------------------------------------------- achievements

export async function saveAchievement(a: PersonalAchievement) {
  if (!a.title.trim()) throw new Error("Give the achievement a title.");
  await db().batch([repo.upsertAchievementStmt({ ...a, title: a.title.trim(), note: a.note?.trim() || null })]);
  store.set({ achievements: await repo.listAchievements(db()) });
}

export async function deleteAchievement(id: Id) {
  await db().batch([repo.deleteAchievementStmt(id)]);
  store.set({ achievements: await repo.listAchievements(db()) });
}

// ------------------------------------------------------------------ blocks

function findBlock(id: Id): Block | undefined {
  const s = store.get();
  return s.blocks.find((b) => b.id === id) ?? s.today.blocks.find((b) => b.id === id);
}

function findSession(id: Id): Session | undefined {
  const s = store.get();
  return s.sessions.find((b) => b.id === id) ?? s.today.sessions.find((b) => b.id === id) ?? (s.running?.id === id ? s.running : undefined);
}

export function newBlock(iv: Interval, categoryId: Id, extra: Partial<Block> = {}): Block {
  const now = Date.now();
  return {
    id: repo.newId(),
    startAt: iv.start,
    endAt: iv.end,
    tz: currentTimeZone(),
    categoryId,
    title: null,
    notes: null,
    link: null,
    status: "planned",
    recurrenceId: null,
    tagIds: [],
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
}

export async function createBlock(iv: Interval, categoryId: Id, extra: Partial<Block> = {}) {
  const b = newBlock(iv, categoryId, extra);
  await commit("Create block", [{ type: "block", before: null, after: b }]);
  store.set({ selection: { kind: "block", id: b.id } });
  return b;
}

export async function updateBlock(id: Id, patch: Partial<Block>, label = "Edit block") {
  const before = findBlock(id) ?? (await repo.getBlock(db(), id));
  if (!before) return;
  const after = { ...before, ...patch, updatedAt: Date.now() };
  if (after.endAt <= after.startAt) return;
  await commit(label, [{ type: "block", before, after }]);
}

export async function updateBlocks(patches: Array<{ id: Id; patch: Partial<Block> }>, label: string) {
  const changes: Change[] = [];
  for (const { id, patch } of patches) {
    const before = findBlock(id);
    if (before) changes.push({ type: "block", before, after: { ...before, ...patch, updatedAt: Date.now() } });
  }
  await commit(label, changes);
}

export async function deleteBlocks(ids: Id[]) {
  const changes: Change[] = [];
  for (const id of ids) {
    const before = findBlock(id);
    if (!before) continue;
    // Detach recorded sessions explicitly so undo can re-attach them. Recorded time is never deleted with a plan.
    for (const s of await repo.sessionsForBlock(db(), id)) changes.push({ type: "session", before: s, after: { ...s, blockId: null } });
    changes.push({ type: "block", before, after: null });
  }
  await commit(ids.length > 1 ? `Delete ${ids.length} blocks` : "Delete block", changes);
}

export async function duplicateBlock(id: Id, dayOffset = 0) {
  const b = findBlock(id);
  if (!b) return;
  const dur = b.endAt - b.startAt;
  const start = dayOffset === 0 ? b.endAt : shiftDaysKeepClock(b.startAt, dayOffset);
  const copy = newBlock({ start, end: start + dur }, b.categoryId, { title: b.title, notes: b.notes, link: b.link, tagIds: b.tagIds, presetId: b.presetId ?? null, icon: b.icon ?? null, color: b.color ?? null });
  await commit(dayOffset === 0 ? "Duplicate block" : "Duplicate to another day", [{ type: "block", before: null, after: copy }]);
  store.set({ selection: { kind: "block", id: copy.id } });
}

export async function splitBlock(id: Id, at?: number) {
  const b = findBlock(id);
  if (!b) return;
  const point = at ?? splitPoint({ start: b.startAt, end: b.endAt }, store.get().settings.snapMinutes);
  const parts = splitInterval({ start: b.startAt, end: b.endAt }, point);
  if (!parts) return toast("Block is too short to split there");
  const second = newBlock(parts[1], b.categoryId, { title: b.title, notes: b.notes, link: b.link, tagIds: b.tagIds, presetId: b.presetId ?? null, icon: b.icon ?? null, color: b.color ?? null, status: b.status === "in_progress" ? "planned" : b.status });
  await commit("Split block", [
    { type: "block", before: b, after: { ...b, endAt: parts[0].end, updatedAt: Date.now() } },
    { type: "block", before: null, after: second },
  ]);
}

export async function mergeBlock(id: Id) {
  const s = store.get();
  const b = findBlock(id);
  if (!b) return;
  const other = findMergeCandidate(b, s.blocks);
  if (!other) return toast("No adjacent block of the same category to merge with");
  const iv = mergedInterval({ start: b.startAt, end: b.endAt }, { start: other.startAt, end: other.endAt });
  const [keep, drop] = b.startAt <= other.startAt ? [b, other] : [other, b];
  const tagIds = [...new Set([...keep.tagIds, ...drop.tagIds])].sort();
  const changes: Change[] = [];
  for (const sess of await repo.sessionsForBlock(db(), drop.id)) changes.push({ type: "session", before: sess, after: { ...sess, blockId: keep.id } });
  changes.push({ type: "block", before: keep, after: { ...keep, startAt: iv.start, endAt: iv.end, tagIds, updatedAt: Date.now() } });
  changes.push({ type: "block", before: drop, after: null });
  await commit("Merge blocks", changes);
  store.set({ selection: { kind: "block", id: keep.id } });
}

export function copyBlocks(ids: Id[]) {
  const blocks = ids.map(findBlock).filter(Boolean) as Block[];
  store.set({ clipboard: blocks });
  if (blocks.length) toast(blocks.length === 1 ? "Block copied" : `${blocks.length} blocks copied`);
}

/** Paste copied blocks onto the focused day, keeping their wall-clock times. */
export async function pasteBlocks(targetDay = store.get().date) {
  const { clipboard } = store.get();
  if (!clipboard.length) return;
  const changes: Change[] = clipboard.map((b) => {
    const offsetDays = Math.round((startOfDay(targetDay) - startOfDay(b.startAt)) / 86_400_000);
    const start = shiftDaysKeepClock(b.startAt, offsetDays);
    return { type: "block", before: null, after: newBlock({ start, end: start + (b.endAt - b.startAt) }, b.categoryId, { title: b.title, notes: b.notes, link: b.link, tagIds: b.tagIds, presetId: b.presetId ?? null, icon: b.icon ?? null, color: b.color ?? null }) };
  });
  await commit(changes.length === 1 ? "Paste block" : `Paste ${changes.length} blocks`, changes);
}

export async function setBlockStatus(id: Id, status: Block["status"]) {
  await updateBlock(id, { status }, status === "skipped" ? "Skip block" : status === "planned" ? "Mark as planned" : "Update status");
}

/** Confirm a planned block as done without a timer: records an actual session equal to the plan. */
export async function completeBlockManually(id: Id) {
  const b = findBlock(id);
  if (!b) return;
  const now = Date.now();
  const existing = await repo.sessionsForBlock(db(), id);
  const changes: Change[] = [{ type: "block", before: b, after: { ...b, status: "completed", updatedAt: now } }];
  if (existing.length === 0) {
    const end = Math.min(b.endAt, Math.max(now, b.startAt + MINUTE));
    changes.push({
      type: "session",
      before: null,
      after: { id: repo.newId(), startAt: b.startAt, endAt: end, tz: b.tz, categoryId: b.categoryId, blockId: b.id, title: b.title, notes: null, mode: "manual", tagIds: b.tagIds, createdAt: now, updatedAt: now },
    });
  }
  await commit("Confirm block", changes);
}

// ---------------------------------------------------------------- sessions

export async function createSession(iv: Interval, categoryId: Id, extra: Partial<Session> = {}) {
  const now = Date.now();
  const s: Session = { id: repo.newId(), startAt: iv.start, endAt: Math.min(iv.end, Math.max(now, iv.start + MINUTE)), tz: currentTimeZone(), categoryId, blockId: null, title: null, notes: null, mode: "manual", tagIds: [], createdAt: now, updatedAt: now, ...extra };
  await commit("Log time", [{ type: "session", before: null, after: s }]);
  store.set({ selection: { kind: "session", id: s.id } });
  return s;
}

export async function updateSession(id: Id, patch: Partial<Session>, label = "Edit session") {
  const before = findSession(id);
  if (!before) return;
  const after = { ...before, ...patch, updatedAt: Date.now() };
  if (after.endAt !== null && after.endAt < after.startAt) return;
  const running = before.endAt === null;
  await commit(label, [{ type: "session", before, after }], { undoable: !running });
}

export async function deleteSession(id: Id) {
  const before = findSession(id);
  if (!before) return;
  if (before.endAt === null) return toast("Stop the timer before deleting this session");
  await commit("Delete session", [{ type: "session", before, after: null }]);
}

// -------------------------------------------------------------------- timer
//
// The timer itself lives in state/focus.ts (one engine for Stopwatch, Pomodoro and Flowtime). These
// are the entry points the rest of the UI has always used.

const HEARTBEAT_KEY = "timer.heartbeat";

/** Applies one timer transition atomically: the session/block changes plus `extra` statements. */
export async function commitTimer(changes: Change[], extra: Statement[], patch: Partial<AppState>) {
  if (changes.length === 0 && extra.length === 0) return;
  await db().batch([...extra, ...forward(changes)]);
  store.set(patch);
  await refresh();
}

export async function startTimer(opts: { blockId?: Id | null; categoryId?: Id; tagIds?: Id[]; title?: string | null; mode?: SessionMode } = {}) {
  const { mode, ...target } = opts;
  if (mode === "pomodoro") return Focus.startPomodoro(target);
  if (mode === "flowtime") return Focus.startFlowtime(target);
  return Focus.startStopwatch(target);
}

export async function stopTimer(at = Date.now()) {
  return Focus.stop(at);
}

export async function pauseTimer() {
  return Focus.pause();
}

export async function resumeTimer() {
  return Focus.resume();
}

export async function toggleTimer() {
  const s = store.get();
  if (s.running) return stopTimer();
  if (s.paused) return resumeTimer();
  const f = s.focus;
  if (f?.phase === "suggest") return Focus.startBreak();
  if (f?.phase === "ready" || f?.phase === "done") return Focus.nextRound();
  if (f?.phase === "break") return Focus.stop();
  const sel = s.selection;
  if (sel?.kind === "block") return (await import("./library")).startFromBlock(sel.id); // may offer the preset's focus timer
  return startTimer({});
}

/** Stopwatch only: Pomodoro and Flowtime handle sleep inside the engine (they pause themselves). */
function usesSleepBanner(): boolean {
  const f = store.get().focus;
  return !f || f.kind === "stopwatch";
}

/** Called periodically while a session runs. Detects sleep / suspended app. */
export async function heartbeat(lastTick: number) {
  const s = store.get();
  if (!s.running || !s.db) return;
  const now = Date.now();
  const GAP = 5 * MINUTE;
  if (now - lastTick > GAP && !s.sleepGap && usesSleepBanner()) {
    store.set({ sleepGap: { sessionId: s.running.id, from: lastTick, to: now } });
  }
  await s.db.batch([repo.setSettingStmt(HEARTBEAT_KEY, now)]);
}

/** On startup: if a stopwatch was running and the last heartbeat is old, ask the user. */
export async function checkSleepOnStartup() {
  const s = store.get();
  if (!s.running || !s.db || !usesSleepBanner()) return;
  const last = await repo.getSetting<number>(s.db, HEARTBEAT_KEY);
  const now = Date.now();
  if (last && now - last > 10 * MINUTE) store.set({ sleepGap: { sessionId: s.running.id, from: last, to: now } });
}

export async function resolveSleepGap(choice: "keep" | "exclude" | "stop") {
  const gap = store.get().sleepGap;
  store.set({ sleepGap: null });
  if (!gap || !store.get().running) return;
  await Focus.resolveStopwatchGap(choice, gap);
}

// ------------------------------------------------------------------ backups

/**
 * Daily rolling backup into settings.backupDir (default: `backups` beside the database).
 * `force` re-writes today's copy and confirms with a toast. Desktop only; never throws.
 */
export async function backupNow(force = true): Promise<string | null> {
  if (store.get().db?.kind !== "tauri") return null;
  const s = store.get().settings;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await invoke<string | null>("db_backup_daily", { keep: Math.max(1, s.backupKeepDays), dir: s.backupDir, force });
    if (force && path) toast(`Backed up to ${path}`);
    return path;
  } catch (e) {
    reportError(e);
    return null;
  }
}
