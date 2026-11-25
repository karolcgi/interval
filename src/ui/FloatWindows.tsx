// The floating mini timer and the completion popup. Each runs in its own small desktop window
// (?window=mini, ?window=popup) without a database: it renders the snapshot the main window
// broadcasts and sends commands back. Neither runs a timer of its own; the clock is derived from the
// snapshot's timestamps, so every window shows the same time.
import { useEffect, useRef, useState } from "react";
import { AppWindow, Pause, Pencil, Pin, PinOff, Play, SmilePlus, Square, Trash2, X } from "lucide-react";
import { clockValue, isBreakStatus, progressValue, type TimerSnapshot } from "../domain/focus";
import { fmtClock, fmtDuration } from "../domain/format";
import { closeWindow, miniExpand, onSnapshot, restoreMain, sendCommand, type TimerBroadcast } from "../timerBus";
import type { TimerCommand } from "../state/focus";
import { isTauri } from "../platform";
import { AbandonConfirm, CycleDots } from "./FocusPanel";
import { EmojiPicker, leadingEmoji, startsWithEmoji, withLeadingEmoji } from "./EmojiPicker";

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
  const [editing, setEditing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Fit the window to the edit view while it's open.
  useEffect(() => {
    if (!editing) return void miniExpand(false);
    const el = rootRef.current;
    let last = 0;
    const fit = () => {
      const h = Math.ceil(el?.querySelector(".mt-edit")?.getBoundingClientRect().bottom ?? el?.scrollHeight ?? 330) + 10;
      if (Math.abs(h - last) > 2) (last = h), void miniExpand(true, h);
    };
    fit();
    // Refit when the edit view grows or shrinks (emoji picker, abandon confirm, break vs focus)
    const edit = el?.querySelector(".mt-edit");
    if (!edit || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(edit);
    return () => ro.disconnect();
  }, [editing, snap?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!snap) return <div className="float-root mini" />;
  const send = (cmd: TimerCommand) => sendCommand(cmd, typeof cmd === "string" ? snap.rev : null);
  const t = tone(snap);
  const running = snap.status === "focusing" || snap.status === "short_break" || snap.status === "long_break";
  const paused = snap.status === "focus_paused" || snap.status === "break_paused";
  const progress = progressValue(snap, now);
  const idle = snap.status === "idle";
  const value = idle ? (snap.ui.mode === "pomodoro" ? fmtClock(snap.ui.focusMin * 60_000) : "00:00") : snap.status === "completed" ? fmtClock(snap.frozenMs ?? 0) : fmtClock(clockValue(snap, now));
  const name = isBreakStatus(snap.status) ? snap.label : snap.title || snap.categoryName || snap.label;
  const compact = snap.ui.layout === "compact" && !editing;

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
    <button className="mt-btn" onClick={() => send(snap.status === "completed" ? "finish" : "stop")} aria-label="Stop" title="Stop and record" disabled={idle}>
      <Square size={10} fill="currentColor" />
    </button>
  );

  return (
    <div
      ref={rootRef}
      className={`float-root mini tone-${t} ${compact ? "compact" : "standard"} ${editing ? "editing" : ""} ${paused ? "is-paused" : ""} ${snap.ui.clickThrough ? "through" : ""}`}
      style={{ ["--float-opacity" as string]: String(editing ? 1 : snap.ui.opacity), ["--c" as string]: snap.color || "var(--text-3)" }}
      title={editing ? undefined : "Double-click to open Interval"}
      {...(editing ? {} : drag)}
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
          <div className="mt-top" {...(editing ? drag : {})}>
            <span className="mt-dot" aria-hidden />
            <span className="mt-name" title={name}>
              {idle ? "Ready" : name}
            </span>
            <button className={`mt-close ${snap.ui.onTop ? "on" : ""}`} onClick={() => send({ type: "onTop", on: !snap.ui.onTop })} aria-label={snap.ui.onTop ? "Stop keeping on top" : "Keep on top"} aria-pressed={snap.ui.onTop} title={snap.ui.onTop ? "On top of other windows (click to release)" : "Keep on top of other windows"}>
              {snap.ui.onTop ? <Pin size={11} /> : <PinOff size={11} />}
            </button>
            <button className={`mt-close ${editing ? "on" : ""}`} onClick={() => setEditing(!editing)} aria-label="Edit session" aria-expanded={editing} title="Name, category, length">
              <Pencil size={11} />
            </button>
            <button className="mt-close" onClick={() => void restoreMain()} aria-label="Open Interval" title="Open Interval">
              <AppWindow size={11} />
            </button>
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
          {editing && <MiniEdit snap={snap} send={send} onDone={() => setEditing(false)} />}
        </>
      )}
    </div>
  );
}

const LENGTHS = [15, 25, 50, 90];

/** The floating timer's edit view: name the session, pick its category and length, abandon it. */
function MiniEdit({ snap, send, onDone }: { snap: TimerBroadcast; send: (cmd: TimerCommand) => void; onDone: () => void }) {
  const idle = snap.status === "idle";
  const onBreak = isBreakStatus(snap.status);
  const active = !idle && snap.status !== "completed";
  const [title, setTitle] = useState(snap.title ?? "");
  const [cat, setCat] = useState<string | null>(snap.categoryId ?? snap.ui.categories[0]?.id ?? null);
  const [custom, setCustom] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  useEffect(() => setTitle(snap.title ?? ""), [snap.title]);
  useEffect(() => {
    if (!onBreak && snap.categoryId) setCat(snap.categoryId);
  }, [snap.categoryId, onBreak]);
  const currentLen = active && snap.phaseMs ? Math.round(snap.phaseMs / 60_000) : snap.ui.focusMin;
  const commitTitle = () => {
    if (!idle && !onBreak && (title.trim() || null) !== (snap.title ?? null)) send({ type: "target", title });
  };
  const pickCat = (id: string) => {
    setCat(id);
    if (!idle && !onBreak) send({ type: "target", categoryId: id });
  };
  const setLen = (m: number) => send({ type: "length", minutes: m });
  const showLength = snap.ui.mode === "pomodoro" ? !(active && !snap.countdown) : active && !!snap.countdown;
  return (
    <div className="mt-edit">
      {!onBreak && (
        <>
          <div className="mt-name-row">
          <button className={`emoji-trigger sm ${startsWithEmoji(title) ? "has" : ""}`} onClick={() => setEmojiOpen((v) => !v)} aria-label="Session icon" title="Put an emoji in front of the name">
            {leadingEmoji(title) ?? <SmilePlus size={13} />}
          </button>
          <input
            className="mt-input"
            placeholder="Name this session…"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") onDone();
            }}
            aria-label="Session name"
          />
          </div>
          {emojiOpen && (
            <EmojiPicker
              className="inline"
              canClear={startsWithEmoji(title)}
              onPick={(e) => {
                const next = withLeadingEmoji(title, e);
                setTitle(next);
                if (!idle && !onBreak) send({ type: "target", title: next });
              }}
              onClose={() => setEmojiOpen(false)}
            />
          )}
          <div className="mt-cats" role="listbox" aria-label="Category">
            {snap.ui.categories.map((c) => (
              <button key={c.id} role="option" aria-selected={c.id === cat} className={`mt-cat ${c.id === cat ? "on" : ""}`} style={{ ["--cc" as string]: c.color }} onClick={() => pickCat(c.id)} title={c.name}>
                <span className="mt-cat-dot" aria-hidden>
                  {c.icon ?? ""}
                </span>
                <span className="mt-cat-name">{c.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {showLength && (
        <div className="mt-lengths" role="group" aria-label="Length in minutes">
          {LENGTHS.map((m) => (
            <button key={m} className={`mt-len ${m === currentLen ? "on" : ""}`} onClick={() => setLen(m)}>
              {m}
            </button>
          ))}
          <input
            className="mt-input mt-len-input"
            inputMode="numeric"
            placeholder={LENGTHS.includes(currentLen) ? "min" : String(currentLen)}
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && Number(custom) > 0) (setLen(Number(custom)), setCustom(""));
            }}
            onBlur={() => Number(custom) > 0 && (setLen(Number(custom)), setCustom(""))}
            aria-label="Custom length in minutes"
          />
        </div>
      )}
      <div className="mt-edit-foot">
        {idle ? (
          <button className="btn btn-focus sm" onClick={() => (send({ type: "start", categoryId: cat ?? undefined, title: title.trim() || null }), onDone())}>
            <Play size={11} fill="currentColor" /> Start {snap.ui.mode === "pomodoro" ? `${currentLen} min` : ""}
          </button>
        ) : active ? (
          <button className="btn btn-ghost sm mt-abandon" onClick={() => setConfirm(true)} title="Discard this session: nothing is recorded">
            <Trash2 size={11} /> Abandon
          </button>
        ) : (
          <span />
        )}
        <button className="btn btn-ghost sm" onClick={onDone}>
          Done
        </button>
      </div>
      {confirm && <AbandonConfirm onBreak={onBreak} onDone={() => setConfirm(false)} onConfirm={() => (send("abandon"), onDone())} />}
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
