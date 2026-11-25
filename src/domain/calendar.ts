// Pure calendar-editing operations. The UI turns pointer gestures into calls to these
// functions, so every interaction rule (snapping, minimum duration, splitting, merging)
// is unit-testable without a DOM.

import type { Block, Interval } from "./types";
import { MINUTE, atMinute, minuteOfDay, startOfDay } from "./time";

export const MIN_BLOCK_MINUTES = 5;

export function snapMinute(minute: number, snap: number): number {
  return Math.round(minute / snap) * snap;
}

export function clampMinute(minute: number): number {
  return Math.max(0, Math.min(24 * 60, minute));
}

/** Convert a vertical pixel offset in a day column to a snapped wall-clock minute. */
export function pxToMinute(y: number, hourHeight: number, firstHour: number, snap: number): number {
  return clampMinute(snapMinute(firstHour * 60 + (y / hourHeight) * 60, snap));
}

export function minuteToPx(minute: number, hourHeight: number, firstHour: number): number {
  return ((minute - firstHour * 60) / 60) * hourHeight;
}

/** Normalised interval from a drag between two minutes on the same day. */
export function dragToInterval(dayStart: number, fromMinute: number, toMinute: number, snap: number): Interval {
  let a = Math.min(fromMinute, toMinute);
  let b = Math.max(fromMinute, toMinute);
  if (b - a < snap) b = a + snap;
  if (b > 1440) {
    b = 1440;
    a = Math.min(a, b - snap);
  }
  return { start: atMinute(dayStart, a), end: atMinute(dayStart, b) };
}

/**
 * Move an interval so that it starts at `newStartMinute` on `targetDayStart`,
 * preserving its absolute duration.
 */
export function moveInterval(iv: Interval, targetDayStart: number, newStartMinute: number): Interval {
  const dur = iv.end - iv.start;
  const start = atMinute(targetDayStart, newStartMinute);
  return { start, end: start + dur };
}

export type Edge = "start" | "end";

/** Resize one edge to a snapped minute on the interval's own day, keeping a minimum length. */
export function resizeInterval(iv: Interval, edge: Edge, minute: number, snap: number): Interval {
  const minLen = Math.max(MIN_BLOCK_MINUTES, snap) * MINUTE;
  if (edge === "start") {
    const day = startOfDay(iv.start);
    const start = Math.min(atMinute(day, minute), iv.end - minLen);
    return { start, end: iv.end };
  }
  const day = startOfDay(iv.start);
  // Allow dragging the end to midnight (minute 1440) of the same day.
  const end = Math.max(atMinute(day, minute), iv.start + minLen);
  return { start: iv.start, end };
}

/** Split at a timestamp. Returns null if the split point would create a sliver. */
export function splitInterval(iv: Interval, at: number, minMinutes = MIN_BLOCK_MINUTES): [Interval, Interval] | null {
  const min = minMinutes * MINUTE;
  if (at - iv.start < min || iv.end - at < min) return null;
  return [
    { start: iv.start, end: at },
    { start: at, end: iv.end },
  ];
}

/** Snapped midpoint, used by "Split in half". */
export function splitPoint(iv: Interval, snap: number): number {
  const mid = iv.start + (iv.end - iv.start) / 2;
  const day = startOfDay(iv.start);
  return atMinute(day, snapMinute(minuteOfDay(mid), snap));
}

/** Two blocks can merge if they share a category and touch (or overlap). */
export function canMerge(a: Block, b: Block): boolean {
  if (a.categoryId !== b.categoryId) return false;
  const [first, second] = a.startAt <= b.startAt ? [a, b] : [b, a];
  return second.startAt <= first.endAt;
}

export function mergedInterval(a: Interval, b: Interval): Interval {
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

/** Find the next block (by start) that can merge with `block`, if any. */
export function findMergeCandidate(block: Block, all: Block[]): Block | null {
  const candidates = all
    .filter((b) => b.id !== block.id && canMerge(block, b))
    .sort((x, y) => Math.abs(x.startAt - block.endAt) - Math.abs(y.startAt - block.endAt));
  return candidates[0] ?? null;
}

/** Lay out overlapping items side by side in columns (classic calendar algorithm). */
export function layoutColumns<T extends { id: string; startAt: number; endAt: number }>(
  items: T[],
): Map<string, { col: number; cols: number }> {
  const sorted = [...items].sort((a, b) => a.startAt - b.startAt || b.endAt - a.endAt);
  const result = new Map<string, { col: number; cols: number }>();
  let cluster: T[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const colEnds: number[] = [];
    const assigned: Array<[T, number]> = [];
    for (const it of cluster) {
      let col = colEnds.findIndex((end) => end <= it.startAt);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(it.endAt);
      } else colEnds[col] = it.endAt;
      assigned.push([it, col]);
    }
    for (const [it, col] of assigned) result.set(it.id, { col, cols: colEnds.length });
    cluster = [];
    clusterEnd = -Infinity;
  };
  for (const it of sorted) {
    if (it.startAt >= clusterEnd && cluster.length) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endAt);
  }
  if (cluster.length) flush();
  return result;
}
