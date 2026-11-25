// Long-term progression: lifetime hours per skill (tag) and area (category), milestone ladders,
// weekly consistency streaks, personal records and derived achievements.
//
// Everything here is derived from recorded sessions (after overlap resolution), never stored.
// Design rules from the spec: progress should feel earned, never reward excessive hours, and rest
// days must not break consistency. So streaks are WEEKLY (any rest pattern inside a week is fine),
// "intentional hours" count at most one working day per calendar day, and there is no daily high score.

import type { Category, Id, Interval, Session, Tag } from "./types";
import { resolveSessions } from "./stats";
import { addDays, dayKey, parseDayKey as parseKey, splitByDay, startOfDay, startOfWeek, HOUR } from "./time";

const parseDayKey = (k: string) => parseKey(k).getTime();

export const DEFAULT_LADDER = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
export const DEEP_SESSION_MS = 50 * 60_000;

export type TargetType = "category" | "tag";
export interface Target {
  type: TargetType;
  id: Id;
}
export const targetKey = (t: Target) => `${t.type}:${t.id}`;

/** day key -> ms */
export type DaySeries = Map<string, number>;

export interface Ledger {
  byTag: Map<Id, DaySeries>;
  byCategory: Map<Id, DaySeries>; // includes subcategory time under every ancestor
  intentional: DaySeries; // all non-break time
  sessionsMs: Array<{ session: Session; ms: number; day: string }>; // resolved length per session (non-break only)
  firstDay: string | null;
}

function add(series: DaySeries, day: string, ms: number) {
  series.set(day, (series.get(day) ?? 0) + ms);
}

/** One pass over all sessions: per-day totals for every tag and category. */
export function buildLedger(sessions: Session[], categories: Category[], now: number): Ledger {
  const range: Interval = { start: 0, end: Math.max(now, ...sessions.map((s) => s.endAt ?? now)) + 1 };
  const pieces = resolveSessions(sessions, range, now, {}, categories);
  const cat = new Map(categories.map((c) => [c.id, c]));
  const ancestors = (id: Id): Id[] => {
    const out: Id[] = [];
    let c = cat.get(id);
    const seen = new Set<Id>();
    while (c && !seen.has(c.id)) {
      out.push(c.id);
      seen.add(c.id);
      c = c.parentId ? cat.get(c.parentId) : undefined;
    }
    return out.length ? out : [id];
  };
  const byTag = new Map<Id, DaySeries>();
  const byCategory = new Map<Id, DaySeries>();
  const intentional: DaySeries = new Map();
  const perSession = new Map<Id, { session: Session; ms: number; day: string }>();
  let firstDay: string | null = null;
  for (const p of pieces) {
    const isBreak = !!cat.get(p.session.categoryId)?.isBreak;
    for (const part of splitByDay({ start: p.start, end: p.end })) {
      const ms = part.end - part.start;
      if (ms <= 0) continue;
      for (const a of ancestors(p.session.categoryId)) {
        if (!byCategory.has(a)) byCategory.set(a, new Map());
        add(byCategory.get(a)!, part.day, ms);
      }
      if (isBreak) continue;
      if (!firstDay || part.day < firstDay) firstDay = part.day;
      add(intentional, part.day, ms);
      for (const t of new Set(p.session.tagIds)) {
        if (!byTag.has(t)) byTag.set(t, new Map());
        add(byTag.get(t)!, part.day, ms);
      }
    }
    if (!isBreak) {
      const e = perSession.get(p.session.id);
      if (e) e.ms += p.end - p.start;
      else perSession.set(p.session.id, { session: p.session, ms: p.end - p.start, day: dayKey(p.start) });
    }
  }
  return { byTag, byCategory, intentional, sessionsMs: [...perSession.values()], firstDay };
}

export function seriesTotal(s: DaySeries | undefined): number {
  let t = 0;
  if (s) for (const v of s.values()) t += v;
  return t;
}

export function seriesIn(s: DaySeries | undefined, range: Interval): number {
  if (!s) return 0;
  const a = dayKey(range.start);
  const b = dayKey(range.end - 1);
  let t = 0;
  for (const [d, v] of s) if (d >= a && d <= b) t += v;
  return t;
}

/** Cap each day at `capMs` so long days earn no more than a full working day. */
export function capped(s: DaySeries, capMs: number): DaySeries {
  return new Map([...s].map(([d, v]) => [d, Math.min(v, capMs)]));
}

// ------------------------------------------------------------------ milestones

export interface MilestoneProgress {
  totalMs: number;
  level: number; // number of ladder steps reached
  prevHours: number; // last reached step (0 if none)
  nextHours: number | null; // next step, null when the ladder is complete
  pctToNext: number; // 0..1 between prev and next
  reached: Array<{ hours: number; day: string }>; // when each step was crossed
}

export function milestoneProgress(series: DaySeries | undefined, ladder: number[]): MilestoneProgress {
  const steps = [...new Set(ladder.filter((h) => h > 0))].sort((a, b) => a - b);
  const days = series ? [...series].sort((a, b) => (a[0] < b[0] ? -1 : 1)) : [];
  const reached: Array<{ hours: number; day: string }> = [];
  let acc = 0;
  let i = 0;
  for (const [d, v] of days) {
    acc += v;
    while (i < steps.length && acc >= steps[i] * HOUR) reached.push({ hours: steps[i++], day: d });
  }
  const prevHours = reached.length ? reached[reached.length - 1].hours : 0;
  const nextHours = i < steps.length ? steps[i] : null;
  const pctToNext = nextHours === null ? 1 : Math.max(0, Math.min(1, (acc - prevHours * HOUR) / ((nextHours - prevHours) * HOUR)));
  return { totalMs: acc, level: reached.length, prevHours, nextHours, pctToNext, reached };
}

// --------------------------------------------------------------------- streaks

export interface WeekStreak {
  current: number; // consecutive qualifying weeks up to now (this week counts once it qualifies)
  longest: number;
  longestEnd: string | null; // first day of the last week of the longest run
  /** For each run length n (1..longest), the week (first day) in which a run first reached n. */
  firstReached: Map<number, string>;
  weeks: Array<{ start: string; ms: number; ok: boolean }>; // oldest first, through the current week
}

/**
 * Weekly consistency: a week qualifies when it has at least `minMs` of the activity. Weeks are the
 * unit on purpose, so rest days, weekends and short breaks never break a streak. The current week
 * never breaks a streak while it is still running.
 */
export function weekStreak(series: DaySeries | undefined, now: number, weekStartsOn: 0 | 1, minMs = HOUR): WeekStreak {
  const thisWeek = startOfWeek(now, weekStartsOn);
  const empty: WeekStreak = { current: 0, longest: 0, longestEnd: null, firstReached: new Map(), weeks: [] };
  if (!series || series.size === 0) return empty;
  const perWeek = new Map<number, number>();
  let first = thisWeek;
  for (const [d, v] of series) {
    const w = startOfWeek(parseDayKey(d), weekStartsOn);
    if (w > thisWeek) continue;
    first = Math.min(first, w);
    perWeek.set(w, (perWeek.get(w) ?? 0) + v);
  }
  const weeks: WeekStreak["weeks"] = [];
  for (let w = first; w <= thisWeek; w = addDays(w, 7)) {
    const ms = perWeek.get(w) ?? 0;
    weeks.push({ start: dayKey(w), ms, ok: ms >= minMs });
  }
  let run = 0;
  let longest = 0;
  let longestEnd: string | null = null;
  const firstReached = new Map<number, string>();
  for (const wk of weeks) {
    run = wk.ok ? run + 1 : 0;
    if (run > 0 && !firstReached.has(run)) firstReached.set(run, wk.start);
    if (run > longest) {
      longest = run;
      longestEnd = wk.start;
    }
  }
  // Current streak: count back from this week; an unfinished, not-yet-qualifying week is skipped.
  let current = 0;
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weeks[i].ok) current++;
    else if (i === weeks.length - 1) continue;
    else break;
  }
  return { current, longest, longestEnd, firstReached, weeks };
}

// ------------------------------------------------------------------ balance

/** Weeks with at least 3 active days in which no day went over the working day. */
export function balancedWeeks(intentional: DaySeries, workdayMs: number, weekStartsOn: 0 | 1, now: number): string[] {
  const weeks = new Map<number, { active: number; over: boolean }>();
  const thisWeek = startOfWeek(now, weekStartsOn);
  for (const [d, v] of intentional) {
    const w = startOfWeek(parseDayKey(d), weekStartsOn);
    if (w >= thisWeek) continue; // only finished weeks
    const e = weeks.get(w) ?? { active: 0, over: false };
    if (v >= 15 * 60_000) e.active++;
    if (v > workdayMs + 15 * 60_000) e.over = true;
    weeks.set(w, e);
  }
  return [...weeks]
    .filter(([, e]) => e.active >= 3 && !e.over)
    .map(([w]) => dayKey(w))
    .sort();
}

// -------------------------------------------------------------------- records

export interface Records {
  longestSession: { ms: number; day: string; title: string | null; categoryId: Id } | null;
  deepSessions: number;
  bestWeek: Map<string, { ms: number; start: string }>; // per target key
}

export function longestSession(ledger: Ledger) {
  let best: Records["longestSession"] = null;
  for (const s of ledger.sessionsMs) if (!best || s.ms > best.ms) best = { ms: s.ms, day: s.day, title: s.session.title, categoryId: s.session.categoryId };
  return best;
}

export function bestWeek(series: DaySeries | undefined, weekStartsOn: 0 | 1): { ms: number; start: string } | null {
  if (!series) return null;
  const per = new Map<number, number>();
  for (const [d, v] of series) {
    const w = startOfWeek(parseDayKey(d), weekStartsOn);
    per.set(w, (per.get(w) ?? 0) + v);
  }
  let best: { ms: number; start: string } | null = null;
  for (const [w, ms] of per) if (!best || ms > best.ms) best = { ms, start: dayKey(w) };
  return best;
}

/** Sessions of at least 50 minutes, oldest first, with the day each was recorded. */
export function deepSessions(ledger: Ledger): string[] {
  return ledger.sessionsMs
    .filter((s) => s.ms >= DEEP_SESSION_MS)
    .map((s) => s.day)
    .sort();
}

// ---------------------------------------------------------------- achievements

export type AchievementKind = "milestone" | "lifetime" | "streak" | "deep" | "balance";

export interface Achievement {
  id: string; // stable, e.g. "milestone:tag:abc:100"
  kind: AchievementKind;
  title: string;
  detail: string;
  day: string | null; // when earned; null = not yet
  progress?: { value: number; goal: number; unit: "h" | "weeks" | "sessions" };
  color?: string;
}

const LIFETIME_STEPS = [100, 250, 500, 1000, 2500, 5000, 10000];
const STREAK_STEPS = [4, 8, 12, 26, 52];
const DEEP_STEPS = [10, 50, 100, 250, 500, 1000];
const BALANCE_STEPS = [4, 12, 26, 52];

function tiers<T extends number>(steps: T[], dayOf: (step: T) => string | null, make: (step: T, day: string | null) => Achievement): Achievement[] {
  const out: Achievement[] = [];
  for (const s of steps) {
    const day = dayOf(s);
    if (day) out.push(make(s, day));
    else {
      out.push(make(s, null)); // the next locked tier, with progress
      break;
    }
  }
  return out;
}

const fmtN = (n: number) => n.toLocaleString("en-GB");

/**
 * All automatic achievements: earned ones (with the day) plus the next locked tier of each family.
 * Skills (tags) and areas (categories) get hour milestones and 4/8/12/26/52-week streaks.
 */
export function deriveAchievements(p: {
  ledger: Ledger;
  categories: Category[];
  tags: Tag[];
  ladder: number[];
  workdayHours: number;
  weekStartsOn: 0 | 1;
  now: number;
  hidden?: Set<string>; // target keys excluded from progression
}): Achievement[] {
  const { ledger, ladder, weekStartsOn, now } = p;
  const out: Achievement[] = [];
  const hidden = p.hidden ?? new Set<string>();
  const targets: Array<{ t: Target; name: string; color?: string; series: DaySeries }> = [];
  for (const c of p.categories) {
    if (c.isBreak || c.archivedAt) continue;
    const s = ledger.byCategory.get(c.id);
    if (s && !hidden.has(targetKey({ type: "category", id: c.id }))) targets.push({ t: { type: "category", id: c.id }, name: c.name, color: c.color, series: s });
  }
  for (const tg of p.tags) {
    const s = ledger.byTag.get(tg.id);
    if (s && !hidden.has(targetKey({ type: "tag", id: tg.id }))) targets.push({ t: { type: "tag", id: tg.id }, name: tg.name, series: s });
  }

  for (const x of targets) {
    const mp = milestoneProgress(x.series, ladder);
    for (const r of mp.reached)
      out.push({ id: `milestone:${targetKey(x.t)}:${r.hours}`, kind: "milestone", title: `First ${fmtN(r.hours)} hours of ${x.name}`, detail: `${x.name} passed ${fmtN(r.hours)} lifetime hours`, day: r.day, color: x.color });
    if (mp.nextHours !== null)
      out.push({
        id: `milestone:${targetKey(x.t)}:${mp.nextHours}`,
        kind: "milestone",
        title: `First ${fmtN(mp.nextHours)} hours of ${x.name}`,
        detail: `${x.name} reaches ${fmtN(mp.nextHours)} lifetime hours`,
        day: null,
        progress: { value: mp.totalMs / HOUR, goal: mp.nextHours, unit: "h" },
        color: x.color,
      });
    const st = weekStreak(x.series, now, weekStartsOn);
    if (st.longest >= 2 || st.current >= 1)
      out.push(
        ...tiers(
          STREAK_STEPS,
          (n) => st.firstReached.get(n) ?? null,
          (n, day) => ({
            id: `streak:${targetKey(x.t)}:${n}`,
            kind: "streak",
            title: `${n} consecutive weeks of ${x.name}`,
            detail: `At least an hour of ${x.name} every week for ${n} weeks`,
            day: day ? dayKey(addDays(parseDayKey(day), 6)) : null,
            progress: day ? undefined : { value: st.current, goal: n, unit: "weeks" },
            color: x.color,
          }),
        ),
      );
  }

  // Lifetime intentional hours, counted up to one working day per day.
  const intentional = capped(ledger.intentional, p.workdayHours * HOUR);
  const lp = milestoneProgress(intentional, LIFETIME_STEPS);
  out.push(
    ...tiers(
      LIFETIME_STEPS,
      (h) => lp.reached.find((r) => r.hours === h)?.day ?? null,
      (h, day) => ({
        id: `lifetime:${h}`,
        kind: "lifetime",
        title: `First ${fmtN(h)} hours of intentional activity`,
        detail: `All recorded time except breaks, counting at most ${p.workdayHours}h a day`,
        day,
        progress: day ? undefined : { value: lp.totalMs / HOUR, goal: h, unit: "h" },
      }),
    ),
  );

  const deep = deepSessions(ledger);
  out.push(
    ...tiers(
      DEEP_STEPS,
      (n) => deep[n - 1] ?? null,
      (n, day) => ({
        id: `deep:${n}`,
        kind: "deep",
        title: `${fmtN(n)} deep work sessions`,
        detail: "Sessions of 50 minutes or more",
        day,
        progress: day ? undefined : { value: deep.length, goal: n, unit: "sessions" },
      }),
    ),
  );

  const balanced = balancedWeeks(ledger.intentional, p.workdayHours * HOUR, weekStartsOn, now);
  out.push(
    ...tiers(
      BALANCE_STEPS,
      (n) => (balanced[n - 1] ? dayKey(addDays(parseDayKey(balanced[n - 1]), 6)) : null),
      (n, day) => ({
        id: `balance:${n}`,
        kind: "balance",
        title: `${n} balanced weeks`,
        detail: `Weeks with 3+ active days where no day ran past ${p.workdayHours}h`,
        day,
        progress: day ? undefined : { value: balanced.length, goal: n, unit: "weeks" },
      }),
    ),
  );
  return out;
}

/** Earned achievements whose day falls inside `range`, newest first. */
export function earnedIn(achievements: Achievement[], range: Interval): Achievement[] {
  const a = dayKey(range.start);
  const b = dayKey(range.end - 1);
  return achievements.filter((x) => x.day && x.day >= a && x.day <= b).sort((x, y) => (x.day! < y.day! ? 1 : -1));
}

export function todayKey(now: number) {
  return dayKey(startOfDay(now));
}
