import { Maximize2, Pause, Play, SkipForward, Square, X } from "lucide-react";
import { store, useApp, useNow } from "../state/store";
import * as A from "../state/actions";
import * as F from "../state/focus";
import { fmtClock } from "../domain/format";
import { phaseLabel, remaining, type FocusState } from "../domain/focus";
import { catVars, CategorySelect } from "./bits";
import { TagInput } from "./TagInput";

const run = (p: Promise<unknown>) => void p.catch(A.reportError);

/** Unobtrusive floating timer. Shows the active (or paused) session, focus phase and controls. */
export function FloatingTimer() {
  const running = useApp((s) => s.running);
  const paused = useApp((s) => s.paused);
  const focus = useApp((s) => s.focus);
  const acc = useApp((s) => s.runAccumulatedMs);
  const categories = useApp((s) => s.categories);
  const now = useNow(1000);

  if (!running && !paused) {
    if (focus?.phase === "ready" || focus?.phase === "suggest") return <FocusPrompt focus={focus} />;
    return null;
  }

  const elapsed = running ? acc + (now - running.startAt) : paused ? paused.accumulatedMs : 0;
  const catId = running?.categoryId ?? paused?.categoryId;
  const cat = categories.find((c) => c.id === catId);
  const left = focus ? remaining(focus, now) : null;
  const isBreak = focus?.phase === "break";
  const progress = focus && focus.phaseEnd !== null && left !== null ? 1 - left / Math.max(1, focus.phaseEnd - focus.phaseStart) : null;

  return (
    <div className={`float-timer ${paused && !running ? "paused" : ""} ${isBreak ? "on-break" : ""}`} style={catVars(cat?.color ?? "#888")} role="status" aria-live="polite">
      <span className="ft-pulse" />
      {focus && <span className="ft-mode">{phaseLabel(focus)}</span>}
      <div className="ft-main">
        {running && !isBreak ? (
          <CategorySelect categories={categories} value={running.categoryId} onChange={(categoryId) => run(A.updateSession(running.id, { categoryId }, "Change category"))} />
        ) : (
          <span className="ft-name">
            {isBreak ? cat?.name ?? "Break" : `${paused?.title || cat?.name} · paused`}
          </span>
        )}
        {running?.title && !isBreak && <span className="ft-title">{running.title}</span>}
      </div>
      {running && !isBreak && (
        <div className="ft-tags">
          <TagInput value={running.tagIds} onChange={(tagIds) => run(A.updateSession(running.id, { tagIds }, "Change tags"))} />
        </div>
      )}
      <span className="ft-clock" title={left !== null ? "Remaining" : "Elapsed"}>
        {left !== null ? fmtClock(left) : fmtClock(elapsed)}
      </span>
      {isBreak ? (
        <button className="icon-btn" onClick={() => run(F.skipBreak())} aria-label={focus?.kind === "pomodoro" ? "Skip break, start next round" : "End break"} title={focus?.kind === "pomodoro" ? "Skip break" : "End break"}>
          <SkipForward size={14} />
        </button>
      ) : running ? (
        <button className="icon-btn" onClick={() => run(A.pauseTimer())} aria-label="Pause" title="Pause">
          <Pause size={14} />
        </button>
      ) : (
        <button className="icon-btn" onClick={() => run(A.resumeTimer())} aria-label="Resume" title="Resume">
          <Play size={14} />
        </button>
      )}
      <button className="icon-btn" onClick={() => store.set({ focusMode: true })} aria-label="Focus mode" title="Focus mode (F)">
        <Maximize2 size={13} />
      </button>
      <button className="icon-btn ft-stop" onClick={() => run(isBreak ? F.endFocus() : A.stopTimer())} aria-label="Stop" title="Stop (S)">
        <Square size={12} fill="currentColor" />
      </button>
      {progress !== null && <span className="ft-progress" style={{ width: `${Math.min(100, progress * 100)}%` }} />}
    </div>
  );
}

/** Between rounds: "Break over" (Pomodoro) or the Flowtime break suggestion. */
function FocusPrompt({ focus }: { focus: FocusState }) {
  const categories = useApp((s) => s.categories);
  const cat = categories.find((c) => c.id === focus.categoryId);
  const ready = focus.phase === "ready";
  return (
    <div className="float-timer prompt" style={catVars(cat?.color ?? "#888")} role="status" aria-live="polite">
      <span className="ft-mode">{ready ? "Break over" : "Flowtime"}</span>
      <span className="ft-name">{ready ? `Round ${focus.round + 1} · ${focus.title || cat?.name}` : `Suggested break · ${focus.suggestedBreakMin} min`}</span>
      {ready ? (
        <button className="btn btn-cat sm" onClick={() => run(F.nextRound())}>
          <Play size={11} fill="currentColor" /> Start round
        </button>
      ) : (
        <button className="btn btn-cat sm" onClick={() => run(F.startSuggestedBreak())}>
          Take break
        </button>
      )}
      <button className="icon-btn" onClick={() => run(F.endFocus())} aria-label={ready ? "End Pomodoro" : "Skip break"} title={ready ? "End Pomodoro" : "Skip break"}>
        <X size={14} />
      </button>
    </div>
  );
}
