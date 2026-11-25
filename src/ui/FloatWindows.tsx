// The floating mini timer and the completion popup. Each runs in its own small desktop window
// (?window=mini, ?window=popup) without a database: it renders the snapshot the main window
// broadcasts and sends commands back. Neither runs a timer of its own; the clock is derived from the
// snapshot's timestamps, so every window shows the same time.
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Square, X } from "lucide-react";
import { clockValue, isBreakStatus, progressValue, type TimerSnapshot } from "../domain/focus";
import { fmtClock, fmtDuration } from "../domain/format";
import { closeWindow, onSnapshot, restoreMain, sendCommand, type TimerBroadcast } from "../timerBus";
import type { TimerCommand } from "../state/focus";
import { isTauri } from "../platform";
import { CycleDots } from "./FocusPanel";

function useBroadcast(): TimerBroadcast | null {
  const [snap, setSnap] = useState<TimerBroadcast | null>(null);
  useEffect(() => onSnapshot(setSnap), []);
  useEffect(() => {
    if (!snap) return;
    document.documentElement.dataset.theme = snap.ui.theme;
  }, [snap?.ui.theme]); // eslint-disable-line react-hooks/exhaustive-deps
  return snap;
}

function useClock(ms = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function tone(s: TimerSnapshot) {
  if (isBreakStatus(s.status) || (s.status === "completed" && s.phase === "suggest")) return "break";
  return s.status === "completed" ? "done" : s.status === "idle" ? "idle" : "focus";
}

/** Drag the window by pressing and moving; plain clicks and double-clicks stay clicks. */
function useWindowDrag() {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
      start.current = { x: e.screenX, y: e.screenY };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (!s || (e.buttons & 1) === 0) return void (start.current = null);
      if (Math.abs(e.screenX - s.x) + Math.abs(e.screenY - s.y) < 4) return;
      start.current = null;
      if (isTauri()) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().startDragging());
    },
    onPointerUp: () => (start.current = null),
    onDoubleClick: (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      void restoreMain();
    },
  };
}

// ------------------------------------------------------------------------------- mini timer

export function MiniTimerApp() {
  const snap = useBroadcast();
  const now = useClock();
  const drag = useWindowDrag();
  if (!snap) return <div className="float-root mini" />;
  const send = (cmd: TimerCommand) => sendCommand(cmd, snap.rev);
  const t = tone(snap);
  const running = snap.status === "focusing" || snap.status === "short_break" || snap.status === "long_break";
  const paused = snap.status === "focus_paused" || snap.status === "break_paused";
  const progress = progressValue(snap, now);
  const value = snap.status === "idle" ? "--:--" : snap.status === "completed" ? fmtClock(snap.frozenMs ?? 0) : fmtClock(clockValue(snap, now));
  const name = isBreakStatus(snap.status) ? snap.label : snap.title || snap.categoryName || snap.label;
  const compact = snap.ui.layout === "compact";

  const toggle =
    snap.status === "completed" ? (
      <button className="mt-btn primary" onClick={() => send(snap.phase === "suggest" ? "startBreak" : "nextRound")} aria-label={snap.phase === "suggest" ? "Start break" : "Start next round"} title={snap.phase === "suggest" ? "Start break" : "Start next round"}>
        <Play size={12} fill="currentColor" />
      </button>
    ) : running ? (
      <button className="mt-btn" onClick={() => send("pause")} aria-label="Pause" title="Pause">
        <Pause size={12} fill="currentColor" />
      </button>
    ) : (
      <button className="mt-btn primary" onClick={() => send(paused ? "resume" : "toggle")} aria-label={paused ? "Resume" : "Start"} title={paused ? "Resume" : "Start"}>
        <Play size={12} fill="currentColor" />
      </button>
    );
  const stop = (
    <button className="mt-btn" onClick={() => send(snap.status === "completed" ? "finish" : "stop")} aria-label="Stop" title="Stop" disabled={snap.status === "idle"}>
      <Square size={10} fill="currentColor" />
    </button>
  );

  return (
    <div
      className={`float-root mini tone-${t} ${compact ? "compact" : "standard"} ${paused ? "is-paused" : ""} ${snap.ui.clickThrough ? "through" : ""}`}
      style={{ ["--float-opacity" as string]: String(snap.ui.opacity), ["--c" as string]: snap.color || "var(--text-3)" }}
      title="Double-click to open Interval"
      {...drag}
    >
      {compact ? (
        <>
          <span className="mt-dot" aria-label={snap.label} title={snap.label} />
          <span className="mt-clock" role="timer">
            {value}
          </span>
          {toggle}
          {stop}
        </>
      ) : (
        <>
          <div className="mt-top">
            <span className="mt-dot" aria-hidden />
            <span className="mt-name" title={name}>
              {snap.status === "idle" ? "No timer running" : name}
            </span>
            <button className="mt-close" onClick={() => void closeWindow("mini")} aria-label="Close floating timer" title="Close">
              <X size={11} />
            </button>
          </div>
          <div className="mt-row">
            <span className="mt-clock" role="timer">
              {value}
            </span>
            <span className="mt-actions">
              {toggle}
              {stop}
            </span>
          </div>
          <div className="mt-bar" aria-hidden>
            <span style={{ transform: `scaleX(${progress ?? 0})` }} />
          </div>
          <div className="mt-foot">
            <span>
              {snap.label}
              {snap.roundOf ? <CycleDots snap={snap} className="sm" /> : null}
            </span>
            {snap.next && <span className="mt-next">Next · {snap.next}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------ completion popup

/** What the popup offers after a focus round or a break ends. Shared by the popup window and the in-app card. */
export function CompletionCard({ snap, send, onClose }: { snap: TimerSnapshot; send: (cmd: TimerCommand) => void; onClose: () => void }) {
  const c = snap.completed;
  if (!c) return null;
  const afterFocus = c.phase === "focus";
  const breakRunning = snap.status === "short_break" || snap.status === "long_break";
  const focusRunning = snap.status === "focusing";
  const breakMin = breakRunning && snap.phaseMs ? Math.round(snap.phaseMs / 60_000) : (snap.suggestedBreakMin ?? 5);
  const act = (cmd: TimerCommand) => {
    send(cmd);
    onClose();
  };
  return (
    <div className={`completion-card tone-${afterFocus ? "break" : "focus"}`} role="alertdialog" aria-labelledby="cc-title" aria-describedby="cc-body">
      <div className="cc-head">
        <span className="eyebrow">{afterFocus ? (c.cycleDone ? "Cycle complete" : "Focus complete") : "Break over"}</span>
        <button className="icon-btn sm" onClick={onClose} aria-label="Close">
          <X size={12} />
        </button>
      </div>
      <div id="cc-title" className="cc-title">
        {afterFocus ? fmtDuration(c.activeMs) : "Back to it?"}
        {afterFocus && <span className="cc-sub"> focused{snap.title || snap.categoryName ? ` · ${snap.title || snap.categoryName}` : ""}</span>}
      </div>
      <div id="cc-body" className="cc-body">
        {afterFocus
          ? breakRunning
            ? `${c.breakKind === "long" ? "Long" : "Short"} break running · ${breakMin} min`
            : `Suggested break · ${breakMin} min`
          : focusRunning
            ? `${snap.label} started`
            : snap.phase === "done"
              ? "That was the long break. Start a new cycle when you’re ready."
              : `Next · ${snap.next ?? "focus"}`}
      </div>
      <div className="cc-actions">
        {afterFocus ? (
          <>
            {breakRunning ? (
              <button className="btn btn-break sm" onClick={onClose}>
                Enjoy the break
              </button>
            ) : (
              <button className="btn btn-break sm" onClick={() => act("startBreak")}>
                Start break
              </button>
            )}
            <button className="btn btn-outline sm" onClick={() => act("extendFocus5")}>
              +5 min focus
            </button>
            <button className="btn btn-ghost sm" onClick={() => act("finish")}>
              Finish session
            </button>
          </>
        ) : (
          <>
            {focusRunning ? (
              <button className="btn btn-focus sm" onClick={onClose}>
                Focusing
              </button>
            ) : (
              <button className="btn btn-focus sm" onClick={() => act("nextRound")}>
                Resume focus
              </button>
            )}
            <button className="btn btn-outline sm" onClick={() => act("extendBreak5")}>
              +5 min break
            </button>
            <button className="btn btn-ghost sm" onClick={() => act("finish")}>
              Finish cycle
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function PopupApp() {
  const snap = useBroadcast();
  const opened = useRef<number | null>(null);
  const close = () => void closeWindow("popup");
  useEffect(() => {
    if (!snap) return;
    // The popup belongs to one moment; once the timer moves on (an action anywhere), it goes away.
    if (opened.current === null) opened.current = snap.rev;
    else if (snap.rev !== opened.current) close();
  }, [snap?.rev]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!snap) return <div className="float-root popup" />;
  return (
    <div className="float-root popup" style={{ ["--float-opacity" as string]: "1" }}>
      <CompletionCard snap={snap} send={(cmd) => sendCommand(cmd, snap.rev)} onClose={close} />
    </div>
  );
}
