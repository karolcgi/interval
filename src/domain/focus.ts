// Pomodoro and Flowtime: pure state transitions. The engine (state/focus.ts) applies them.
//
// Pomodoro: focus N min -> break M min (a long break every K focus rounds) -> "ready" until you start
//   the next round. Focus and break are both recorded as real sessions; the break goes to a break category.
// Flowtime: focus counts up with no deadline. When you stop, a break proportional to the focus length
//   is suggested; accepting it starts a counted-down break.

import type { Id } from "./types";
import { MINUTE } from "./time";

export type FocusKind = "pomodoro" | "flowtime";
export type FocusPhase = "focus" | "break" | "ready" | "suggest";

export interface PomodoroPreset {
  focus: number; // minutes
  brk: number;
  long: number;
  every: number; // a long break after this many focus rounds
}

export const POMODORO_PRESETS: PomodoroPreset[] = [
  { focus: 25, brk: 5, long: 15, every: 4 },
  { focus: 50, brk: 10, long: 20, every: 3 },
  { focus: 90, brk: 15, long: 30, every: 2 },
];

export interface FocusState {
  kind: FocusKind;
  phase: FocusPhase;
  preset: PomodoroPreset; // pomodoro only (kept for flowtime for shape stability)
  phaseStart: number;
  phaseEnd: number | null; // null while a flowtime focus counts up, or while waiting
  round: number; // focus rounds completed
  pausedRemaining: number | null; // ms left in the phase while paused
  suggestedBreakMin: number | null; // flowtime "suggest" phase
  // What the focus rounds are about, so the next round starts with the same details.
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

export function breakLength(preset: PomodoroPreset, roundsDone: number): number {
  return roundsDone > 0 && roundsDone % preset.every === 0 ? preset.long : preset.brk;
}

/** Remaining ms in the current phase (null if the phase has no deadline). */
export function remaining(f: FocusState, now: number): number | null {
  if (f.pausedRemaining !== null) return f.pausedRemaining;
  return f.phaseEnd === null ? null : Math.max(0, f.phaseEnd - now);
}

export type FocusStep =
  | { type: "none" }
  // close the running segment at `at`, then start a break segment at `at` for `minutes`
  | { type: "focus-done"; at: number; breakMinutes: number; round: number }
  // close the break segment at `at`; wait for the user
  | { type: "break-done"; at: number };

/** What should happen at `now`, given the focus state. Idempotent: callers apply it once. */
export function nextStep(f: FocusState | null, now: number): FocusStep {
  if (!f || f.pausedRemaining !== null || f.phaseEnd === null || now < f.phaseEnd) return { type: "none" };
  if (f.phase === "focus" && f.kind === "pomodoro") {
    const round = f.round + 1;
    return { type: "focus-done", at: f.phaseEnd, breakMinutes: breakLength(f.preset, round), round };
  }
  if (f.phase === "break") return { type: "break-done", at: f.phaseEnd };
  return { type: "none" };
}

/** Short label for the timer and tray: "Pomodoro 2 · focus", "Flowtime", "Break". */
export function phaseLabel(f: FocusState | null): string {
  if (!f) return "Stopwatch";
  if (f.phase === "break") return f.kind === "pomodoro" && f.preset.long !== f.preset.brk && f.round % f.preset.every === 0 ? "Long break" : "Break";
  if (f.phase === "ready") return "Break over";
  if (f.phase === "suggest") return "Flowtime";
  return f.kind === "pomodoro" ? `Pomodoro ${f.round + 1}` : "Flowtime";
}
