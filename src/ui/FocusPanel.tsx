// Docked focus timer in the sidebar, under Activities. Renders the shared timer; every action goes
// through the engine (state/focus.ts), exactly like the tray, the floating timer and the popup.
import { blockName } from "../state/blockName";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ChevronDown, Link2, Trash2, PictureInPicture2, Play, Pause, RotateCcw, Settings2, SkipForward, Square, Unlink, X } from "lucide-react";
import { store, useApp, useNow } from "../state/store";
import * as A from "../state/actions";
import * as F from "../state/focus";
import { clockValue, isBreakStatus, progressValue, suggestBlock, type TimerSnapshot } from "../domain/focus";
import { fmtClock, fmtTime } from "../domain/format";
import { isTauri } from "../platform";
import { CatDot, catVars, useOutside } from "./bits";
import type { Category } from "../domain/types";
import { currentSnapshot } from "./useFocusEngine";
import { AnnotateBox } from "./Annotate";
import { useState } from "react";

const run = (p: Promise<unknown>) => void p.catch(A.reportError);

const MODES = [
  { value: "pomodoro" as const, label: "Pomodoro" },
  { value: "stopwatch" as const, label: "Stopwatch" },
  { value: "flowtime" as const, label: "Flowtime" },
];

export async function toggleMini() {
  if (!isTauri()) return A.toast("The floating timer is available in the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  const open = await invoke<boolean>("mini_is_open");
  await invoke("mini_show", { open: !open });
}

export function CycleDots({ snap, className = "" }: { snap: TimerSnapshot; className?: string }) {
  if (!snap.roundOf) return null;
  const inCycle = snap.round % snap.roundOf;
  const full = snap.round > 0 && inCycle === 0 && snap.phase !== "focus";
  const done = full ? snap.roundOf : inCycle;
  return (
    <span className={`cycle-dots ${className}`} aria-label={`${done} of ${snap.roundOf} rounds done`} title={`${done} of ${snap.roundOf} rounds done`}>
      {Array.from({ length: Math.min(snap.roundOf, 12) }, (_, i) => (
        <span key={i} className={`cycle-dot ${i < done ? "done" : ""} ${i === done && snap.status === "focusing" ? "current" : ""}`} />
      ))}
    </span>
  );
}

export function FocusPanel() {
  const settings = useApp((s) => s.settings);
  const focus = useApp((s) => s.focus);
  const running = useApp((s) => s.running);
  const paused = useApp((s) => s.paused);
  const categories = useApp((s) => s.categories);
  const blocks = useApp((s) => s.today.blocks);
  useApp((s) => s.runAccumulatedMs);
  const now = useNow(500);
  const snap = useMemo(() => currentSnapshot(), [focus, running, paused, categories, blocks]); // eslint-disable-line react-hooks/exhaustive-deps
  const [manualCat, setManualCat] = useState<string | null>(null);
  const [linkOff, setLinkOff] = useState<string | null>(null);

  const open = settings.focusPanelOpen;
  const idle = snap.status === "idle";
  const onBreak = isBreakStatus(snap.status) || (snap.status === "completed" && snap.phase === "suggest");
  const tone = onBreak ? "break" : snap.status === "completed" ? "done" : "focus";
  const mode = idle ? settings.focusTimerMode : (snap.kind ?? settings.focusTimerMode);
  const clock = idle ? (mode === "pomodoro" ? settings.pomodoroFocus * 60_000 : 0) : clockValue(snap, now);
  const progress = progressValue(snap, now);
  const runningNow = snap.status === "focusing" || snap.status === "short_break" || snap.status === "long_break";
  const pausedNow = snap.status === "focus_paused" || snap.status === "break_paused";

  // Idle: offer the block happening now (or soon); the user can unlink it or pick a category instead.
  const suggestion = useMemo(() => (idle ? suggestBlock(blocks, now) : null), [idle, blocks, Math.floor(now / 30_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const linked = suggestion && linkOff !== suggestion.block.id ? suggestion : null;
  const defaultCat = categories.find((c) => !c.archivedAt && !c.isBreak)?.id ?? "";
  const idleCat = linked ? linked.block.categoryId : (manualCat ?? defaultCat);

  const start = () => {
    const target = linked ? { blockId: linked.block.id } : { categoryId: idleCat };
    run(F.start(mode, target));
  };
  const setMode = (m: typeof mode) => run(A.updateSettings({ focusTimerMode: m }));
  const choosePreset = (id: string) => {
    const p = settings.focusPresets.find((x) => x.id === id);
    if (p) run(A.updateSettings({ pomodoroFocus: p.focus, pomodoroBreak: p.brk, pomodoroLongBreak: p.long, pomodoroLongEvery: p.every }));
  };
  const presetOn = (p: { focus: number; brk: number; long: number; every: number }) =>
    p.focus === settings.pomodoroFocus && p.brk === settings.pomodoroBreak && p.long === settings.pomodoroLongBreak && p.every === settings.pomodoroLongEvery;

  const header = (
    <div className="ftp-head">
      <button className="ftp-toggle" onClick={() => run(A.updateSettings({ focusPanelOpen: !open }))} aria-expanded={open} aria-controls="focus-panel-body">
        <span className="eyebrow">Focus timer</span>
        <ChevronDown size={12} className={`ftp-chev ${open ? "" : "closed"}`} />
      </button>
      {!open && !idle && (
        <span className={`ftp-mini-clock tone-${tone}`} aria-label="Timer">
          {snap.status === "completed" ? snap.label : fmtClock(clock)}
        </span>
      )}
      <button className="icon-btn sm" onClick={() => (A.setView("settings"), store.set({ settingsAnchor: "focus-timer" }))} aria-label="Focus timer settings" title="Focus timer settings">
        <Settings2 size={13} />
      </button>
    </div>
  );

  if (!open) return <div className="side-section focus-panel collapsed">{header}</div>;

  return (
    <div className={`side-section focus-panel tone-${tone} ${pausedNow ? "is-paused" : ""} ${runningNow ? "is-running" : ""}`} aria-label="Focus timer">
      {header}
      <div id="focus-panel-body" className="ftp-body">
        {idle && <ModeTabs value={mode} onChange={setMode} />}

        <div className="ftp-phase">
          <span className="ftp-dot" aria-hidden />
          <span className="ftp-label">{idle ? (mode === "pomodoro" ? `Focus 1 of ${Math.max(1, settings.pomodoroLongEvery)}` : mode === "flowtime" ? "Flowtime" : "Stopwatch") : snap.label}</span>
          {!idle && snap.kind !== "pomodoro" && <span className="ftp-kind">{snap.kind === "flowtime" ? "Flowtime" : "Stopwatch"}</span>}
          <CycleDots snap={idle && mode === "pomodoro" ? { ...snap, roundOf: Math.max(1, settings.pomodoroLongEvery), round: 0 } : snap} />
        </div>

        <div className="ftp-clock-row">
          <div className="ftp-clock" role="timer" aria-live="off">
            {fmtClock(clock)}
          </div>
          {!idle && snap.status !== "completed" && snap.countdown && (
            <div className="ftp-exts" role="group" aria-label="Extend">
              <button className="ftp-ext" onClick={() => run(F.extend(5))} title="Add 5 minutes" aria-label="Add 5 minutes">
                +5
              </button>
              <button className="ftp-ext" onClick={() => run(F.extend(10))} title="Add 10 minutes" aria-label="Add 10 minutes">
                +10
              </button>
            </div>
          )}
        </div>
        <div className="ftp-bar" aria-hidden>
          <span style={{ transform: `scaleX(${progress ?? (runningNow && !snap.countdown ? 1 : 0)})` }} className={progress === null && runningNow ? "indeterminate" : ""} />
        </div>
        {snap.next && !idle && <div className="ftp-next">Next · {snap.next}</div>}

        {idle && mode === "pomodoro" && (
          <div className="ftp-presets" role="group" aria-label="Duration presets">
            {settings.focusPresets.map((p) => (
              <button key={p.id} className={`chip ${presetOn(p) ? "on" : ""}`} onClick={() => choosePreset(p.id)} title={`${p.focus} min focus, ${p.brk} min break, ${p.long} min long break every ${p.every}`}>
                {p.focus}
              </button>
            ))}
            {!settings.focusPresets.some(presetOn) && <span className="chip on custom">{settings.pomodoroFocus}</span>}
          </div>
        )}

        <div className="ftp-target">
          {idle ? (
            <>
              <CategoryPicker
                categories={categories}
                value={idleCat}
                onChange={(id) => {
                  setManualCat(id);
                  if (linked && id !== linked.block.categoryId) setLinkOff(linked.block.id);
                }}
              />
              {linked ? (
                <div className="ftp-block" title="Time will be recorded against this planned block">
                  <Link2 size={12} />
                  <span className="ftp-block-name">
                    {blockName(linked.block, categories.find((c) => c.id === linked.block.categoryId)?.name)}
                    <span className="muted">
                      {" "}
                      {linked.when === "soon" ? "starts" : ""} {fmtTime(linked.block.startAt, settings.timeFormat)}–{fmtTime(linked.block.endAt, settings.timeFormat)}
                    </span>
                  </span>
                  <button className="icon-btn sm" onClick={() => setLinkOff(linked.block.id)} aria-label="Don’t link to this block" title="Start without this block">
                    <Unlink size={12} />
                  </button>
                </div>
              ) : (
                suggestion && (
                  <button className="link small ftp-relink" onClick={() => (setLinkOff(null), setManualCat(null))}>
                    <Link2 size={11} /> Link “{blockName(suggestion.block, categories.find((c) => c.id === suggestion.block.categoryId)?.name)}”
                  </button>
                )
              )}
            </>
          ) : onBreak ? (
            <>
              <span className="ftp-break-note">{snap.categoryName && snap.status !== "completed" ? snap.categoryName : "Break"}</span>
              {settings.annotatePrompt && snap.completed?.phase === "focus" && <AnnotateBox key={snap.completed.runId} className="compact" completed={snap.completed} send={(cmd) => run(F.runCommand(cmd))} />}
            </>
          ) : (
            <>
              <CategoryPicker categories={categories} value={snap.categoryId ?? defaultCat} onChange={(categoryId) => run(F.setTarget({ categoryId }))} />
              {snap.blockId && (
                <div className="ftp-block linked">
                  <Link2 size={12} />
                  <span className="ftp-block-name">{snap.blockTitle ?? "Planned block"}</span>
                  <button className="icon-btn sm" onClick={() => run(F.setTarget({ blockId: null }))} aria-label="Unlink block" title="Keep recording, but not against this block">
                    <X size={12} />
                  </button>
                </div>
              )}
              {snap.title && !snap.blockId && <div className="ftp-title">{snap.title}</div>}
            </>
          )}
        </div>

        <Controls snap={snap} idle={idle} onStart={start} />
      </div>
    </div>
  );
}

function ModeTabs({ value, onChange }: { value: string; onChange: (v: "pomodoro" | "stopwatch" | "flowtime") => void }) {
  return (
    <div className="ftp-modes" role="tablist" aria-label="Timer mode">
      {MODES.map((m) => (
        <button key={m.value} role="tab" aria-selected={value === m.value} className={value === m.value ? "on" : ""} onClick={() => onChange(m.value)}>
          {m.label}
        </button>
      ))}
    </div>
  );
}

function Controls({ snap, idle, onStart }: { snap: TimerSnapshot; idle: boolean; onStart: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const mini = (
    <button className="icon-btn sm" onClick={() => run(toggleMini())} aria-label="Floating timer" title="Floating timer">
      <PictureInPicture2 size={13} />
    </button>
  );
  if (idle) {
    return (
      <div className="ftp-controls">
        <button className="btn btn-focus sm" onClick={onStart}>
          <Play size={11} fill="currentColor" /> Start
        </button>
        <span className="ftp-spacer" />
        {mini}
      </div>
    );
  }
  if (snap.status === "completed") {
    const c = snap.completed;
    const afterFocus = snap.phase === "suggest";
    return (
      <div className="ftp-controls wrap">
        {afterFocus ? (
          <button className="btn btn-break sm" onClick={() => run(F.startBreak())}>
            Start break
          </button>
        ) : (
          <button className="btn btn-focus sm" onClick={() => run(F.nextRound())}>
            <Play size={11} fill="currentColor" /> {snap.phase === "done" ? "New cycle" : "Next round"}
          </button>
        )}
        {c && snap.kind === "pomodoro" && (
          <button className="btn btn-ghost sm" onClick={() => run(F.extendCompleted(5))} title={afterFocus ? "Keep focusing for 5 more minutes" : "Five more minutes of break"}>
            +5 {afterFocus ? "focus" : "break"}
          </button>
        )}
        <button className="btn btn-ghost sm" onClick={() => run(F.finish())}>
          Finish
        </button>
        <span className="ftp-spacer" />
        {mini}
      </div>
    );
  }
  const paused = snap.status === "focus_paused" || snap.status === "break_paused";
  const onBreak = isBreakStatus(snap.status);
  return (
    <>
    <div className="ftp-controls">
      {paused ? (
        <button className={`btn ${onBreak ? "btn-break" : "btn-focus"} sm`} onClick={() => run(F.resume())} aria-label="Resume">
          <Play size={11} fill="currentColor" /> Resume
        </button>
      ) : (
        <button className="btn btn-outline sm" onClick={() => run(F.pause())} aria-label="Pause">
          <Pause size={11} fill="currentColor" /> Pause
        </button>
      )}
      <button className="icon-btn sm" onClick={() => run(F.stop())} aria-label="Stop" title={snap.kind === "flowtime" && !onBreak ? "Stop and take a break" : "Stop and record"}>
        <Square size={11} fill="currentColor" />
      </button>
      {snap.countdown && (
        <button className="icon-btn sm" onClick={() => run(F.reset())} aria-label="Reset" title="Restart this phase from the top (time so far stays recorded)">
          <RotateCcw size={12} />
        </button>
      )}
      {snap.kind !== "stopwatch" && (
        <button className="icon-btn sm" onClick={() => run(F.skip())} aria-label={onBreak ? "Skip break" : "Skip to break"} title={onBreak ? "Skip break" : "Skip to break"}>
          <SkipForward size={12} />
        </button>
      )}
      <button className="icon-btn sm" onClick={() => setConfirm(true)} aria-label="Abandon" title={onBreak ? "Abandon this break (not recorded)" : "Abandon this session: nothing is recorded"}>
        <Trash2 size={12} />
      </button>
      <span className="ftp-spacer" />
      {mini}
    </div>
    {confirm && <AbandonConfirm onBreak={onBreak} onDone={() => setConfirm(false)} onConfirm={() => run(F.abandon())} />}
    </>
  );
}

/** Second step of Abandon, so a stray click never throws away an hour of work. */
export function AbandonConfirm(p: { onBreak: boolean; onConfirm: () => void; onDone: () => void }) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus();
    const t = setTimeout(p.onDone, 8000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onDone();
    window.addEventListener("keydown", onKey);
    return () => (clearTimeout(t), window.removeEventListener("keydown", onKey));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="abandon-confirm" role="alertdialog" aria-label="Abandon session">
      <span>{p.onBreak ? "Discard this break?" : "Discard this session?"} Nothing is recorded.</span>
      <span className="abandon-actions">
        <button className="btn btn-danger sm" onClick={() => (p.onConfirm(), p.onDone())}>
          Discard
        </button>
        <button ref={keep} className="btn btn-ghost sm" onClick={p.onDone}>
          Keep
        </button>
      </span>
    </div>
  );
}

/** Category chooser for the panel: an in-page list rather than a native <select>, whose system popup
 *  closes by itself in the desktop webview while the timer keeps redrawing the panel. */
export function CategoryPicker(p: { categories: Category[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const options = p.categories.filter((c) => !c.archivedAt && !c.isBreak);
  const current = p.categories.find((c) => c.id === p.value);
  const close = useCallback(() => setOpen(false), []);
  useOutside(ref, open ? close : () => {});
  const choose = (id: string) => {
    setOpen(false);
    if (id !== p.value) p.onChange(id);
  };
  const toggle = () => {
    setHi(Math.max(0, options.findIndex((c) => c.id === p.value)));
    setOpen(!open);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") (e.preventDefault(), toggle());
      return;
    }
    e.stopPropagation();
    if (e.key === "Escape") (e.preventDefault(), setOpen(false));
    else if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(options.length - 1, h + 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(0, h - 1)));
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (options[hi]) choose(options[hi].id);
    }
  };
  return (
    <div className="ftp-cat" ref={ref} style={catVars(current?.color ?? "#888")}>
      <button type="button" className="cat-select ftp-cat-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={`Category: ${current?.name ?? "none"}`} onClick={toggle} onKeyDown={onKey}>
        <CatDot color={current?.color ?? "#888"} icon={current?.icon} />
        <span className="ftp-cat-name">{current?.name ?? "Choose a category"}</span>
        <ChevronDown size={12} className="muted" />
      </button>
      {open && (
        <ul className="ftp-cat-list popover" role="listbox" aria-label="Category" onKeyDown={onKey}>
          {options.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={c.id === p.value}
              className={`${i === hi ? "hi" : ""} ${c.id === p.value ? "on" : ""}`}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(c.id)}
            >
              <CatDot color={c.color} icon={c.icon} />
              <span>
                {c.parentId ? "↳ " : ""}
                {c.name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
