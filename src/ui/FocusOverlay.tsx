import { useEffect } from "react";
import { Minimize2, Pause, Play, SkipForward, Square } from "lucide-react";
import { store, useApp, useNow } from "../state/store";
import * as A from "../state/actions";
import * as F from "../state/focus";
import { fmtClock } from "../domain/format";
import { phaseLabel, remaining } from "../domain/focus";
import { catVars } from "./bits";

const run = (p: Promise<unknown>) => void p.catch(A.reportError);

/** Full-window focus mode: one big clock, nothing else. Esc or F to leave. */
export function FocusOverlay() {
  const on = useApp((s) => s.focusMode);
  const running = useApp((s) => s.running);
  const paused = useApp((s) => s.paused);
  const focus = useApp((s) => s.focus);
  const acc = useApp((s) => s.runAccumulatedMs);
  const categories = useApp((s) => s.categories);
  const now = useNow(1000);

  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        store.set({ focusMode: false });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [on]);

  if (!on) return null;
  const cat = categories.find((c) => c.id === (running?.categoryId ?? paused?.categoryId ?? focus?.categoryId));
  const left = focus ? remaining(focus, now) : null;
  const elapsed = running ? acc + (now - running.startAt) : paused?.accumulatedMs ?? 0;
  const idle = !running && !paused;
  const isBreak = focus?.phase === "break";
  const pct = focus && focus.phaseMs && left !== null ? 1 - left / focus.phaseMs : null;

  return (
    <div className="focus-overlay" style={catVars(cat?.color ?? "#888")} role="dialog" aria-label="Focus mode">
      <button className="icon-btn focus-exit" onClick={() => store.set({ focusMode: false })} aria-label="Leave focus mode" title="Leave (Esc)">
        <Minimize2 size={16} />
      </button>
      <div className="focus-center">
        <div className="eyebrow focus-phase">{idle ? (focus ? phaseLabel(focus) : "No timer running") : focus ? phaseLabel(focus) : paused && !running ? "Paused" : "Stopwatch"}</div>
        <div className="focus-name">{running?.title || paused?.title || (isBreak ? "Break" : cat?.name) || "Interval"}</div>
        <div className="focus-clock">{idle && !focus ? "00:00" : left !== null ? fmtClock(left) : fmtClock(elapsed)}</div>
        {pct !== null && (
          <div className="focus-bar">
            <span style={{ width: `${Math.min(100, pct * 100)}%` }} />
          </div>
        )}
        <div className="focus-controls">
          {focus?.phase === "ready" || focus?.phase === "done" ? (
            <button className="btn btn-cat" onClick={() => run(F.nextRound())}>
              <Play size={12} fill="currentColor" /> Start round {focus.round + 1}
            </button>
          ) : focus?.phase === "suggest" ? (
            <button className="btn btn-cat" onClick={() => run(F.startSuggestedBreak())}>
              Take a {focus.suggestedBreakMin}-minute break
            </button>
          ) : isBreak ? (
            <button className="btn btn-outline" onClick={() => run(F.skipBreak())}>
              <SkipForward size={13} /> {focus?.kind === "pomodoro" ? "Skip break" : "End break"}
            </button>
          ) : running ? (
            <button className="btn btn-outline" onClick={() => run(A.pauseTimer())}>
              <Pause size={13} /> Pause
            </button>
          ) : paused ? (
            <button className="btn btn-outline" onClick={() => run(A.resumeTimer())}>
              <Play size={13} /> Resume
            </button>
          ) : (
            <button className="btn btn-outline" onClick={() => run(F.startPomodoro({}))}>
              <Play size={13} /> Start Pomodoro
            </button>
          )}
          {(running || paused || focus) && (
            <button className="btn btn-outline" onClick={() => run(focus && !(focus.phase === "focus" && (running || paused)) ? F.endFocus() : A.stopTimer())}>
              <Square size={11} fill="currentColor" /> Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
