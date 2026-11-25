// Statistics engine. Pure functions over blocks and sessions; no stored counters.
//
// Policies (documented in docs/ARCHITECTURE.md):
//  * Recorded time = actual sessions only, after overlap resolution, clipped to the range.
//    A running session counts up to `now`.
//  * Planned time = planned blocks that are not skipped. Never counted as recorded.
//  * Break categories are excluded from "recorded" totals and reported as "breaks".
//  * A session with several tags contributes its full duration to EACH tag's total, but
//    only once to the overall total and to its category. Tag totals are therefore
//    not additive, and the UI never sums them.
//  * Days are local calendar days; sessions that cross midnight are split.

import { resolveOverlaps } from "./overlap";
import type { Block, Category, Id, Interval, Session } from "./types";
import { addDays, clip, dayKey, parseDayKey, splitByDay, splitByHour, startOfDay, startOfMonth, startOfWeek } from "./time";

export interface StatsFilter {
  categoryIds?: Id[]; // include these categories (and their subcategories)
  tagIds?: Id[]; // include entries carrying ANY of these tags
}

export interface ResolvedPiece {
  session: Session;
  start: number;
  end: number;
}

export function expandCategoryIds(ids: Id[], categories: Category[]): Set<Id> {
  const set = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) {
      if (c.parentId && set.has(c.parentId) && !set.has(c.id)) {
        set.add(c.id);
        grew = true;
      }
    }
  }
  return set;
}

function matches(entry: { categoryId: Id; tagIds: Id[] }, catSet: Set<Id> | null, tagSet: Set<Id> | null): boolean {
  if (catSet && !catSet.has(entry.categoryId)) return false;
  if (tagSet && !entry.tagIds.some((t) => tagSet.has(t))) return false;
  return true;
}

/**
 * Resolve overlaps across ALL sessions first, then apply the filter. Filtering after
 * resolution means a filtered view never shows minutes that were attributed elsewhere.
 */
export function resolveSessions(
  sessions: Session[],
  range: Interval,
  now: number,
  filter: StatsFilter,
  categories: Category[],
): ResolvedPiece[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const segments = resolveOverlaps(
    sessions.map((s) => ({ id: s.id, start: s.startAt, end: s.endAt ?? Math.max(now, s.startAt), createdAt: s.createdAt })),
  );
  const catSet = filter.categoryIds?.length ? expandCategoryIds(filter.categoryIds, categories) : null;
  const tagSet = filter.tagIds?.length ? new Set(filter.tagIds) : null;
  const out: ResolvedPiece[] = [];
  for (const seg of segments) {
    const s = byId.get(seg.id)!;
    if (!matches(s, catSet, tagSet)) continue;
    const c = clip(seg, range);
    if (c) out.push({ session: s, start: c.start, end: c.end });
  }
  return out;
}

export function plannedPieces(blocks: Block[], range: Interval, filter: StatsFilter, categories: Category[]) {
  const catSet = filter.categoryIds?.length ? expandCategoryIds(filter.categoryIds, categories) : null;
  const tagSet = filter.tagIds?.length ? new Set(filter.tagIds) : null;
  const relevant = blocks.filter((b) => b.status !== "skipped" && matches(b, catSet, tagSet));
  const byId = new Map(relevant.map((b) => [b.id, b]));
  const segs = resolveOverlaps(relevant.map((b) => ({ id: b.id, start: b.startAt, end: b.endAt, createdAt: b.createdAt })));
  const out: Array<{ block: Block; start: number; end: number }> = [];
  for (const seg of segs) {
    const c = clip(seg, range);
    if (c) out.push({ block: byId.get(seg.id)!, start: c.start, end: c.end });
  }
  return out;
}

export type Bucket = "day" | "week" | "month";

export interface StatsResult {
  range: Interval;
  recordedMs: number; // excluding breaks
  breakMs: number;
  plannedMs: number; // excluding breaks
  focusedMs: number; // timer-based sessions (stopwatch/pomodoro/flowtime), excluding breaks
  sessionCount: number; // distinct non-break sessions touching the range
  avgSessionMs: number;
  activeDays: number; // days with any recorded (non-break) time
  avgPerActiveDayMs: number;
  avgPerDayMs: number; // averaged over elapsed days in range
  byCategory: Array<{ categoryId: Id; recordedMs: number; plannedMs: number }>;
  byTag: Array<{ tagId: Id; recordedMs: number; plannedMs: number }>;
  byDay: Map<string, Map<Id, number>>; // day -> categoryId -> ms (includes breaks)
  buckets: Array<{ key: string; start: number; byCategory: Map<Id, number>; totalMs: number; plannedMs: number }>;
  byHour: number[]; // 24 entries, ms
  byWeekday: number[]; // 7 entries (0 = Sunday), ms
}

export function computeStats(params: {
  sessions: Session[];
  blocks: Block[];
  categories: Category[];
  range: Interval;
  now: number;
  filter?: StatsFilter;
  bucket?: Bucket;
  weekStartsOn?: 0 | 1;
}): StatsResult {
  const { sessions, blocks, categories, range, now } = params;
  const filter = params.filter ?? {};
  const weekStartsOn = params.weekStartsOn ?? 1;
  const bucket = params.bucket ?? "day";
  const catById = new Map(categories.map((c) => [c.id, c]));
  const isBreak = (id: Id) => catById.get(id)?.isBreak ?? false;

  const pieces = resolveSessions(sessions, range, now, filter, categories);
  const planned = plannedPieces(blocks, range, filter, categories);

  let recordedMs = 0;
  let breakMs = 0;
  let focusedMs = 0;
  const sessionIds = new Set<Id>();
  const sessionMs = new Map<Id, number>();
  const cat = new Map<Id, { recordedMs: number; plannedMs: number }>();
  const tag = new Map<Id, { recordedMs: number; plannedMs: number }>();
  const byDay = new Map<string, Map<Id, number>>();
  const byHour = new Array(24).fill(0);
  const byWeekday = new Array(7).fill(0);
  const getCat = (id: Id) => cat.get(id) ?? (cat.set(id, { recordedMs: 0, plannedMs: 0 }), cat.get(id)!);
  const getTag = (id: Id) => tag.get(id) ?? (tag.set(id, { recordedMs: 0, plannedMs: 0 }), tag.get(id)!);

  for (const p of pieces) {
    const ms = p.end - p.start;
    const s = p.session;
    getCat(s.categoryId).recordedMs += ms;
    for (const t of s.tagIds) getTag(t).recordedMs += ms;
    for (const d of splitByDay(p)) {
      const m = byDay.get(d.day) ?? new Map<Id, number>();
      m.set(s.categoryId, (m.get(s.categoryId) ?? 0) + (d.end - d.start));
      byDay.set(d.day, m);
    }
    if (isBreak(s.categoryId)) {
      breakMs += ms;
      continue;
    }
    recordedMs += ms;
    if (s.mode !== "manual") focusedMs += ms;
    sessionIds.add(s.id);
    sessionMs.set(s.id, (sessionMs.get(s.id) ?? 0) + ms);
    for (const h of splitByHour(p)) {
      const len = h.end - h.start;
      byHour[h.hour] += len;
      byWeekday[new Date(h.start).getDay()] += len;
    }
  }

  let plannedMs = 0;
  for (const p of planned) {
    const ms = p.end - p.start;
    getCat(p.block.categoryId).plannedMs += ms;
    for (const t of p.block.tagIds) getTag(t).plannedMs += ms;
    if (!isBreak(p.block.categoryId)) plannedMs += ms;
  }

  let activeDays = 0;
  for (const [, m] of byDay) {
    let nonBreak = 0;
    for (const [cid, ms] of m) if (!isBreak(cid)) nonBreak += ms;
    if (nonBreak > 0) activeDays++;
  }
  const elapsedEnd = Math.min(range.end, addDays(startOfDay(now), 1));
  const elapsedDays = Math.max(1, Math.round((elapsedEnd - range.start) / 86_400_000));

  // Time buckets for charts
  const bucketStart = (t: number) =>
    bucket === "day" ? startOfDay(t) : bucket === "week" ? startOfWeek(t, weekStartsOn) : startOfMonth(t);
  const bucketNext = (t: number) =>
    bucket === "day" ? addDays(t, 1) : bucket === "week" ? addDays(t, 7) : new Date(new Date(t).getFullYear(), new Date(t).getMonth() + 1, 1).getTime();
  const buckets: StatsResult["buckets"] = [];
  const bucketIndex = new Map<string, number>();
  for (let t = bucketStart(range.start); t < range.end; t = bucketNext(t)) {
    bucketIndex.set(dayKey(t), buckets.length);
    buckets.push({ key: dayKey(t), start: t, byCategory: new Map(), totalMs: 0, plannedMs: 0 });
  }
  for (const [day, m] of byDay) {
    const idx = bucketIndex.get(dayKey(bucketStart(parseDayKey(day).getTime())));
    if (idx === undefined) continue;
    const b = buckets[idx];
    for (const [cid, ms] of m) {
      b.byCategory.set(cid, (b.byCategory.get(cid) ?? 0) + ms);
      if (!isBreak(cid)) b.totalMs += ms;
    }
  }

  for (const p of planned) {
    if (isBreak(p.block.categoryId)) continue;
    for (const d of splitByDay(p)) {
      const idx = bucketIndex.get(dayKey(bucketStart(parseDayKey(d.day).getTime())));
      if (idx !== undefined) buckets[idx].plannedMs += d.end - d.start;
    }
  }

  const sessionCount = sessionIds.size;
  return {
    range,
    recordedMs,
    breakMs,
    plannedMs,
    focusedMs,
    sessionCount,
    avgSessionMs: sessionCount ? recordedMs / sessionCount : 0,
    activeDays,
    avgPerActiveDayMs: activeDays ? recordedMs / activeDays : 0,
    avgPerDayMs: recordedMs / elapsedDays,
    byCategory: [...cat.entries()].map(([categoryId, v]) => ({ categoryId, ...v })).sort((a, b) => b.recordedMs - a.recordedMs),
    byTag: [...tag.entries()].map(([tagId, v]) => ({ tagId, ...v })).sort((a, b) => b.recordedMs - a.recordedMs),
    byDay,
    buckets,
    byHour,
    byWeekday,
  };
}

/** Recorded totals per category for a single day (used by sidebar + right panel). */
export function dayTotals(sessions: Session[], blocks: Block[], categories: Category[], day: number, now: number) {
  return computeStats({ sessions, blocks, categories, range: { start: startOfDay(day), end: addDays(startOfDay(day), 1) }, now });
}
