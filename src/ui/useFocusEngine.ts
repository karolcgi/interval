import { useEffect, useRef } from "react";
import { store, useApp } from "../state/store";
import * as A from "../state/actions";
import * as F from "../state/focus";
import { isTauri } from "../platform";
import { phaseLabel, remaining } from "../domain/focus";
import { fmtClock } from "../domain/format";
import { MINUTE } from "../domain/time";

/** Runs the Pomodoro/Flowtime transitions once a second (and immediately after startup). */
export function useFocusEngine() {
  const ready = useApp((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    void F.tickFocus();
    const t = setInterval(() => void F.tickFocus(), 1000);
    return () => clearInterval(t);
  }, [ready]);
}

/** One line describing the timer, for the window title, the tray tooltip and the tray menu. */
export function timerStatus(now = Date.now()): { short: string; title: string; coarse: string } | null {
  const s = store.get();
  const f = s.focus;
  const r = s.running;
  const catName = (id?: string) => s.categories.find((c) => c.id === id)?.name ?? "Session";
  if (r) {
    const name = r.title || catName(r.categoryId);
    const left = f ? remaining(f, now) : null;
    const elapsed = s.runAccumulatedMs + now - r.startAt;
    const clock = left !== null ? `${fmtClock(left)} left` : fmtClock(elapsed);
    const mins = left !== null ? `${Math.ceil(left / MINUTE)} min left` : `${Math.floor(elapsed / MINUTE)} min`;
    const label = f ? `${phaseLabel(f)} · ` : "";
    return { short: `${label}${name} · ${clock}`, title: `${clock} · ${name}`, coarse: `${label}${name} · ${mins}` };
  }
  const one = (text: string, title: string) => ({ short: text, title, coarse: text });
  if (s.paused) return one(`Paused · ${s.paused.title || catName(s.paused.categoryId)}`, "Paused");
  if (f?.phase === "ready") return one(`Break over · round ${f.round + 1} next`, "Break over");
  if (f?.phase === "suggest") return one(`Suggested break · ${f.suggestedBreakMin} min`, "Take a break");
  return null;
}

/** Mirrors the timer into the system tray and handles tray menu actions (desktop only). */
export function useTray() {
  const ready = useApp((s) => s.ready);
  const closeToTray = useApp((s) => s.settings.closeToTray);
  const last = useRef("");

  useEffect(() => {
    if (!isTauri()) return;
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("set_close_to_tray", { enabled: closeToTray }).catch(() => {}));
  }, [closeToTray]);

  useEffect(() => {
    if (!ready) return;
    const sync = () => {
      const s = store.get();
      const st = timerStatus();
      document.title = st ? `${st.title} — Interval` : "Interval";
      if (!isTauri()) return;
      // Minute resolution in the menu keeps menu rebuilds rare; the tooltip shows the same line.
      const coarse = st?.coarse ?? "No timer running";
      const key = `${coarse}|${!!s.running}|${!!s.paused}|${!!s.focus}`;
      if (key === last.current) return;
      last.current = key;
      void import("@tauri-apps/api/core").then(({ invoke }) =>
        invoke("set_tray_state", { state: { tooltip: st ? `Interval · ${coarse}` : "Interval", status: coarse, running: !!s.running, paused: !!s.paused, focus: !!s.focus } }).catch(() => {}),
      );
    };
    sync();
    const t = setInterval(sync, 1000);
    return () => clearInterval(t);
  }, [ready]);

  useEffect(() => {
    if (!isTauri() || !ready) return;
    let un: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      un = await listen<string>("tray-action", (e) => {
        const s = store.get();
        const run = (p: Promise<unknown>) => void p.catch(A.reportError);
        switch (e.payload) {
          case "toggle":
            if (s.running) run(A.pauseTimer());
            else if (s.paused) run(A.resumeTimer());
            else if (s.focus?.phase === "ready") run(F.nextRound());
            else run(A.startTimer({}));
            break;
          case "stop":
            run(s.running || s.paused ? A.stopTimer() : F.endFocus());
            break;
          case "pomodoro":
            run(F.startPomodoro({}));
            break;
          case "flowtime":
            run(F.startFlowtime({}));
            break;
        }
      });
    });
    return () => un?.();
  }, [ready]);
}

