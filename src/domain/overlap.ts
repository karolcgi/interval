// Overlap policy for actual sessions.
//
// Wall-clock time can only be spent once. When recorded sessions overlap, the
// overlapping minutes are attributed to the session that STARTED MOST RECENTLY
// (you switched to it, so it is what you were doing). Ties on start time are
// broken by the latest createdAt, then by id, so the result is deterministic.
//
// The output is a list of non-overlapping segments whose total length equals the
// length of the union of the inputs. Statistics are always computed from these
// segments, so totals can never exceed real elapsed time.

export interface OverlapInput {
  id: string;
  start: number;
  end: number;
  createdAt?: number;
}

export interface Segment {
  id: string;
  start: number;
  end: number;
}

function precedence(a: OverlapInput, b: OverlapInput): number {
  // positive => a wins over b
  if (a.start !== b.start) return a.start - b.start;
  const ca = a.createdAt ?? 0;
  const cb = b.createdAt ?? 0;
  if (ca !== cb) return ca - cb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function resolveOverlaps(items: OverlapInput[]): Segment[] {
  const valid = items.filter((i) => i.end > i.start);
  if (valid.length === 0) return [];

  // Sweep over all boundaries; at each elementary span pick the winning active item.
  const points = new Set<number>();
  for (const i of valid) {
    points.add(i.start);
    points.add(i.end);
  }
  const sorted = [...points].sort((a, b) => a - b);
  const byStart = [...valid].sort((a, b) => a.start - b.start);

  const out: Segment[] = [];
  let active: OverlapInput[] = [];
  let next = 0;
  for (let p = 0; p < sorted.length - 1; p++) {
    const s = sorted[p];
    const e = sorted[p + 1];
    while (next < byStart.length && byStart[next].start <= s) active.push(byStart[next++]);
    active = active.filter((i) => i.end > s);
    if (active.length === 0) continue;
    let winner = active[0];
    for (const i of active) if (precedence(i, winner) > 0) winner = i;
    const last = out[out.length - 1];
    if (last && last.id === winner.id && last.end === s) last.end = e;
    else out.push({ id: winner.id, start: s, end: e });
  }
  return out;
}

/** Find pairs of overlapping items (for flagging in the UI). */
export function findOverlaps(items: OverlapInput[]): Array<[string, string]> {
  const sorted = [...items].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].start < sorted[i].end; j++) {
      pairs.push([sorted[i].id, sorted[j].id]);
    }
  }
  return pairs;
}
