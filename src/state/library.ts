// Activity presets and the weekly template (v0.7).
//
// Presets are configurations, not records: they are never counted anywhere. A block made from a
// preset or a template suggestion is an independent copy; editing either side never changes the
// other. Template edits go through `commit` (as "tblock" changes) so they share undo/redo.

import { store } from "./store";
import * as A from "./actions";
import * as repo from "../db/repo";
import type { ActivityPreset, Block, Id, Interval, WeekTemplateBlock } from "../domain/types";
import { addDays, atMinute, dayKey, MINUTE, startOfDay } from "../domain/time";
import {
  blockFieldsFrom,
  conflictsWith,
  fromRefInterval,
  refDay,
  suggestionOf,
  suggestionsForDay,
  weekdayOf,
  type Suggestion,
} from "../domain/weekTemplate";

function db() {
  const d = store.get().db;
  if (!d) throw new Error("Database not ready");
  return d;
}

// ------------------------------------------------------------------ presets

export function newPreset(partial: Partial<ActivityPreset> = {}): ActivityPreset {
  const s = store.get();
  const now = Date.now();
  return {
    id: repo.newId(),
    name: "",
    categoryId: s.categories.find((c) => !c.archivedAt && !c.isBreak)?.id ?? s.categories[0]?.id ?? "",
    durationMinutes: 60,
    tagIds: [],
    notes: null,
    focusPresetId: null,
    favorite: false,
    icon: null,
    color: null,
    sortOrder: s.presets.length ? Math.max(...s.presets.map((p) => p.sortOrder)) + 1 : 0,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

async function reloadPresets() {
  store.set({ presets: await repo.listPresets(db()) });
}

export async function savePreset(p: ActivityPreset): Promise<ActivityPreset> {
  const name = p.name.trim();
  if (!name) throw new Error("Give the preset a name.");
  if (!p.categoryId) throw new Error("Pick a category.");
  const durationMinutes = Math.round(p.durationMinutes);
  if (!(durationMinutes >= 5 && durationMinutes <= 1440)) throw new Error("Duration must be between 5 minutes and 24 hours.");
  const clean = { ...p, name, durationMinutes, notes: p.notes?.trim() || null, updatedAt: Date.now() };
  await db().batch([repo.upsertPresetStmt(clean)]);
  await reloadPresets();
  return clean;
}

export async function deletePreset(id: Id) {
  const p = store.get().presets.find((x) => x.id === id);
  await db().batch([repo.deletePresetStmt(id)]);
  if (store.get().presetEditing === id) store.set({ presetEditing: null });
  await reloadPresets();
  if (p) A.toast(`Deleted preset “${p.name}”. Blocks made from it are kept.`);
}

export async function duplicatePreset(id: Id) {
  const p = store.get().presets.find((x) => x.id === id);
  if (!p) return;
  const all = store.get().presets;
  // Place the copy right after the original.
  const copy = newPreset({ ...p, id: repo.newId(), name: `${p.name} copy`, favorite: false, sortOrder: p.sortOrder + 1, createdAt: Date.now() });
  const shifted = all.filter((x) => x.sortOrder > p.sortOrder).map((x) => repo.upsertPresetStmt({ ...x, sortOrder: x.sortOrder + 1 }));
  await db().batch([...shifted, repo.upsertPresetStmt(copy)]);
  await reloadPresets();
  store.set({ presetEditing: copy.id });
  return copy;
}

export async function toggleFavorite(id: Id) {
  const p = store.get().presets.find((x) => x.id === id);
  if (p) await savePreset({ ...p, favorite: !p.favorite });
}

/** Save a new custom order (ids in their new order). */
export async function reorderPresets(ids: Id[]) {
  const all = store.get().presets;
  const now = Date.now();
  const stmts = ids
    .map((id, i) => {
      const p = all.find((x) => x.id === id);
      return p && p.sortOrder !== i ? repo.upsertPresetStmt({ ...p, sortOrder: i, updatedAt: now }) : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (stmts.length) await db().batch(stmts);
  await reloadPresets();
}

/** Move one preset before another (or to the end with `beforeId` null). */
export async function movePreset(id: Id, beforeId: Id | null) {
  const order = store
    .get()
    .presets.slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => p.id)
    .filter((x) => x !== id);
  const at = beforeId ? order.indexOf(beforeId) : -1;
  order.splice(at < 0 ? order.length : at, 0, id);
  await reorderPresets(order);
}

/** Right-click a block › Save as preset. Opens the new preset in the Presets tab editor. */
export async function saveBlockAsPreset(block: Block) {
  const cat = store.get().categories.find((c) => c.id === block.categoryId);
  const p = await savePreset(
    newPreset({
      name: block.title?.trim() || cat?.name || "Preset",
      categoryId: block.categoryId,
      durationMinutes: Math.max(5, Math.min(1440, Math.round((block.endAt - block.startAt) / MINUTE))),
      tagIds: [...block.tagIds],
      notes: block.notes,
      icon: block.icon ?? null,
      color: block.color ?? null,
    }),
  );
  A.toast(`Saved preset “${p.name}”`);
  return p;
}

/** The fields a block (or template block) takes from a preset. Copies, never references. */
export function presetFields(p: ActivityPreset) {
  return { categoryId: p.categoryId, title: p.name, notes: p.notes, tagIds: [...p.tagIds], presetId: p.id, icon: p.icon, color: p.color };
}

/** Drop a preset on a real day: a planned block, created immediately. Never starts a timer. */
export async function dropPresetOnDay(presetId: Id, start: number) {
  const p = store.get().presets.find((x) => x.id === presetId);
  if (!p) return;
  const { categoryId, ...extra } = presetFields(p);
  await A.createBlock({ start, end: start + p.durationMinutes * MINUTE }, categoryId, extra);
}

// ---------------------------------------------------------- weekly template

function findTpl(id: Id): WeekTemplateBlock | undefined {
  return store.get().weekTemplate.find((t) => t.id === id);
}

export function newTemplateBlock(partial: Partial<WeekTemplateBlock> & Pick<WeekTemplateBlock, "weekday" | "startMinute" | "durationMinutes" | "categoryId">): WeekTemplateBlock {
  const now = Date.now();
  return { id: repo.newId(), title: null, notes: null, tagIds: [], presetId: null, icon: null, color: null, createdAt: now, updatedAt: now, ...partial };
}

export async function createTemplateBlock(iv: Interval, categoryId: Id, extra: Partial<WeekTemplateBlock> = {}) {
  const t = newTemplateBlock({ ...fromRefInterval(iv), categoryId, ...extra });
  await A.commit("Add to template", [{ type: "tblock", before: null, after: t }]);
  store.set({ tplSelection: t.id });
  return t;
}

/** Drop a preset into the template at a weekday and minute. */
export async function dropPresetOnTemplate(presetId: Id, start: number) {
  const p = store.get().presets.find((x) => x.id === presetId);
  if (!p) return;
  const { categoryId, ...extra } = presetFields(p);
  return createTemplateBlock({ start, end: start + p.durationMinutes * MINUTE }, categoryId, extra);
}

export async function updateTemplateBlock(id: Id, patch: Partial<WeekTemplateBlock>, label = "Edit template block") {
  const before = findTpl(id);
  if (!before) return;
  const after = { ...before, ...patch, updatedAt: Date.now() };
  if (after.durationMinutes < 1 || after.startMinute < 0 || after.startMinute > 1439) return;
  await A.commit(label, [{ type: "tblock", before, after }]);
}

/** Move or resize from an interval drawn on the reference week. */
export async function setTemplateInterval(id: Id, iv: Interval, label: string) {
  await updateTemplateBlock(id, fromRefInterval(iv), label);
}

export async function deleteTemplateBlocks(ids: Id[]) {
  const changes = ids.map(findTpl).filter(Boolean).map((before) => ({ type: "tblock" as const, before: before!, after: null }));
  if (!changes.length) return;
  if (ids.includes(store.get().tplSelection ?? "")) store.set({ tplSelection: null });
  await A.commit(changes.length > 1 ? `Delete ${changes.length} template blocks` : "Delete template block", changes);
}

/** Duplicate right after itself, or onto another weekday at the same time. */
export async function duplicateTemplateBlock(id: Id, toWeekday?: number) {
  const t = findTpl(id);
  if (!t) return;
  const sameDay = toWeekday === undefined || toWeekday === t.weekday;
  const startMinute = sameDay ? Math.min(1439, t.startMinute + t.durationMinutes) : t.startMinute;
  const copy = newTemplateBlock({ ...t, id: repo.newId(), weekday: toWeekday ?? t.weekday, startMinute, durationMinutes: Math.min(t.durationMinutes, 1440 - startMinute) });
  await A.commit(sameDay ? "Duplicate template block" : "Copy to another day", [{ type: "tblock", before: null, after: copy }]);
  store.set({ tplSelection: copy.id });
}

/** Copy a whole day's structure onto other weekdays. `replace` clears those days first. */
export async function copyTemplateDay(from: number, to: number[], replace: boolean) {
  const tpl = store.get().weekTemplate;
  const src = tpl.filter((t) => t.weekday === from);
  const targets = to.filter((w) => w !== from);
  if (!src.length || !targets.length) return;
  const changes: import("./actions").Change[] = [];
  for (const w of targets) {
    if (replace) for (const t of tpl.filter((x) => x.weekday === w)) changes.push({ type: "tblock", before: t, after: null });
    for (const t of src) changes.push({ type: "tblock", before: null, after: newTemplateBlock({ ...t, id: repo.newId(), weekday: w }) });
  }
  await A.commit(`Copy day to ${targets.length === 1 ? "1 day" : `${targets.length} days`}`, changes);
}

/** Import a Phase 2 day template into a weekday (keeps the day template). */
export async function importDayTemplate(templateId: Id, weekday: number) {
  const t = store.get().templates.find((x) => x.id === templateId);
  if (!t) return;
  const changes = t.blocks.map((b) => ({
    type: "tblock" as const,
    before: null,
    after: newTemplateBlock({ weekday, startMinute: b.startMinute, durationMinutes: Math.min(b.durationMinutes, 1440 - b.startMinute), categoryId: b.categoryId, title: b.title, tagIds: [...b.tagIds] }),
  }));
  await A.commit(`Import “${t.name}”`, changes);
}

/** Paste copied calendar blocks into a template weekday, keeping their times. */
export async function pasteIntoTemplate(weekday: number) {
  const clip = store.get().clipboard;
  if (!clip.length) return;
  const changes = clip.map((b) => {
    const iv = { start: b.startAt, end: b.endAt };
    const f = fromRefInterval(iv);
    return { type: "tblock" as const, before: null, after: newTemplateBlock({ ...f, weekday, categoryId: b.categoryId, title: b.title, notes: b.notes, tagIds: [...b.tagIds], presetId: b.presetId ?? null, icon: b.icon ?? null, color: b.color ?? null }) };
  });
  await A.commit(changes.length === 1 ? "Paste into template" : `Paste ${changes.length} blocks into template`, changes);
}

export function copyTemplateBlocks(ids: Id[]) {
  // Uses the calendar clipboard (as reference-week blocks), so a copied block pastes into the
  // template (keeping its time) or onto a real day.
  const blocks = ids
    .map(findTpl)
    .filter((t): t is WeekTemplateBlock => !!t)
    .map((t) => {
      const start = atMinute(refDay(t.weekday), t.startMinute);
      return A.newBlock({ start, end: start + t.durationMinutes * MINUTE }, t.categoryId, { title: t.title, notes: t.notes, tagIds: t.tagIds, presetId: t.presetId, icon: t.icon ?? null, color: t.color ?? null });
    });
  store.set({ clipboard: blocks });
  if (blocks.length) A.toast(blocks.length === 1 ? "Block copied" : `${blocks.length} blocks copied`);
}

// --------------------------------------------------------------- suggestions

export function daySuggestions(day: number) {
  const s = store.get();
  return suggestionsForDay(day, s.weekTemplate, s.blocks, s.dismissed, { now: Date.now(), includePast: s.settings.templateOnPast });
}

/** Turn one ghost into a real planned block on its date. Never starts a timer. */
export async function confirmSuggestion(templateBlockId: Id, day: number) {
  const tb = findTpl(templateBlockId);
  if (!tb) return;
  const s = suggestionOf(tb, day);
  const b = A.newBlock({ start: s.startAt, end: s.endAt }, tb.categoryId, blockFieldsFrom(s));
  await A.commit("Confirm suggestion", [{ type: "block", before: null, after: b }]);
  store.set({ selection: { kind: "block", id: b.id } });
  return b;
}

/** Conflicts for "apply this day's template": suggestions that overlap a real planned block. */
export function applyPlan(day: number): { clean: Suggestion[]; conflicts: Array<{ s: Suggestion; with: Block[] }> } {
  const { visible } = daySuggestions(day);
  const dayBlocks = store.get().blocks.filter((b) => b.startAt < addDays(startOfDay(day), 1) && b.endAt > startOfDay(day));
  const clean: Suggestion[] = [];
  const conflicts: Array<{ s: Suggestion; with: Block[] }> = [];
  for (const s of visible) {
    const w = conflictsWith(s, dayBlocks);
    if (w.length) conflicts.push({ s, with: w });
    else clean.push(s);
  }
  return { clean, conflicts };
}

/**
 * Confirm every unconfirmed suggestion of a day. Conflicting ones are added only when listed in
 * `alsoConflicting` (the user chose to keep both). Idempotent: confirmed and dismissed ones are skipped.
 */
export async function applyDayTemplate(day: number, alsoConflicting: Id[] = []) {
  const { clean, conflicts } = applyPlan(day);
  const pick = [...clean, ...conflicts.filter((c) => alsoConflicting.includes(c.s.tb.id)).map((c) => c.s)];
  if (!pick.length) return A.toast("Nothing to apply: every suggestion is already planned or dismissed");
  const changes = pick.map((s) => ({ type: "block" as const, before: null, after: A.newBlock({ start: s.startAt, end: s.endAt }, s.tb.categoryId, blockFieldsFrom(s)) }));
  await A.commit(`Apply template (${changes.length} ${changes.length === 1 ? "block" : "blocks"})`, changes);
  const skipped = conflicts.length - conflicts.filter((c) => alsoConflicting.includes(c.s.tb.id)).length;
  A.toast(`Planned ${changes.length} ${changes.length === 1 ? "block" : "blocks"} from the template${skipped ? `, skipped ${skipped}` : ""}`, true);
}

export async function dismissSuggestion(templateBlockId: Id, day: number) {
  await db().batch([repo.dismissStmt({ day: dayKey(day), templateBlockId, createdAt: Date.now() })]);
  await A.refresh();
}

export async function restoreSuggestions(day: number, ids?: Id[]) {
  const { dismissed } = daySuggestions(day);
  const pick = dismissed.filter((s) => !ids || ids.includes(s.tb.id));
  if (!pick.length) return;
  await db().batch(pick.map((s) => repo.undismissStmt(dayKey(day), s.tb.id)));
  await A.refresh();
  A.toast(pick.length === 1 ? "Suggestion restored" : `${pick.length} suggestions restored`);
}

/** Context menu › Edit original in Template. */
export function openInTemplate(templateBlockId: Id) {
  store.set({ view: "template", tplSelection: templateBlockId, selection: null });
}

export { weekdayOf };

// ------------------------------------------------------------- focus offer

/**
 * Start a session from a planned block. If the block came from a preset that names a focus timer
 * preset, ask first (store.focusOffer) instead of starting: the user picks it or a plain start.
 */
export async function startFromBlock(blockId: Id) {
  const s = store.get();
  const b = s.blocks.find((x) => x.id === blockId) ?? s.today.blocks.find((x) => x.id === blockId);
  const preset = b?.presetId ? s.presets.find((p) => p.id === b.presetId) : undefined;
  const fp = preset?.focusPresetId ? s.settings.focusPresets.find((f) => f.id === preset.focusPresetId) : undefined;
  if (fp && !s.running && !s.paused) {
    store.set({ focusOffer: { blockId, focusPresetId: fp.id } });
    return;
  }
  await A.startTimer({ blockId });
}

/** Answer the focus offer: "preset" applies the focus preset and starts a Pomodoro; "plain" starts as usual. */
export async function answerFocusOffer(choice: "preset" | "plain" | "cancel") {
  const offer = store.get().focusOffer;
  store.set({ focusOffer: null });
  if (!offer || choice === "cancel") return;
  if (choice === "plain") return A.startTimer({ blockId: offer.blockId });
  const fp = store.get().settings.focusPresets.find((f) => f.id === offer.focusPresetId);
  if (fp) await A.updateSettings({ pomodoroFocus: fp.focus, pomodoroBreak: fp.brk, pomodoroLongBreak: fp.long, pomodoroLongEvery: fp.every, focusTimerMode: "pomodoro" });
  await A.startTimer({ blockId: offer.blockId, mode: "pomodoro" });
}

/** Minutes the template suggests for a day that aren't planned, confirmed or dismissed (in ms). */
export function suggestedMs(day: number, dayBlocks: Block[]): number {
  const s = store.get();
  return suggestionsForDay(day, s.weekTemplate, dayBlocks, s.dismissed, { now: Date.now(), includePast: true }).visible.reduce((n, g) => n + (g.endAt - g.startAt), 0);
}

export function suggestedTodayMs(todayBlocks: Block[]): number {
  return suggestedMs(startOfDay(Date.now()), todayBlocks);
}
