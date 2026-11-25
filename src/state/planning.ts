// Recurring blocks and day templates.
//
// Recurrence: a rule is materialised into ordinary planned blocks carrying `recurrence_id`, so every
// calendar operation (move, resize, skip, start, stats) works on occurrences unchanged. Each rule
// remembers the last day it was materialised for and only ever generates forward from there, so an
// occurrence you delete or move stays that way. Editing "this and following" splits the series:
// the old rule ends the day before, a new rule starts on the edited block's day.
//
// Templates: a named list of (local start minute, duration, category, name, tags). Applying one
// creates normal planned blocks and is undoable.

import { store } from "./store";
import * as repo from "../db/repo";
import type { Statement } from "../db/driver";
import type { Block, DayTemplate, Id } from "../domain/types";
import { type RecurrenceRule, occurrencesBetween } from "../domain/recurrence";
import { addDays, atMinute, dayKey, MINUTE, minuteOfDay, parseDayKey, startOfDay } from "../domain/time";
import { commit, newBlock, refresh, toast, type Change } from "./actions";

const nextKey = (key: string) => dayKey(addDays(parseDayKey(key).getTime(), 1));
const prevKey = (key: string) => dayKey(addDays(parseDayKey(key).getTime(), -1));

async function reloadPlanning() {
  const d = store.get().db;
  if (!d) return;
  const [rules, templates] = await Promise.all([repo.listRules(d), repo.listTemplates(d)]);
  store.set({ rules, templates });
}

// --------------------------------------------------------------- recurrence

let chain: Promise<void> = Promise.resolve();

/** Generate occurrences for every rule up to and including the local day containing `until`. */
export function ensureOccurrences(until: number): Promise<void> {
  // Serialised: two overlapping refreshes must never generate the same occurrences twice.
  chain = chain.then(() => materialise(until)).catch((e) => console.error(e));
  return chain;
}

async function materialise(until: number) {
  const s = store.get();
  const d = s.db;
  if (!d || s.rules.length === 0) return;
  const untilKey = dayKey(until);
  const stmts: Statement[] = [];
  const next = new Map<Id, RecurrenceRule>();
  const now = Date.now();
  for (const r of s.rules) {
    const fromKey = r.materializedUntil ? nextKey(r.materializedUntil) : r.startsOn;
    const lastKey = r.endsOn && r.endsOn < untilKey ? r.endsOn : untilKey;
    if (fromKey > lastKey) continue;
    for (const day of occurrencesBetween(r, parseDayKey(fromKey).getTime(), parseDayKey(lastKey).getTime())) {
      const start = atMinute(day, r.startMinute);
      const b = newBlock({ start, end: start + r.durationMinutes * MINUTE }, r.categoryId, { title: r.title, tagIds: r.tagIds, recurrenceId: r.id, createdAt: now, updatedAt: now });
      stmts.push(...repo.upsertBlockStmts(b));
    }
    const nr = { ...r, materializedUntil: lastKey };
    stmts.push(repo.upsertRuleStmt(nr));
    next.set(r.id, nr);
  }
  if (!stmts.length) return;
  await d.batch(stmts);
  store.set({ rules: store.get().rules.map((r) => next.get(r.id) ?? r) });
}

function ruleFromBlock(b: Block, rrule: string, id: Id = repo.newId()): RecurrenceRule {
  const key = dayKey(b.startAt);
  return {
    id,
    rrule,
    startMinute: minuteOfDay(b.startAt),
    durationMinutes: Math.max(5, Math.round((b.endAt - b.startAt) / MINUTE)),
    categoryId: b.categoryId,
    title: b.title,
    tagIds: [...b.tagIds].sort(),
    startsOn: key,
    endsOn: null,
    materializedUntil: key, // the block itself is this day's occurrence
    createdAt: Date.now(),
  };
}

export function ruleOf(block: Block | null | undefined): RecurrenceRule | null {
  if (!block?.recurrenceId) return null;
  return store.get().rules.find((r) => r.id === block.recurrenceId) ?? null;
}

/** True when the block's time, length, category, name or tags differ from its rule. */
export function differsFromRule(b: Block, r: RecurrenceRule): boolean {
  return (
    minuteOfDay(b.startAt) !== r.startMinute ||
    Math.round((b.endAt - b.startAt) / MINUTE) !== r.durationMinutes ||
    b.categoryId !== r.categoryId ||
    (b.title ?? null) !== (r.title ?? null) ||
    [...b.tagIds].sort().join(",") !== [...r.tagIds].sort().join(",")
  );
}

async function findBlockAnywhere(id: Id): Promise<Block | null> {
  const s = store.get();
  return s.blocks.find((b) => b.id === id) ?? s.today.blocks.find((b) => b.id === id) ?? (s.db ? await repo.getBlock(s.db, id) : null);
}

/** Planned, untouched-by-time occurrences of `ruleId` from `fromDay`, excluding `keepId`. */
async function deletableOccurrences(ruleId: Id, fromDay: number, keepId?: Id): Promise<Change[]> {
  const d = store.get().db!;
  const list = await repo.futurePlannedOccurrences(d, ruleId, fromDay);
  return list.filter((b) => b.id !== keepId).map((b) => ({ type: "block", before: b, after: null }) as Change);
}

/**
 * Make a block repeat, or change the repeat pattern / apply the block's current details to
 * this and all following occurrences. `rrule` null keeps the existing pattern.
 */
export async function repeatFromBlock(blockId: Id, rrule: string | null) {
  const b = await findBlockAnywhere(blockId);
  if (!b) return;
  const old = ruleOf(b);
  const pattern = rrule ?? old?.rrule;
  if (!pattern) return;
  const day = startOfDay(b.startAt);
  const fresh = ruleFromBlock(b, pattern);
  const extra: Statement[] = [];
  const changes: Change[] = [];
  if (old) {
    const end = prevKey(dayKey(day));
    extra.push(repo.upsertRuleStmt({ ...old, endsOn: end, materializedUntil: old.materializedUntil && old.materializedUntil < end ? old.materializedUntil : end }));
    changes.push(...(await deletableOccurrences(old.id, day, b.id)));
  }
  extra.push(repo.upsertRuleStmt(fresh));
  changes.push({ type: "block", before: b, after: { ...b, recurrenceId: fresh.id, updatedAt: Date.now() } });
  await commit(old ? "Update repeating block" : "Repeat block", changes, { undoable: false, extra });
  await reloadPlanning();
  await refresh();
}

/** End the series after this block. Later planned occurrences without recorded time are removed. */
export async function stopRepeating(blockId: Id) {
  const b = await findBlockAnywhere(blockId);
  const r = ruleOf(b);
  if (!b || !r) return;
  const key = dayKey(b.startAt);
  const changes = await deletableOccurrences(r.id, addDays(startOfDay(b.startAt), 1));
  await commit("Stop repeating", changes, {
    undoable: false,
    extra: [repo.upsertRuleStmt({ ...r, endsOn: key, materializedUntil: r.materializedUntil && r.materializedUntil < key ? r.materializedUntil : key })],
  });
  await reloadPlanning();
  await refresh();
  toast(changes.length ? `Stopped repeating · removed ${changes.length} later occurrence${changes.length === 1 ? "" : "s"}` : "Stopped repeating");
}

/** Delete this occurrence and every later planned one; the series ends the day before. */
export async function deleteFollowing(blockId: Id) {
  const b = await findBlockAnywhere(blockId);
  const r = ruleOf(b);
  if (!b || !r) return;
  const day = startOfDay(b.startAt);
  const end = prevKey(dayKey(day));
  const changes = await deletableOccurrences(r.id, day, b.id);
  for (const sess of await repo.sessionsForBlock(store.get().db!, b.id)) changes.unshift({ type: "session", before: sess, after: { ...sess, blockId: null } });
  changes.push({ type: "block", before: b, after: null });
  await commit("Delete repeating block", changes, {
    undoable: false,
    extra: [repo.upsertRuleStmt({ ...r, endsOn: end, materializedUntil: r.materializedUntil && r.materializedUntil < end ? r.materializedUntil : end })],
  });
  await reloadPlanning();
  await refresh();
}

// ---------------------------------------------------------------- templates

function blocksOnDay(day: number): Block[] {
  const s = store.get();
  const end = addDays(day, 1);
  const seen = new Set<Id>();
  return [...s.blocks, ...s.today.blocks]
    .filter((b) => b.startAt >= day && b.startAt < end && b.status !== "skipped" && !seen.has(b.id) && seen.add(b.id))
    .sort((a, b) => a.startAt - b.startAt);
}

function templateBlocksFrom(blocks: Block[]) {
  return blocks.map((b) => ({
    id: repo.newId(),
    startMinute: minuteOfDay(b.startAt),
    durationMinutes: Math.max(5, Math.round((b.endAt - b.startAt) / MINUTE)),
    categoryId: b.categoryId,
    title: b.title,
    tagIds: [...b.tagIds].sort(),
  }));
}

/** Save the planned blocks of `day` as a new template, or overwrite an existing one. */
export async function saveDayAsTemplate(day: number, name: string, replaceId?: Id): Promise<DayTemplate | null> {
  const blocks = blocksOnDay(startOfDay(day));
  if (!blocks.length) {
    toast("Nothing planned on this day to save");
    return null;
  }
  const s = store.get();
  const existing = replaceId ? s.templates.find((t) => t.id === replaceId) : undefined;
  const t: DayTemplate = existing
    ? { ...existing, blocks: templateBlocksFrom(blocks) }
    : { id: repo.newId(), name: name.trim() || "Untitled day", sortOrder: s.templates.length, createdAt: Date.now(), blocks: templateBlocksFrom(blocks) };
  await s.db!.batch(repo.upsertTemplateStmts(t));
  await reloadPlanning();
  toast(existing ? `Updated “${t.name}”` : `Saved “${t.name}” · ${t.blocks.length} block${t.blocks.length === 1 ? "" : "s"}`);
  return t;
}

/** Apply a template to a day. Undoable; blocks keep their local wall-clock times (DST-safe). */
export async function applyTemplate(id: Id, day: number) {
  const s = store.get();
  const t = s.templates.find((x) => x.id === id);
  if (!t) return;
  const d0 = startOfDay(day);
  const archived = new Set(s.categories.filter((c) => c.archivedAt).map((c) => c.id));
  const changes: Change[] = t.blocks.map((tb) => {
    const start = atMinute(d0, tb.startMinute);
    return { type: "block", before: null, after: newBlock({ start, end: start + tb.durationMinutes * MINUTE }, tb.categoryId, { title: tb.title, tagIds: tb.tagIds }) };
  });
  await commit(`Apply template “${t.name}”`, changes, { silent: true });
  toast(`Applied “${t.name}”${t.blocks.some((b) => archived.has(b.categoryId)) ? " (includes an archived category)" : ""}`, true);
}

export async function renameTemplate(id: Id, name: string) {
  const s = store.get();
  const t = s.templates.find((x) => x.id === id);
  if (!t || !name.trim()) return;
  await s.db!.batch(repo.upsertTemplateStmts({ ...t, name: name.trim() }));
  await reloadPlanning();
}

export async function deleteTemplate(id: Id) {
  await store.get().db!.batch(repo.deleteTemplateStmts(id));
  await reloadPlanning();
}
