import { useRef, useState } from "react";
import { ChevronDown, Hourglass, Timer, Waves } from "lucide-react";
import { useApp } from "../state/store";
import * as A from "../state/actions";
import * as F from "../state/focus";
import type { Id } from "../domain/types";
import { POMODORO_PRESETS, type PomodoroPreset } from "../domain/focus";
import { usePlacement, useOutside } from "./bits";

type Target = { blockId?: Id | null; categoryId?: Id };

/** A chevron that opens timer modes: stopwatch, Pomodoro presets, Flowtime. */
export function StartMenuButton({ target, className = "" }: { target: Target; className?: string }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btn}
        className={`icon-btn start-more ${className}`}
        aria-label="Timer modes"
        title="Stopwatch, Pomodoro or Flowtime"
        onClick={() => {
          const r = btn.current!.getBoundingClientRect();
          setAt(at ? null : { x: r.left, y: r.bottom + 4 });
        }}
      >
        <ChevronDown size={13} />
      </button>
      {at && <StartMenu x={at.x} y={at.y} target={target} onClose={() => setAt(null)} />}
    </>
  );
}

function StartMenu(p: { x: number; y: number; target: Target; onClose: () => void }) {
  const settings = useApp((s) => s.settings);
  const { ref, style } = usePlacement(p.x, p.y);
  useOutside(ref, p.onClose);
  const mine = F.presetFromSettings();
  const presets: PomodoroPreset[] = [mine, ...POMODORO_PRESETS.filter((x) => x.focus !== mine.focus || x.brk !== mine.brk)];
  const go = (fn: () => Promise<unknown>) => {
    p.onClose();
    void fn().catch(A.reportError);
  };
  return (
    <div className="popover menu start-menu popover-modal" ref={ref} style={{ ...style, position: "fixed" }} role="menu" onKeyDown={(e) => e.key === "Escape" && p.onClose()}>
      <button className="menu-item" role="menuitem" onClick={() => go(() => A.startTimer({ ...p.target, mode: "stopwatch" }))}>
        <span className="menu-icon">
          <Timer size={13} />
        </span>
        <span>Stopwatch</span>
        <span className="menu-hint">until you stop</span>
      </button>
      <div className="menu-sep" />
      {presets.map((pr, i) => (
        <button key={i} className="menu-item" role="menuitem" onClick={() => go(() => F.startPomodoro(p.target, pr))}>
          <span className="menu-icon">
            <Hourglass size={13} />
          </span>
          <span>
            Pomodoro {pr.focus}/{pr.brk}
          </span>
          <span className="menu-hint">{i === 0 && (settings.pomodoroFocus !== 25 || settings.pomodoroBreak !== 5) ? "yours" : `long ${pr.long}`}</span>
        </button>
      ))}
      <div className="menu-sep" />
      <button className="menu-item" role="menuitem" onClick={() => go(() => F.startFlowtime(p.target))}>
        <span className="menu-icon">
          <Waves size={13} />
        </span>
        <span>Flowtime</span>
        <span className="menu-hint">break when you stop</span>
      </button>
    </div>
  );
}
