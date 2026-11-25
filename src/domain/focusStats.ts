// Focus statistics. Pure functions over sessions (what was recorded) and focus runs (how the timer ran).
//
//  * Focused time = time recorded by a timer (stopwatch, Pomodoro, Flowtime), not typed in by hand,
//    outside break categories. It goes through the same overlap resolution and midnight splitting as every
//    other statistic, so it can never exceed real elapsed time and always matches Statistics' totals.
//  * Sessions, completion, averages and cycles come from focus_runs (one row per focus phase).
//    A focus run shorter than a minute is treated as a false start and not counted.
//  * Break time = time spent in timer breaks, pauses excluded, whether or not breaks are recorded as sessions.

import { resolveSessions } from "./stats";
import type { Category, FocusRun, Id, Interval, Session } from "./types";
import { addDays, addMonths, dayKey, MINUTE, splitByDay, startOfDay, startOfMonth, startOfWeek, startOfYear } from "./time";

export type FocusBucket = "day" | "week" | "month" | "year";

export interface FocusStats {
  focusMs: number;
  sessions: number;
  completed: number;
  avgMs: number;
  cycles: number;
  breakMs: number;
  byCategory: Array<{ categoryId: Id; ms: number }>;
  byTag: Array<{ tagId: Id; ms: number }>;
  buckets: Array<{ key: string; start: number; ms: number }>;
}

const TIMER_MODES = new Set(["stopwatch", "pomodoro", "flowtime"]);

function bucketStart(t: number, b: FocusBucket, weekStartsOn: 0 | 1): number {
  if (b === "day") return startOfDay(t);
  if (b === "week") return startOfWeek(t, weekStartsOn);
  if (b === "month") return startOfMonth(t);
  return startOfYear(t);
}

function nextBucket(t: number, b: FocusBucket): number {
  if (b === "day") return addDays(t, 1);
  if (b === "week") return addDays(t, 7);
  if (b === "month") return addMonths(t, 1);
  return addMonths(t, 12);
}

export function computeFocusStats(p: {
  sessions: Session[];
  runs: FocusRun[];
  categories: Category[];
  range: Interval;
  now: number;
  bucket: FocusBucket;
  weekStartsOn: 0 | 1;
}): FocusStats {
  const breakCats = new Set(p.categories.filter((c) => c.isBreak).map((c) => c.id));
  const pieces = resolveSessions(p.sessions, p.range, p.now, {}, p.categories).filter((x) => TIMER_MODES.has(x.session.mode) && !breakCats.has(x.session.categoryId));

  let focusMs = 0;
  const byCat = new Map<Id, number>();
  const byTag = new Map<Id, number>();
  const byBucket = new Map<number, number>();
  for (const x of pieces) {
    const ms = x.end - x.start;
    focusMs += ms;
    byCat.set(x.session.categoryId, (byCat.get(x.session.categoryId) ?? 0) + ms);
    for (const t of x.session.tagIds) byTag.set(t, (byTag.get(t) ?? 0) + ms);
    for (const d of splitByDay({ start: x.start, end: x.end })) {
      const k = bucketStart(d.start, p.bucket, p.weekStartsOn);
      byBucket.set(k, (byBucket.get(k) ?? 0) + (d.end - d.start));
    }
  }

  const inRange = p.runs.filter((r) => r.startedAt >= p.range.start && r.startedAt < p.range.end);
  // A run still in progress has its time up to the last pause/transition; good enough for counts.
  const live = (r: FocusRun) => r.activeMs;
  const focusRuns = inRange.filter((r) => r.phase === "focus" && live(r) >= MINUTE);
  const completed = focusRuns.filter((r) => r.outcome === "completed").length;
  const avgMs = focusRuns.length ? focusRuns.reduce((a, r) => a + live(r), 0) / focusRuns.length : 0;
  const cycles = inRange.filter((r) => r.phase === "focus" && r.endsCycle).length;
  const breakMs = inRange.filter((r) => r.phase !== "focus").reduce((a, r) => a + live(r), 0);

  const buckets: FocusStats["buckets"] = [];
  for (let b = bucketStart(p.range.start, p.bucket, p.weekStartsOn); b < p.range.end; b = nextBucket(b, p.bucket)) {
    buckets.push({ key: dayKey(b), start: b, ms: byBucket.get(b) ?? 0 });
    if (buckets.length > 400) break;
  }

  return {
    focusMs,
    sessions: focusRuns.length,
    completed,
    avgMs,
    cycles,
    breakMs,
    byCategory: [...byCat].map(([categoryId, ms]) => ({ categoryId, ms })).sort((a, b) => b.ms - a.ms),
    byTag: [...byTag].map(([tagId, ms]) => ({ tagId, ms })).sort((a, b) => b.ms - a.ms),
    buckets,
  };
}
