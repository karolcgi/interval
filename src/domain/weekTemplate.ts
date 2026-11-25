// The weekly template (v0.7): one generic Monday–Sunday week. Pure functions only.
//
// Three layers of time stay separate:
//   Template  week_template_blocks: a weekday + local time. Suggestions ("ghosts") on real days are
//             computed here at render time and never stored, so they can't reach any statistic.
//   Plan      blocks: confirmed intentions on a date (a confirmed suggestion is an independent copy
//             that remembers its source in `templateBlockId`, which hides that suggestion on its day).
//   Actual    sessions.
//
// The Template editor reuses the calendar timeline by placing template blocks on a fixed reference
// week (Mon 1 Jan 2024 – Sun 7 Jan 2024, no DST change in any common zone that week).

import type { Block, Id, Interval, WeekTemplateBlock } from "./types";
import { addDays, atMinute, dayKey, minuteOfDay, MINUTE, startOfDay } from "./time";

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** 0 = Monday … 6 = Sunday, for a local day. */
export function weekdayOf(t: number): number {
  return (new Date(t).getDay() + 6) % 7;
}

/** Local midnight of the reference week's day for a weekday. */
export function refDay(weekday: number): number {
  return startOfDay(new Date(2024, 0, 1 + weekday).getTime());
}

export const REF_WEEK: number[] = Array.from({ length: 7 }, (_, i) => refDay(i));

export function isRefWeekDay(day: number): boolean {
  return REF_WEEK.includes(startOfDay(day));
}

/** A template block as a Block on the reference week, so the timeline can draw and edit it. */
export function toRefBlock(t: WeekTemplateBlock): Block {
  const start = atMinute(refDay(t.weekday), t.startMinute);
  return {
    id: t.id,
    startAt: start,
    endAt: start + t.durationMinutes * MINUTE,
    tz: "",
    categoryId: t.categoryId,
    title: t.title,
    notes: t.notes,
    link: null,
    status: "planned",
    recurrenceId: null,
    tagIds: t.tagIds,
    presetId: t.presetId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/** Weekday, start and duration for an interval drawn on the reference week. Clipped to its day. */
export function fromRefInterval(iv: Interval): Pick<WeekTemplateBlock, "weekday" | "startMinute" | "durationMinutes"> {
  const day = startOfDay(iv.start);
  const startMinute = minuteOfDay(iv.start);
  const end = Math.min(iv.end, addDays(day, 1));
  const durationMinutes = Math.max(1, Math.min(1440 - startMinute, Math.round((end - iv.start) / MINUTE)));
  return { weekday: weekdayOf(day), startMinute, durationMinutes };
}

export interface Suggestion {
  tb: WeekTemplateBlock;
  day: number; // local midnight
  startAt: number;
  endAt: number;
}

export const dismissKey = (day: number | string, templateBlockId: Id) => `${typeof day === "string" ? day : dayKey(day)}|${templateBlockId}`;

export function suggestionOf(tb: WeekTemplateBlock, day: number): Suggestion {
  const startAt = atMinute(startOfDay(day), tb.startMinute);
  return { tb, day: startOfDay(day), startAt, endAt: startAt + tb.durationMinutes * MINUTE };
}

/**
 * Suggestions for one local day. `visible` are the ghosts to draw; `dismissed` were hidden for this
 * date and can be restored; `confirmed` already have a planned block made from them on this date.
 * Past days get none unless `includePast` (today is never past).
 */
export function suggestionsForDay(
  day: number,
  template: WeekTemplateBlock[],
  blocks: Block[],
  dismissed: ReadonlySet<string>,
  opts: { now: number; includePast: boolean },
): { visible: Suggestion[]; dismissed: Suggestion[]; confirmed: Suggestion[] } {
  const d = startOfDay(day);
  const out = { visible: [] as Suggestion[], dismissed: [] as Suggestion[], confirmed: [] as Suggestion[] };
  if (!opts.includePast && d < startOfDay(opts.now)) return out;
  const key = dayKey(d);
  const linked = new Set(blocks.filter((b) => b.templateBlockId && dayKey(b.startAt) === key).map((b) => b.templateBlockId));
  for (const tb of template) {
    if (tb.weekday !== weekdayOf(d)) continue;
    const s = suggestionOf(tb, d);
    if (linked.has(tb.id)) out.confirmed.push(s);
    else if (dismissed.has(dismissKey(key, tb.id))) out.dismissed.push(s);
    else out.visible.push(s);
  }
  out.visible.sort((a, b) => a.startAt - b.startAt);
  return out;
}

/** Real planned blocks (not skipped) that overlap a suggestion. */
export function conflictsWith(s: Suggestion, blocks: Block[]): Block[] {
  return blocks.filter((b) => b.status !== "skipped" && b.startAt < s.endAt && b.endAt > s.startAt);
}

/** The copy a confirmed suggestion becomes: the template block's properties, on this date. */
export function blockFieldsFrom(s: Suggestion): Pick<Block, "startAt" | "endAt" | "categoryId" | "title" | "notes" | "tagIds" | "presetId" | "templateBlockId"> {
  return {
    startAt: s.startAt,
    endAt: s.endAt,
    categoryId: s.tb.categoryId,
    title: s.tb.title,
    notes: s.tb.notes,
    tagIds: [...s.tb.tagIds],
    presetId: s.tb.presetId,
    templateBlockId: s.tb.id,
  };
}

/** Intended minutes per weekday and per category for the whole week. Never mixed with recorded time. */
export function templateTotals(template: WeekTemplateBlock[]): { byDay: number[]; byCategory: Map<Id, number>; total: number } {
  const byDay = [0, 0, 0, 0, 0, 0, 0];
  const byCategory = new Map<Id, number>();
  let total = 0;
  for (const t of template) {
    byDay[t.weekday] += t.durationMinutes;
    byCategory.set(t.categoryId, (byCategory.get(t.categoryId) ?? 0) + t.durationMinutes);
    total += t.durationMinutes;
  }
  return { byDay, byCategory, total };
}
