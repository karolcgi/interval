// Heatmap and consistency helpers. Pure functions over StatsResult.
import type { Category } from "./types";
import type { StatsResult } from "./stats";
import { addDays, dayKey } from "./time";

export interface HeatDay {
  day: number;
  ms: number;
}

/** Days of the last 53 weeks (aligned to the week start) with recorded, non-break time. */
export function heatmapDays(stats: StatsResult, start: number, end: number, categories: Category[]): HeatDay[] {
  const isBreak = new Set(categories.filter((c) => c.isBreak).map((c) => c.id));
  const out: HeatDay[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) {
    const m = stats.byDay.get(dayKey(d));
    let ms = 0;
    if (m) for (const [cid, v] of m) if (!isBreak.has(cid)) ms += v;
    out.push({ day: d, ms });
  }
  return out;
}

/** Longest and current runs of days with recorded time. Purely informational: nothing is lost by a day off. */
export function activeRuns(days: HeatDay[], today: number): { longest: number; current: number; active: number } {
  let longest = 0;
  let run = 0;
  let active = 0;
  for (const d of days) {
    if (d.day > today) break;
    if (d.ms > 0) {
      run++;
      active++;
      longest = Math.max(longest, run);
    } else if (d.day !== today) run = 0; // an empty today doesn't break the current run yet
  }
  return { longest, current: run, active };
}

