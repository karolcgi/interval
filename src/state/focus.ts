// Pomodoro / Flowtime engine. Turns the pure transitions in domain/focus.ts into real sessions.
//
// Everything is driven by `tickFocus(now)`, called every second while the app runs and once at
// startup. It is idempotent and catches up: if the computer slept through the end of a focus round,
// the round is closed at its exact planned end and the break is recorded from there.

import { store } from "./store";
import * as repo from "../db/repo";
import * as A from "./actions";
import type { Id } from "../domain/types";
import { MINUTE } from "../domain/time";
import { type FocusState, type PomodoroPreset, flowtimeBreakMinutes, nextStep } from "../domain/focus";
import { notify } from "../notify";

export async function setFocusState(f: FocusState | null) {
  const d = store.get().db;
  if (d) await d.batch([repo.setSettingStmt("timer.focus", f)]);
  store.set({ focus: f });
}

export function presetFromSettings(): PomodoroPreset {
  const s = store.get().settings;
  return { focus: s.pomodoroFocus, brk: s.pomodoroBreak, long: s.pomodoroLongBreak, every: Math.max(1, s.pomodoroLongEvery) };
}

function breakCategoryId(): Id | undefined {
  const { settings, categories } = store.get();
  const chosen = categories.find((c) => c.id === settings.breakCategoryId && !c.archivedAt);
  return (chosen ?? categories.find((c) => c.isBreak && !c.archivedAt))?.id;
}

type Target = { blockId?: Id | null; categoryId?: Id; tagIds?: Id[]; title?: string | null };

function baseState(kind: FocusState["kind"], preset: PomodoroPreset): FocusState | null {
  const r = store.get().running;
  if (!r) return null;
  return {
    kind,
    phase: "focus",
    preset,
    phaseStart: r.startAt,
    phaseEnd: kind === "pomodoro" ? r.startAt + preset.focus * MINUTE : null,
    round: 0,
    pausedRemaining: null,
    suggestedBreakMin: null,
    categoryId: r.categoryId,
    tagIds: r.tagIds,
    title: r.title,
    blockId: r.blockId,
  };
}

export async function startPomodoro(target: Target = {}, preset: PomodoroPreset = presetFromSettings()) {
  await A.startTimer({ ...target, mode: "pomodoro" });
  await setFocusState(baseState("pomodoro", preset));
}

export async function startFlowtime(target: Target = {}) {
  await A.startTimer({ ...target, mode: "flowtime" });
  await setFocusState(baseState("flowtime", presetFromSettings()));
}

/** After a Pomodoro break: start the next focus round with the same details. */
export async function nextRound() {
  const f = store.get().focus;
  if (!f) return;
  const now = Date.now();
  if (store.get().running) await A.stopTimer(now, { internal: true });
  await A.startTimer({ blockId: f.blockId, categoryId: f.categoryId, tagIds: f.tagIds, title: f.title, mode: f.kind, keepFocus: true, startAt: now });
  await setFocusState({ ...f, phase: "focus", phaseStart: now, phaseEnd: f.kind === "pomodoro" ? now + f.preset.focus * MINUTE : null, pausedRemaining: null, suggestedBreakMin: null });
}

async function startBreak(f: FocusState, at: number, minutes: number, round = f.round) {
  const cat = breakCategoryId();
  if (cat) await A.startTimer({ categoryId: cat, tagIds: [], title: null, mode: f.kind, startAt: at, keepFocus: true });
  await setFocusState({ ...f, phase: "break", round, phaseStart: at, phaseEnd: at + minutes * MINUTE, pausedRemaining: null, suggestedBreakMin: null });
}

/** Flowtime: accept the suggested break. */
export async function startSuggestedBreak() {
  const f = store.get().focus;
  if (!f || f.phase !== "suggest") return;
  await startBreak(f, Date.now(), f.suggestedBreakMin ?? 5);
}

/** Skip or cut short a break. Pomodoro goes straight into the next round; Flowtime ends. */
export async function skipBreak() {
  const f = store.get().focus;
  if (!f) return;
  if (f.phase === "break" && store.get().running) await A.stopTimer(Date.now(), { internal: true });
  if (f.kind === "pomodoro") return nextRound();
  await setFocusState(null);
}

/** End the whole Pomodoro/Flowtime cycle. */
export async function endFocus() {
  if (store.get().running || store.get().paused) await A.stopTimer(Date.now(), { internal: true });
  await setFocusState(null);
}

/** The user pressed Stop while a focus cycle is active. */
export async function focusUserStop(at: number) {
  const s = store.get();
  const f = s.focus;
  if (f && f.kind === "flowtime" && f.phase === "focus" && (s.running || s.paused)) {
    const worked = s.running ? s.runAccumulatedMs + (at - s.running.startAt) : s.paused!.accumulatedMs;
    await A.stopTimer(at, { internal: true });
    const minutes = flowtimeBreakMinutes(worked);
    await setFocusState({ ...f, phase: "suggest", phaseEnd: null, pausedRemaining: null, suggestedBreakMin: minutes });
    return;
  }
  await A.stopTimer(at, { internal: true });
  await setFocusState(null);
}

// --------------------------------------------------------------------- tick

let ticking = false;
const reminded = new Set<Id>();

export async function tickFocus(now = Date.now()) {
  if (ticking || !store.get().ready) return;
  ticking = true;
  try {
    for (let guard = 0; guard < 4; guard++) {
      const f = store.get().focus;
      const step = nextStep(f, now);
      if (step.type === "none" || !f) break;
      if (step.type === "focus-done") {
        if (store.get().running) await A.stopTimer(step.at, { internal: true });
        await startBreak(f, step.at, step.breakMinutes, step.round);
        if (now - step.at < MINUTE) notify(`Round ${step.round} done`, `Take a ${step.breakMinutes}-minute break.`);
      } else {
        if (store.get().running) await A.stopTimer(step.at, { internal: true });
        await setFocusState(f.kind === "pomodoro" ? { ...f, phase: "ready", phaseStart: step.at, phaseEnd: null } : null);
        if (now - step.at < MINUTE) notify("Break over", f.kind === "pomodoro" ? `Start round ${f.round + 1} when you’re ready.` : "Back to it when you’re ready.");
      }
    }
    // Plain stopwatch: a gentle reminder after a long unbroken stretch.
    const s = store.get();
    const mins = s.settings.breakReminderMinutes;
    const r = s.running;
    if (r && !s.focus && mins > 0 && !reminded.has(r.id)) {
      const cat = s.categories.find((c) => c.id === r.categoryId);
      if (!cat?.isBreak && s.runAccumulatedMs + (now - r.startAt) >= mins * MINUTE) {
        reminded.add(r.id);
        notify(`${Math.round((s.runAccumulatedMs + now - r.startAt) / MINUTE)} minutes in`, "A short break keeps the next stretch sharp.");
      }
    }
  } catch (e) {
    A.reportError(e);
  } finally {
    ticking = false;
  }
}
