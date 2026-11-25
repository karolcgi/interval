import { useEffect } from "react";
import { Pause, Play, Square } from "lucide-react";
import { useApp, useNow } from "../state/store";
import * as A from "../state/actions";
import { fmtClock } from "../domain/format";
import { catVars, CategorySelect } from "./bits";
import { TagInput } from "./TagInput";
import { isTauri } from "../platform";

/** Unobtrusive floating timer. Shows the active (or paused) session and its controls. */
export function FloatingTimer() {
  const running = useApp((s) => s.running);
  const paused = useApp((s) => s.paused);
  const acc = useApp((s) => s.runAccumulatedMs);
  const categories = useApp((s) => s.categories);
  const now = useNow(1000);

  const elapsed = running ? acc + (now - running.startAt) : paused ? paused.accumulatedMs : 0;
  const catId = running?.categoryId ?? paused?.categoryId;
  const cat = categories.find((c) => c.id === catId);

  // Window title shows the running timer (visible in the taskbar).
  useEffect(() => {
    document.title = running ? `${fmtClock(elapsed)} · ${running.title || cat?.name || "Session"} — Interval` : "Interval";
    if (isTauri() && running && now % 15_000 < 1000) {
      void import("@tauri-apps/api/core").then(({ invoke }) => invoke("set_tray_tooltip", { text: document.title }).catch(() => {}));
    }
  }, [running, elapsed, cat, now]);

  if (!running && !paused) return null;
  return (
    <div className={`float-timer ${paused && !running ? "paused" : ""}`} style={catVars(cat?.color ?? "#888")} role="status" aria-live="polite">
      <span className="ft-pulse" />
      <div className="ft-main">
        {running ? (
          <CategorySelect categories={categories} value={running.categoryId} onChange={(categoryId) => void A.updateSession(running.id, { categoryId }, "Change category")} />
        ) : (
          <span className="ft-name">{paused?.title || cat?.name} · paused</span>
        )}
        {running?.title && <span className="ft-title">{running.title}</span>}
      </div>
      {running && (
        <div className="ft-tags">
          <TagInput value={running.tagIds} onChange={(tagIds) => void A.updateSession(running.id, { tagIds }, "Change tags")} />
        </div>
      )}
      <span className="ft-clock">{fmtClock(elapsed)}</span>
      {running ? (
        <button className="icon-btn" onClick={() => void A.pauseTimer()} aria-label="Pause" title="Pause">
          <Pause size={14} />
        </button>
      ) : (
        <button className="icon-btn" onClick={() => void A.resumeTimer()} aria-label="Resume" title="Resume">
          <Play size={14} />
        </button>
      )}
      <button className="icon-btn ft-stop" onClick={() => void A.stopTimer()} aria-label="Stop" title="Stop (S)">
        <Square size={12} fill="currentColor" />
      </button>
    </div>
  );
}
