// Time budgets: minimum targets and maximum limits for a category or tag over a period.
// Pure functions; progress is always derived from recorded sessions, never stored.

import type { Block, Budget, BudgetPeriod, Category, Interval, Session } from "./types";
import { computeStats, plannedPieces, type StatsFilter } from "./stats";
import { addDays, addMonths, startOfDay, startOfMonth, startOfWeek, startOfYear } from "./time";

export const PERIOD_LABEL: Record<BudgetPeriod, string> = { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly", lifetime: "Lifetime" };
export const PERIOD_NOUN: Record<BudgetPeriod, string> = { day: "day", week: "week", month: "month", year: "year", lifetime: "all time" };

/** The period containing `t`, shifted by `offset` periods (-1 = the previous one). */
export function periodRange(period: BudgetPeriod, t: number, weekStartsOn: 0 | 1, offset = 0, earliest = 0): Interval {
  switch (period) {
    case "day": {
      const s = addDays(startOfDay(t), offset);
      return { start: s, end: addDays(s, 1) };
    }
    case "week": {
      const s = addDays(startOfWeek(t, weekStartsOn), 7 * offset);
      return { start: s, end: addDays(s, 7) };
    }
    case "month": {
      const s = addMonths(startOfMonth(t), offset);
      return { start: s, end: addMonths(s, 1) };
    }
    case "year": {
      const y = new Date(startOfYear(t)).getFullYear() + offset;
      return { start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime() };
    }
    case "lifetime":
      return { start: Math.min(earliest, t), end: addDays(startOfDay(t), 1) };
  }
}

export function budgetFilter(b: Budget): StatsFilter {
  return b.targetType === "category" ? { categoryIds: [b.targetId] } : { tagIds: [b.targetId] };
}

export type BudgetStatus = "met" | "on_track" | "behind" | "within" | "near_limit" | "over" | "none";

export interface BudgetProgress {
  budget: Budget;
  range: Interval;
  doneMs: number;
  plannedAheadMs: number; // planned (not skipped, not done) for the rest of the period
  minMs: number | null;
  maxMs: number | null;
  remainingMs: number | null; // toward the minimum
  pct: number | null; // of the minimum (or of the maximum if there is only a maximum)
  status: BudgetStatus;
}

/**
 * Progress of one budget for the period containing `now`.
 * `sessions`/`blocks` must cover the period (and the running session, if any).
 */
export function budgetProgress(b: Budget, sessions: Session[], blocks: Block[], categories: Category[], now: number, weekStartsOn: 0 | 1, earliest = 0, offset = 0): BudgetProgress {
  const range = periodRange(b.period, now, weekStartsOn, offset, earliest);
  const filter = budgetFilter(b);
  const stats = computeStats({ sessions, blocks, categories, range, now, filter });
  // Tag budgets count every session carrying the tag once (stats.recordedMs is already de-duplicated).
  // Break categories never count toward a budget unless the budget targets that break category.
  const target = categories.find((c) => c.id === b.targetId);
  const doneMs = b.targetType === "category" && target?.isBreak ? stats.breakMs : stats.recordedMs;
  const ahead = { start: Math.max(range.start, now), end: range.end };
  const plannedAheadMs =
    ahead.end > ahead.start
      ? plannedPieces(
          blocks.filter((x) => x.status === "planned"),
          ahead,
          filter,
          categories,
        ).reduce((a, p) => a + (p.end - p.start), 0)
      : 0;
  const minMs = b.minMinutes ? b.minMinutes * 60_000 : null;
  const maxMs = b.maxMinutes ? b.maxMinutes * 60_000 : null;
  const finished = range.end <= now;
  let status: BudgetStatus = "none";
  if (maxMs !== null && doneMs > maxMs) status = "over";
  else if (minMs !== null && doneMs >= minMs) status = "met";
  else if (maxMs !== null && minMs === null) status = doneMs + plannedAheadMs > maxMs ? "near_limit" : "within";
  else if (minMs !== null) status = !finished && doneMs + plannedAheadMs >= minMs ? "on_track" : "behind";
  if (status === "met" && maxMs !== null && doneMs + plannedAheadMs > maxMs) status = "near_limit";
  const base = minMs ?? maxMs;
  return {
    budget: b,
    range,
    doneMs,
    plannedAheadMs,
    minMs,
    maxMs,
    remainingMs: minMs !== null ? Math.max(0, minMs - doneMs) : null,
    pct: base ? doneMs / base : null,
    status,
  };
}

/** Did each of the last `n` finished periods meet the budget? Oldest first. Lifetime has no history. */
export function budgetHistory(b: Budget, sessions: Session[], blocks: Block[], categories: Category[], now: number, weekStartsOn: 0 | 1, n = 8): Array<{ range: Interval; doneMs: number; ok: boolean }> {
  if (b.period === "lifetime") return [];
  const out: Array<{ range: Interval; doneMs: number; ok: boolean }> = [];
  for (let i = n; i >= 1; i--) {
    const p = budgetProgress(b, sessions, blocks, categories, now, weekStartsOn, 0, -i);
    const okMin = p.minMs === null || p.doneMs >= p.minMs;
    const okMax = p.maxMs === null || p.doneMs <= p.maxMs;
    out.push({ range: p.range, doneMs: p.doneMs, ok: okMin && okMax });
  }
  return out;
}

/** The widest window any budget (current period + history) needs, for loading data once. */
export function budgetsLoadRange(budgets: Budget[], now: number, weekStartsOn: 0 | 1, earliest: number, historyN = 8): Interval {
  let start = startOfDay(now);
  let end = addDays(startOfDay(now), 1);
  for (const b of budgets) {
    const cur = periodRange(b.period, now, weekStartsOn, 0, earliest);
    const old = b.period === "lifetime" ? cur : periodRange(b.period, now, weekStartsOn, -historyN, earliest);
    start = Math.min(start, old.start);
    end = Math.max(end, cur.end);
  }
  return { start, end };
}
