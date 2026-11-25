// Focus timer: pure state, transitions and the read-only view every window renders.
//
// One timer exists at a time. Its state (FocusState) is persisted in settings (`timer.focus`) and
// every transition is written in the same transaction as the sessions it opens or closes, so a crash
// can never leave a half-applied transition behind (see state/focus.ts).
//
// Time is derived from stored timestamps only:
//   active(t)  = activeMs + (t - segStart)      while running (segStart !== null)
//   deadline   = segStart + (phaseMs - activeMs) for countdown phases
// Nothing is ever decremented, so the timer stays exact when the window is hidden, the machine is
// busy, or the app restarts.
//
// Modes
//   pomodoro  focus N min -> break M min (a long break after every K rounds) -> ...
//   flowtime  focus counts up; stopping suggests a break proportional to the focus length
//   stopwatch counts up until you stop; no breaks

import type { Id } from "./types";
import { MINUTE } from "./time";

export type FocusKind = "pomodoro" | "flowtime" | "stopwatch";

/**
 * focus    working (running or paused)
 * break    on a break (running or paused)
 * suggest  a focus phase ended and the break has not started yet (auto-start breaks off, Flowtime stop)
 * ready    a break ended and the next focus round has not started yet (auto-start focus off)
 * done     the Pomodoro cycle is complete; a summary shows until a new timer starts
 */
export type FocusPhase = "focus" | "break" | "suggest" | "ready" | "done";
export type BreakKind = "short" | "long";

export interface PomodoroPreset {
  focus: number; // minutes
  brk: number;
  long: number;
  every: number; // a long break after this many focus rounds
}

export interface FocusPreset extends PomodoroPreset {
  id: string;
  builtIn?: boolean;
}

export const POMODORO_PRESETS: PomodoroPreset[] = [
  { focus: 25, brk: 5, long: 15, every: 4 },
  { focus: 50, brk: 10, long: 20, every: 3 },
  { focus: 90, brk: 15, long: 30, every: 2 },
];

export const DEFAULT_FOCUS_PRESETS: FocusPreset[] = POMODORO_PRESETS.map((p) => ({ ...p, id: `builtin-${p.focus}`, builtIn: true }));

/** What the last finished phase was, for the completion popup and the "extend" actions. */
export interface CompletedPhase {
  phase: "focus" | "break";
  runId: Id;
  breakKind: BreakKind | null;
  activeMs: number; // time actually spent in it (pauses excluded)
  phaseMs: number | null; // its planned length
  at: number; // when it ended
  outcome: "completed" | "skipped";
  sessionId: Id | null; // the last recorded segment, if any
  cycleDone: boolean; // this focus completed a full Pomodoro cycle
  round: number; // rounds completed in the cycle when it ended
  cycleId: Id;
}

export interface FocusState {
  kind: FocusKind;
  phase: FocusPhase;
  preset: PomodoroPreset;
  cycleId: Id;
  runId: Id | null; // focus_runs row of the current focus/break phase
  rev: number; // bumped on every transition; commands from other windows carry it to avoid double actions
  round: number; // focus rounds completed in this cycle
  breakKind: BreakKind | null; // current or upcoming break
  phaseStart: number; // when the current phase began
  phaseMs: number | null; // planned length (countdown phases), including extensions
  activeMs: number; // time spent in the phase before the current segment
  segStart: number | null; // start of the running segment; null while paused or waiting
  phaseEnd: number | null; // deadline while a countdown runs (derived, kept for the tray and wake-ups)
  pausedRemaining: number | null; // ms left while a countdown is paused (derived)
  suggestedBreakMin: number | null; // length of the upcoming break (suggest phase)
  recorded: boolean; // the current phase writes sessions (breaks only when "record breaks" is on)
  completed: CompletedPhase | null;
  // What the focus rounds are about, so every round starts with the same details.
  categoryId: Id;
  tagIds: Id[];
  title: string | null;
  blockId: Id | null;
}

/** Flowtime's commonly used break table: longer focus earns a longer break. */
export function flowtimeBreakMinutes(focusMs: number): number {
  const m = focusMs / MINUTE;
  if (m < 25) return 5;
  if (m < 50) return 8;
  if (m < 90) return 10;
  return 15;
}

export function breakKindAfter(preset: PomodoroPreset, roundsDone: number): BreakKind {
  return roundsDone > 0 && roundsDone % Math.max(1, preset.every) === 0 ? "long" : "short";
}

export function breakLength(preset: PomodoroPreset, roundsDone: number): number {
  return breakKindAfter(preset, roundsDone) === "long" ? preset.long : preset.brk;
}

export function isActivePhase(f: FocusState | null): f is FocusState & { phase: "focus" | "break" } {
  return !!f && (f.phase === "focus" || f.phase === "break");
}

export function isPaused(f: FocusState | null): boolean {
  return isActivePhase(f) && f.segStart === null;
}

/** Time spent in the current phase at `t`, pauses excluded. */
export function activeAt(f: FocusState, t: number): number {
  return f.activeMs + (f.segStart !== null ? Math.max(0, t - f.segStart) : 0);
}

/** Deadline of a running countdown, or null. */
export function deadlineOf(f: FocusState | null): number | null {
  if (!f || !isActivePhase(f) || f.segStart === null || f.phaseMs === null) return null;
  return f.segStart + Math.max(0, f.phaseMs - f.activeMs);
}

/** Keeps the derived fields (phaseEnd, pausedRemaining) in step with the source fields. */
export function derive(f: FocusState): FocusState {
  const end = deadlineOf(f);
  const pausedRemaining = isActivePhase(f) && f.segStart === null && f.phaseMs !== null ? Math.max(0, f.phaseMs - f.activeMs) : null;
  return { ...f, phaseEnd: end, pausedRemaining };
}

/** Remaining ms in the current phase (null if the phase has no deadline). */
export function remaining(f: FocusState, now: number): number | null {
  if (!isActivePhase(f) || f.phaseMs === null) return null;
  return Math.max(0, f.phaseMs - activeAt(f, now));
}

/**
 * Upgrades a state persisted by an older version (v0.2/v0.3 stored phaseStart/phaseEnd/pausedRemaining only).
 * Returns null for anything unreadable, which simply means "no timer".
 */
export function normalizeFocus(raw: unknown, now = Date.now()): FocusState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<FocusState> & Record<string, unknown>;
  if (!o.kind || !o.phase || !o.categoryId) return null;
  if (typeof o.activeMs === "number" && "segStart" in o) {
    const full = o as FocusState;
    return derive({ ...full, completed: full.completed ?? null, recorded: full.recorded ?? true, rev: full.rev ?? 0, breakKind: full.breakKind ?? null });
  }
  const preset = o.preset ?? POMODORO_PRESETS[0];
  const round = Number(o.round ?? 0);
  const phaseStart = Number(o.phaseStart ?? now);
  let phaseMs: number | null = null;
  let activeMs = 0;
  let segStart: number | null = null;
  const breakKind = o.phase === "break" ? breakKindAfter(preset, round) : null;
  if (o.phase === "focus" || o.phase === "break") {
    if (o.phaseEnd != null || o.pausedRemaining != null) phaseMs = o.phase === "focus" ? preset.focus * MINUTE : (breakKind === "long" ? preset.long : preset.brk) * MINUTE;
    if (o.pausedRemaining != null) {
      activeMs = phaseMs !== null ? Math.max(0, phaseMs - Number(o.pausedRemaining)) : 0;
    } else if (o.phaseEnd != null && phaseMs !== null) {
      // Running countdown: pick segStart so that the stored deadline is kept exactly.
      segStart = Number(o.phaseEnd) - phaseMs;
    } else {
      segStart = phaseStart;
    }
  }
  return derive({
    kind: o.kind as FocusKind,
    phase: o.phase as FocusPhase,
    preset,
    cycleId: String(o.cycleId ?? `legacy-${phaseStart}`),
    runId: null,
    rev: 0,
    round,
    breakKind,
    phaseStart,
    phaseMs,
    activeMs,
    segStart,
    phaseEnd: null,
    pausedRemaining: null,
    suggestedBreakMin: (o.suggestedBreakMin as number | null) ?? null,
    recorded: true,
    completed: null,
    categoryId: String(o.categoryId),
    tagIds: Array.isArray(o.tagIds) ? (o.tagIds as Id[]) : [],
    title: (o.title as string | null) ?? null,
    blockId: (o.blockId as Id | null) ?? null,
  });
}

// --------------------------------------------------------------------------------------- view

/** The seven user-facing states. */
export type TimerStatus = "idle" | "focusing" | "focus_paused" | "short_break" | "long_break" | "break_paused" | "completed";

export const STATUS_LABEL: Record<TimerStatus, string> = {
  idle: "Ready",
  focusing: "Focus",
  focus_paused: "Focus paused",
  short_break: "Short break",
  long_break: "Long break",
  break_paused: "Break paused",
  completed: "Completed",
};

export function timerStatus(f: FocusState | null, sessionActive = false): TimerStatus {
  if (!f) return sessionActive ? "focusing" : "idle";
  if (f.phase === "focus") return f.segStart === null ? "focus_paused" : "focusing";
  if (f.phase === "break") return f.segStart === null ? "break_paused" : f.breakKind === "long" ? "long_break" : "short_break";
  return "completed";
}

/**
 * Everything a timer surface needs, as plain data. The main window computes it and broadcasts it;
 * the mini timer, the completion popup and the tray render it without running a timer of their own.
 */
export interface TimerSnapshot {
  rev: number;
  status: TimerStatus;
  kind: FocusKind | null;
  phase: FocusPhase | null;
  label: string; // "Focus 2 of 4", "Short break", "Stopwatch", "Break over" ...
  next: string | null; // "Short break · 5 min", "Focus 3 of 4" ...
  // Clock: while running, remaining = endsAt - now (countdown) or elapsed = baseMs + now - since (count-up).
  countdown: boolean;
  endsAt: number | null;
  since: number | null;
  baseMs: number;
  frozenMs: number | null; // value to show while paused or waiting
  phaseMs: number | null;
  round: number; // rounds completed
  roundOf: number; // rounds per cycle (pomodoro)
  categoryId: Id | null;
  categoryName: string;
  color: string;
  title: string | null;
  blockId: Id | null;
  blockTitle: string | null;
  completed: CompletedPhase | null;
  suggestedBreakMin: number | null;
  breakKind: BreakKind | null;
}

export interface SnapshotInput {
  focus: FocusState | null;
  running: { startAt: number; categoryId: Id; title: string | null; blockId: Id | null } | null;
  paused: { categoryId: Id; title: string | null; accumulatedMs: number; blockId: Id | null } | null;
  runAccumulatedMs: number;
  categories: Array<{ id: Id; name: string; color: string }>;
  blockTitle?: (id: Id) => string | null;
}

export function phaseLabel(f: FocusState | null): string {
  if (!f) return "Stopwatch";
  if (f.phase === "break") return f.breakKind === "long" ? "Long break" : "Short break";
  if (f.phase === "ready") return "Break over";
  if (f.phase === "suggest") return f.kind === "flowtime" ? "Flowtime" : "Focus complete";
  if (f.phase === "done") return "Cycle complete";
  if (f.kind === "pomodoro") return `Focus ${f.round + 1} of ${Math.max(1, f.preset.every)}`;
  return f.kind === "flowtime" ? "Flowtime" : "Stopwatch";
}

export function nextLabel(f: FocusState | null): string | null {
  if (!f) return null;
  if (f.kind === "stopwatch") return null;
  if (f.kind === "flowtime") {
    if (f.phase === "focus") return "Break when you stop";
    if (f.phase === "suggest") return `Break · ${f.suggestedBreakMin ?? 5} min`;
    if (f.phase === "break") return "Back to focus";
    return null;
  }
  const every = Math.max(1, f.preset.every);
  if (f.phase === "focus") {
    const kind = breakKindAfter(f.preset, f.round + 1);
    return `${kind === "long" ? "Long" : "Short"} break · ${kind === "long" ? f.preset.long : f.preset.brk} min`;
  }
  if (f.phase === "suggest") return `${f.breakKind === "long" ? "Long" : "Short"} break · ${f.suggestedBreakMin ?? f.preset.brk} min`;
  if (f.phase === "break" || f.phase === "ready") {
    return f.breakKind === "long" ? "New cycle" : `Focus ${(f.round % every) + 1} of ${every}`;
  }
  return "New cycle";
}

export function snapshotOf(i: SnapshotInput): TimerSnapshot {
  const f = i.focus;
  const sessionActive = !!(i.running || i.paused);
  const status = timerStatus(f, sessionActive);
  const catId = f ? (f.phase === "break" || f.phase === "ready" ? (i.running?.categoryId ?? i.paused?.categoryId ?? f.categoryId) : f.categoryId) : (i.running?.categoryId ?? i.paused?.categoryId ?? null);
  const focusCat = i.categories.find((c) => c.id === (f?.categoryId ?? catId));
  const cat = i.categories.find((c) => c.id === catId);
  const blockId = f?.blockId ?? i.running?.blockId ?? i.paused?.blockId ?? null;
  const onBreak = f?.phase === "break";
  const base = {
    rev: f?.rev ?? 0,
    status,
    kind: f?.kind ?? (sessionActive ? ("stopwatch" as const) : null),
    phase: f?.phase ?? null,
    label: f ? phaseLabel(f) : sessionActive ? "Stopwatch" : "Ready",
    next: nextLabel(f),
    round: f?.round ?? 0,
    roundOf: f?.kind === "pomodoro" ? Math.max(1, f.preset.every) : 0,
    categoryId: f?.categoryId ?? catId,
    categoryName: onBreak ? (cat?.name ?? "Break") : (focusCat?.name ?? cat?.name ?? ""),
    color: onBreak ? "" : (focusCat?.color ?? cat?.color ?? ""),
    title: f?.title ?? i.running?.title ?? i.paused?.title ?? null,
    blockId,
    blockTitle: blockId && i.blockTitle ? i.blockTitle(blockId) : null,
    completed: f?.completed ?? null,
    suggestedBreakMin: f?.suggestedBreakMin ?? null,
    breakKind: f?.breakKind ?? null,
  };
  if (f && isActivePhase(f)) {
    const countdown = f.phaseMs !== null;
    if (f.segStart === null) {
      return { ...base, countdown, endsAt: null, since: null, baseMs: f.activeMs, frozenMs: countdown ? Math.max(0, f.phaseMs! - f.activeMs) : f.activeMs, phaseMs: f.phaseMs };
    }
    return { ...base, countdown, endsAt: deadlineOf(f), since: f.segStart, baseMs: f.activeMs, frozenMs: null, phaseMs: f.phaseMs };
  }
  if (!f && i.running) {
    return { ...base, countdown: false, endsAt: null, since: i.running.startAt, baseMs: i.runAccumulatedMs, frozenMs: null, phaseMs: null };
  }
  if (!f && i.paused) {
    return { ...base, status: "focus_paused", countdown: false, endsAt: null, since: null, baseMs: i.paused.accumulatedMs, frozenMs: i.paused.accumulatedMs, phaseMs: null };
  }
  // Waiting / idle: show the length of what comes next.
  let frozen = 0;
  if (f?.phase === "suggest") frozen = (f.suggestedBreakMin ?? 5) * MINUTE;
  else if (f?.phase === "ready" && f.kind === "pomodoro") frozen = f.preset.focus * MINUTE;
  else if (f?.phase === "done") frozen = f.completed?.activeMs ?? 0;
  return { ...base, countdown: f?.phase === "suggest" || (f?.phase === "ready" && f.kind === "pomodoro"), endsAt: null, since: null, baseMs: 0, frozenMs: frozen, phaseMs: null };
}

/** The value a clock shows at `now`: remaining for countdowns, elapsed otherwise. */
export function clockValue(s: TimerSnapshot, now: number): number {
  if (s.frozenMs !== null) return s.frozenMs;
  if (s.countdown && s.endsAt !== null) return Math.max(0, s.endsAt - now);
  if (s.since !== null) return s.baseMs + Math.max(0, now - s.since);
  return 0;
}

/** 0..1 progress through a countdown phase, or null. */
export function progressValue(s: TimerSnapshot, now: number): number | null {
  if (!s.phaseMs || !s.countdown) return null;
  const left = clockValue(s, now);
  return Math.min(1, Math.max(0, 1 - left / s.phaseMs));
}

export function isBreakStatus(s: TimerStatus): boolean {
  return s === "short_break" || s === "long_break" || s === "break_paused";
}

// ------------------------------------------------------------------------- calendar suggestion

/** The block a new focus timer should offer to link: the one happening now, else one starting soon. */
export function suggestBlock<B extends { id: Id; startAt: number; endAt: number; status: string }>(blocks: B[], now: number, soonMs = 15 * MINUTE): { block: B; when: "now" | "soon" } | null {
  const current = blocks.filter((b) => b.status !== "skipped" && b.startAt <= now && b.endAt > now).sort((a, b) => b.startAt - a.startAt)[0];
  if (current) return { block: current, when: "now" };
  const soon = blocks.filter((b) => b.status === "planned" && b.startAt > now && b.startAt - now <= soonMs).sort((a, b) => a.startAt - b.startAt)[0];
  return soon ? { block: soon, when: "soon" } : null;
}
