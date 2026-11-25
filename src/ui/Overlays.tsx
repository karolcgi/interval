import { Moon } from "lucide-react";
import { useApp } from "../state/store";
import * as A from "../state/actions";
import { fmtDuration, fmtTime } from "../domain/format";

export function Toasts() {
  const toast = useApp((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.id}>
      <span>{toast.message}</span>
      {toast.undo && (
        <button className="link" onClick={() => void A.undo()}>
          Undo
        </button>
      )}
    </div>
  );
}

/** Shown when a timer was running while the computer slept or the app was closed. */
export function SleepGapBanner() {
  const gap = useApp((s) => s.sleepGap);
  if (!gap) return null;
  return (
    <div className="sleep-gap popover" role="alertdialog" aria-label="Review idle time">
      <div className="sg-head">
        <Moon size={15} />
        <strong>Away for {fmtDuration(gap.to - gap.from)}</strong>
      </div>
      <p className="muted small">
        Your session kept running from {fmtTime(gap.from)} to {fmtTime(gap.to)} while the computer slept or Interval wasn’t running. What should happen to that time?
      </p>
      <div className="sg-actions">
        <button className="btn btn-outline" onClick={() => void A.resolveSleepGap("exclude")}>
          Remove gap, keep running
        </button>
        <button className="btn btn-outline" onClick={() => void A.resolveSleepGap("stop")}>
          Stop at {fmtTime(gap.from)}
        </button>
        <button className="btn btn-ghost" onClick={() => void A.resolveSleepGap("keep")}>
          Keep it all
        </button>
      </div>
    </div>
  );
}
