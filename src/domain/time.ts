// Calendar math in the user's local time zone.
//
// Rule of thumb used throughout the app:
//  * Storage and durations use absolute UTC milliseconds (DST-safe by construction).
//  * Day boundaries, week boundaries and timeline positions use local wall-clock time,
//    computed through the JS Date local-time API, which applies the OS zone and DST rules.
//  * A "day key" is a local calendar date string, YYYY-MM-DD.

import type { Interval } from "./types";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function dayKey(t: number | Date): string {
  const d = typeof t === "number" ? new Date(t) : t;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Local midnight at the start of the day containing t. */
export function startOfDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local midnight `n` calendar days after the day containing t (DST-aware: not t + n*24h). */
export function addDays(t: number, n: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

/** Same wall-clock time `n` calendar days later. */
export function shiftDaysKeepClock(t: number, n: number): number {
  const d = new Date(t);
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + n,
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
  ).getTime();
}

export function endOfDay(t: number): number {
  return addDays(t, 1);
}

export function startOfWeek(t: number, weekStartsOn: 0 | 1): number {
  const d = new Date(startOfDay(t));
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  return addDays(d.getTime(), -diff);
}

export function startOfMonth(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function addMonths(t: number, n: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
}

export function startOfQuarter(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1).getTime();
}

export function startOfYear(t: number): number {
  return new Date(new Date(t).getFullYear(), 0, 1).getTime();
}

export function isSameDay(a: number, b: number): boolean {
  return dayKey(a) === dayKey(b);
}

/** Minutes since local midnight by wall clock (what the timeline displays). */
export function minuteOfDay(t: number): number {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/** Build a timestamp from a local day and a wall-clock minute offset. Minute 1440 = next midnight. */
export function atMinute(dayStart: number, minute: number): number {
  const d = new Date(dayStart);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, Math.round(minute)).getTime();
}

/** Number of hours in the local day (23 or 25 on DST transition days). */
export function hoursInDay(dayStart: number): number {
  return Math.round((addDays(dayStart, 1) - startOfDay(dayStart)) / HOUR);
}

export function overlap(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

export function clip(iv: Interval, range: Interval): Interval | null {
  const start = Math.max(iv.start, range.start);
  const end = Math.min(iv.end, range.end);
  return end > start ? { start, end } : null;
}

/**
 * Split an interval at local midnights. A session from 23:00 to 01:30 becomes
 * [23:00, 00:00) on day 1 and [00:00, 01:30) on day 2.
 */
export function splitByDay(iv: Interval): Array<Interval & { day: string }> {
  const out: Array<Interval & { day: string }> = [];
  let cursor = iv.start;
  while (cursor < iv.end) {
    const next = Math.min(addDays(cursor, 1), iv.end);
    out.push({ start: cursor, end: next, day: dayKey(cursor) });
    cursor = next;
  }
  return out;
}

/** Split an interval at local hour boundaries (for hour-of-day charts). */
export function splitByHour(iv: Interval): Array<Interval & { hour: number }> {
  const out: Array<Interval & { hour: number }> = [];
  let cursor = iv.start;
  while (cursor < iv.end) {
    const d = new Date(cursor);
    const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
    const next = Math.min(nextHour, iv.end);
    out.push({ start: cursor, end: next, hour: d.getHours() });
    cursor = next;
  }
  return out;
}

export function eachDay(range: Interval): number[] {
  const days: number[] = [];
  for (let t = startOfDay(range.start); t < range.end; t = addDays(t, 1)) days.push(t);
  return days;
}

export function currentTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// ---------------------------------------------------------------------------
// Named date ranges for statistics

export type RangePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "this_year"
  | "last_year"
  | "all_time"
  | "custom";

export const RANGE_LABELS: Record<RangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  this_year: "This year",
  last_year: "Last year",
  all_time: "All time",
  custom: "Custom",
};

/**
 * Resolve a preset to a half-open local-time interval.
 * "This week" etc. cover the whole period (including the future part), but
 * actual time can only exist up to now, so totals are unaffected.
 */
export function resolveRange(
  preset: RangePreset,
  now: number,
  weekStartsOn: 0 | 1,
  custom?: { from: string; to: string },
  allTimeStart?: number,
): Interval {
  const today = startOfDay(now);
  switch (preset) {
    case "today":
      return { start: today, end: addDays(today, 1) };
    case "yesterday":
      return { start: addDays(today, -1), end: today };
    case "this_week": {
      const s = startOfWeek(now, weekStartsOn);
      return { start: s, end: addDays(s, 7) };
    }
    case "last_week": {
      const s = startOfWeek(now, weekStartsOn);
      return { start: addDays(s, -7), end: s };
    }
    case "this_month": {
      const s = startOfMonth(now);
      return { start: s, end: addMonths(s, 1) };
    }
    case "last_month": {
      const s = startOfMonth(now);
      return { start: addMonths(s, -1), end: s };
    }
    case "this_quarter": {
      const s = startOfQuarter(now);
      return { start: s, end: addMonths(s, 3) };
    }
    case "this_year": {
      const s = startOfYear(now);
      return { start: s, end: new Date(new Date(s).getFullYear() + 1, 0, 1).getTime() };
    }
    case "last_year": {
      const s = startOfYear(now);
      return { start: new Date(new Date(s).getFullYear() - 1, 0, 1).getTime(), end: s };
    }
    case "all_time":
      return { start: startOfDay(allTimeStart ?? today), end: addDays(today, 1) };
    case "custom": {
      if (!custom) return { start: today, end: addDays(today, 1) };
      const a = parseDayKey(custom.from).getTime();
      const b = parseDayKey(custom.to).getTime();
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return { start: lo, end: addDays(hi, 1) }; // inclusive of the end day
    }
  }
}

/** The period immediately preceding `range`, of the same calendar shape where possible. */
export function previousRange(range: Interval): Interval {
  const days = Math.round((range.end - range.start) / DAY);
  const s = new Date(range.start);
  const e = new Date(range.end);
  const monthAligned = s.getDate() === 1 && e.getDate() === 1 && s.getHours() === 0;
  if (monthAligned) {
    const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
    return { start: addMonths(range.start, -months), end: range.start };
  }
  return { start: addDays(range.start, -days), end: range.start };
}
