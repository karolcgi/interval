// Settings › Focus timer: presets, durations, transitions, notifications, sounds, floating timer,
// tray, break recording and shortcuts.
import { useEffect, useRef, useState } from "react";
import { Play, Plus, Trash2, Upload, X } from "lucide-react";
import { store, useApp } from "../state/store";
import * as A from "../state/actions";
import { isTauri } from "../platform";
import { Segmented } from "./bits";
import { NumField, Row } from "./SettingsView";
import { SOUND_EVENTS, importSound, playSound } from "../sound";
import { GLOBAL_ACTIONS } from "./useFocusEngine";
import type { FocusPreset } from "../domain/focus";
import type { Settings, SoundEvent } from "../domain/types";

const run = (p: Promise<unknown>) => void p.catch(A.reportError);

export function FocusTimerSettings({ part = "all" }: { part?: "all" | "timer" | "alerts" | "window" }) {
  const show = (x: string) => part === "all" || part === x;
  const s = useApp((x) => x.settings);
  const categories = useApp((x) => x.categories);
  const anchor = useApp((x) => x.settingsAnchor);
  const ref = useRef<HTMLHeadingElement>(null);
  const set = (patch: Partial<Settings>) => run(A.updateSettings(patch));
  const desktop = isTauri();

  useEffect(() => {
    if (anchor !== "focus-timer") return;
    ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    store.set({ settingsAnchor: null });
  }, [anchor]);

  return (
    <>
      {show("timer") && (
      <>
      <h2 className="section-title" id="focus-timer" ref={ref}>
        Focus timer
      </h2>
      <div className="settings-block">
        <Row label="Presets" hint="Quick choices in the timer panel. Click one to use it; built-in presets can’t be deleted.">
          <PresetEditor />
        </Row>
        <Row label="Focus" hint="Current Pomodoro round length">
          <NumField label="Focus minutes" value={s.pomodoroFocus} min={1} max={600} onChange={(pomodoroFocus) => set({ pomodoroFocus })} suffix="min" />
        </Row>
        <Row label="Short break">
          <NumField label="Short break minutes" value={s.pomodoroBreak} min={1} max={240} onChange={(pomodoroBreak) => set({ pomodoroBreak })} suffix="min" />
        </Row>
        <Row label="Long break">
          <NumField label="Long break minutes" value={s.pomodoroLongBreak} min={1} max={480} onChange={(pomodoroLongBreak) => set({ pomodoroLongBreak })} suffix="min" />
        </Row>
        <Row label="Sessions before a long break" hint="One cycle. The long break comes after the last round of each cycle.">
          <NumField label="Sessions before a long break" value={s.pomodoroLongEvery} min={1} max={24} onChange={(pomodoroLongEvery) => set({ pomodoroLongEvery })} suffix="rounds" />
        </Row>
        <Row label="Start breaks automatically" hint="Otherwise the timer waits for you when a round ends">
          <input type="checkbox" checked={s.focusAutoBreak} onChange={(e) => set({ focusAutoBreak: e.target.checked })} aria-label="Start breaks automatically" />
        </Row>
        <Row label="Start focus automatically" hint="Begin the next round as soon as a break ends. Never after sleep.">
          <input type="checkbox" checked={s.focusAutoFocus} onChange={(e) => set({ focusAutoFocus: e.target.checked })} aria-label="Start focus automatically" />
        </Row>
        <Row label="Record breaks" hint="Breaks become sessions in the break category (reported separately, never as work). Break time is kept in focus history either way.">
          <input type="checkbox" checked={s.focusRecordBreaks} onChange={(e) => set({ focusRecordBreaks: e.target.checked })} aria-label="Record breaks" />
          <select className="select sm" value={s.breakCategoryId ?? ""} onChange={(e) => set({ breakCategoryId: e.target.value || null })} aria-label="Break category" disabled={!s.focusRecordBreaks}>
            <option value="">First break category</option>
            {categories
              .filter((c) => !c.archivedAt)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Row>
        <Row label="Stopwatch reminder" hint="One gentle nudge after a long unbroken stopwatch stretch. 0 turns it off.">
          <NumField label="Break reminder minutes" value={s.breakReminderMinutes} min={0} max={480} onChange={(breakReminderMinutes) => set({ breakReminderMinutes })} suffix="min" />
        </Row>
      </div>

      </>
      )}
      {show("alerts") && (
      <>
      <h3 className="sub-title">Notifications</h3>
      <div className="settings-block">
        <Row label="When a round or break ends" hint="Silent: the timer only changes colour. Notification: a sound and a Windows notification. Popup: a sound and a small Interval card with the next step.">
          <Segmented
            value={s.focusNotify}
            onChange={(focusNotify) => set({ focusNotify })}
            options={[
              { value: "silent", label: "Silent" },
              { value: "system", label: "Notification" },
              { value: "popup", label: "Popup" },
            ]}
            ariaLabel="Notification mode"
          />
        </Row>
        {s.focusNotify === "popup" && (
          <>
            <Row label="Popup takes keyboard focus" hint="Off: it appears without interrupting what you are typing">
              <input type="checkbox" checked={s.focusPopupTakesFocus} onChange={(e) => set({ focusPopupTakesFocus: e.target.checked })} aria-label="Popup takes keyboard focus" />
            </Row>
            <Row label="Show over fullscreen apps" hint="Off: during fullscreen work (games, video, presentations) a quiet notification is used instead">
              <input type="checkbox" checked={s.focusPopupOverFullscreen} onChange={(e) => set({ focusPopupOverFullscreen: e.target.checked })} aria-label="Show popup over fullscreen apps" />
            </Row>
          </>
        )}
        <Row label="Other reminders" hint="Windows notifications for the stopwatch reminder when Interval is in the background">
          <input type="checkbox" checked={s.notifications} onChange={(e) => set({ notifications: e.target.checked })} aria-label="Notifications" />
        </Row>
      </div>

      <h3 className="sub-title">Sounds</h3>
      <div className="settings-block">
        <Row label="Sounds" hint="Quiet mallet and bell cues made for Interval">
          <input type="checkbox" checked={s.sounds} onChange={(e) => set({ sounds: e.target.checked })} aria-label="Sounds" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.soundVolume}
            disabled={!s.sounds}
            onChange={(e) => store.set({ settings: { ...store.get().settings, soundVolume: Number(e.target.value) } })}
            onPointerUp={() => set({ soundVolume: store.get().settings.soundVolume })}
            onKeyUp={() => set({ soundVolume: store.get().settings.soundVolume })}
            aria-label="Master volume"
            className="range"
          />
          <span className="muted small num">{Math.round(s.soundVolume * 100)}%</span>
        </Row>
        {SOUND_EVENTS.map((ev) => (
          <SoundRow key={ev.id} id={ev.id} label={ev.label} disabled={!s.sounds} />
        ))}
      </div>

      </>
      )}
      {show("window") && (
      <>
      <h3 className="sub-title">Floating timer</h3>
      <div className="settings-block">
        {!desktop && <p className="muted small pad">The floating timer, tray and system-wide shortcuts are part of the desktop app.</p>}
        <Row label="Show when Interval is minimized" hint="Appears while a timer is active and goes away when you come back">
          <input type="checkbox" checked={s.miniAuto} onChange={(e) => set({ miniAuto: e.target.checked })} aria-label="Show floating timer when minimized" />
        </Row>
        <Row label="Layout">
          <Segmented
            value={s.miniLayout}
            onChange={(miniLayout) => set({ miniLayout })}
            options={[
              { value: "standard", label: "Standard" },
              { value: "compact", label: "Compact" },
            ]}
            ariaLabel="Floating timer layout"
          />
        </Row>
        <Row label="Always on top">
          <input type="checkbox" checked={s.miniOnTop} onChange={(e) => set({ miniOnTop: e.target.checked })} aria-label="Floating timer always on top" />
        </Row>
        <Row label="Opacity">
          <input
            type="range"
            min={0.4}
            max={1}
            step={0.02}
            value={s.miniOpacity}
            onChange={(e) => store.set({ settings: { ...store.get().settings, miniOpacity: Number(e.target.value) } })}
            onPointerUp={() => set({ miniOpacity: store.get().settings.miniOpacity })}
            onKeyUp={() => set({ miniOpacity: store.get().settings.miniOpacity })}
            aria-label="Floating timer opacity"
            className="range"
          />
          <span className="muted small num">{Math.round(s.miniOpacity * 100)}%</span>
        </Row>
        <Row label="Click-through" hint="Clicks pass through the floating timer to the app underneath. Turn it off here, from the tray menu, or with the shortcut below.">
          <input type="checkbox" checked={s.miniClickThrough} onChange={(e) => set({ miniClickThrough: e.target.checked })} aria-label="Floating timer click-through" />
        </Row>
        <Row label="Hide during fullscreen apps">
          <input type="checkbox" checked={s.miniHideFullscreen} onChange={(e) => set({ miniHideFullscreen: e.target.checked })} aria-label="Hide floating timer during fullscreen apps" />
        </Row>
        <Row label="Position" hint="Drag the floating timer anywhere, on any monitor. Double-click it to bring Interval back.">
          <button className="btn btn-ghost sm" disabled={!s.miniPos} onClick={() => set({ miniPos: null })}>
            Reset to bottom right
          </button>
        </Row>
      </div>

      <h3 className="sub-title">System tray</h3>
      <div className="settings-block">
        <Row label="Minimize to tray" hint="Minimizing hides Interval from the taskbar; the timer keeps running and the tray icon brings it back">
          <input type="checkbox" checked={s.minimizeToTray} onChange={(e) => set({ minimizeToTray: e.target.checked })} aria-label="Minimize to tray" />
        </Row>
        <Row label="Close to tray" hint="Closing the window keeps Interval, the timer and the floating timer running. Right-click the tray icon › Exit Interval to quit.">
          <input type="checkbox" checked={s.closeToTray} onChange={(e) => set({ closeToTray: e.target.checked })} aria-label="Close to tray" />
        </Row>
      </div>

      <h3 className="sub-title">System-wide shortcuts</h3>
      <GlobalShortcutEditor />
      </>
      )}
    </>
  );
}

function SoundRow({ id, label, disabled }: { id: SoundEvent; label: string; disabled: boolean }) {
  const cfg = useApp((x) => x.settings.soundEvents[id]);
  const all = useApp((x) => x.settings.soundEvents);
  const save = (patch: Partial<typeof cfg>) => run(A.updateSettings({ soundEvents: { ...all, [id]: { ...cfg, ...patch } } }));
  return (
    <div className="set-row sound-row">
      <div className="set-label">
        <div>{label}</div>
        {cfg.file && <div className="set-hint">Custom: {cfg.file.split(/[\\/]/).pop()}</div>}
      </div>
      <div className="set-control">
        <input type="checkbox" checked={cfg.on} disabled={disabled} onChange={(e) => save({ on: e.target.checked })} aria-label={`${label} sound`} />
        <input type="range" min={0} max={1} step={0.05} value={cfg.volume} disabled={disabled || !cfg.on} onChange={(e) => save({ volume: Number(e.target.value) })} aria-label={`${label} volume`} className="range sm" />
        <button className="icon-btn sm" onClick={() => void playSound(id, { force: true })} aria-label={`Preview ${label}`} title="Preview">
          <Play size={11} fill="currentColor" />
        </button>
        {isTauri() && (
          <button className="icon-btn sm" onClick={() => run(importSound(id).then((file) => file && save({ file })))} aria-label={`Import a sound for ${label}`} title="Use your own sound file">
            <Upload size={12} />
          </button>
        )}
        {cfg.file && (
          <button className="icon-btn sm" onClick={() => save({ file: null })} aria-label={`Use the built-in sound for ${label}`} title="Back to the built-in sound">
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function PresetEditor() {
  const s = useApp((x) => x.settings);
  const [draft, setDraft] = useState<FocusPreset | null>(null);
  const on = (p: FocusPreset) => p.focus === s.pomodoroFocus && p.brk === s.pomodoroBreak && p.long === s.pomodoroLongBreak && p.every === s.pomodoroLongEvery;
  const use = (p: FocusPreset) => run(A.updateSettings({ pomodoroFocus: p.focus, pomodoroBreak: p.brk, pomodoroLongBreak: p.long, pomodoroLongEvery: p.every }));
  const remove = (id: string) => run(A.updateSettings({ focusPresets: s.focusPresets.filter((p) => p.id !== id) }));
  const add = () => {
    if (!draft) return;
    const clash = s.focusPresets.some((p) => p.focus === draft.focus && p.brk === draft.brk && p.long === draft.long && p.every === draft.every);
    if (!clash) run(A.updateSettings({ focusPresets: [...s.focusPresets, draft] }));
    setDraft(null);
  };
  return (
    <div className="preset-editor">
      <div className="preset-list">
        {s.focusPresets.map((p) => (
          <span key={p.id} className={`chip preset-chip ${on(p) ? "on" : ""}`}>
            <button onClick={() => use(p)} title="Use this preset">
              {p.focus}/{p.brk} <span className="muted">· {p.long} every {p.every}</span>
            </button>
            {!p.builtIn && (
              <button className="chip-x" onClick={() => remove(p.id)} aria-label={`Delete preset ${p.focus}/${p.brk}`}>
                <Trash2 size={11} />
              </button>
            )}
          </span>
        ))}
        {!draft && (
          <button className="chip" onClick={() => setDraft({ id: `p-${Date.now().toString(36)}`, focus: s.pomodoroFocus, brk: s.pomodoroBreak, long: s.pomodoroLongBreak, every: s.pomodoroLongEvery })}>
            <Plus size={11} /> New preset
          </button>
        )}
      </div>
      {draft && (
        <div className="preset-draft">
          <NumField label="Preset focus minutes" value={draft.focus} min={1} max={600} onChange={(focus) => setDraft({ ...draft, focus })} suffix="focus" />
          <NumField label="Preset break minutes" value={draft.brk} min={1} max={240} onChange={(brk) => setDraft({ ...draft, brk })} suffix="break" />
          <NumField label="Preset long break minutes" value={draft.long} min={1} max={480} onChange={(long) => setDraft({ ...draft, long })} suffix="long" />
          <NumField label="Preset rounds per cycle" value={draft.every} min={1} max={24} onChange={(every) => setDraft({ ...draft, every })} suffix="rounds" />
          <button className="btn btn-outline sm" onClick={add}>
            Save preset
          </button>
          <button className="btn btn-ghost sm" onClick={() => setDraft(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** Accelerators for the system-wide shortcuts (work while another app is in front). */
function GlobalShortcutEditor() {
  const map = useApp((x) => x.settings.globalShortcuts);
  const errors = useApp((x) => x.globalShortcutErrors);
  const [capturing, setCapturing] = useState<string | null>(null);
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setCapturing(null);
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
      const mods = [e.ctrlKey ? "Ctrl" : "", e.altKey ? "Alt" : "", e.shiftKey ? "Shift" : ""].filter(Boolean);
      if (mods.length < 2) return; // system-wide shortcuts need two modifiers so they never steal an app's keys
      const key = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : e.code;
      const accel = [...mods, key].join("+");
      const next = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v === accel ? "" : v]));
      next[capturing] = accel;
      setCapturing(null);
      run(A.updateSettings({ globalShortcuts: next }));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, map]);
  return (
    <div className="settings-block shortcuts editable">
      {GLOBAL_ACTIONS.map((a) => {
        const accel = map[a.id] ?? "";
        return (
          <div key={a.id} className="shortcut-row">
            <button className={`kbd-btn ${capturing === a.id ? "capturing" : ""}`} onClick={() => setCapturing(capturing === a.id ? null : a.id)} aria-label={`System-wide shortcut for ${a.label}`}>
              {capturing === a.id ? "Press two modifiers + a key…" : accel ? accel.replace(/\+/g, " ") : "Off"}
            </button>
            <span>{a.label}</span>
            {accel && (
              <button className="link-btn" onClick={() => run(A.updateSettings({ globalShortcuts: { ...map, [a.id]: "" } }))}>
                Turn off
              </button>
            )}
            {errors.includes(accel) && accel && <span className="warn small">Taken by another app</span>}
          </div>
        );
      })}
      <p className="muted small">In-app timer keys (start/pause, skip, +5 minutes, floating timer) are under Keyboard below.</p>
    </div>
  );
}
