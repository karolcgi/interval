// Main-window wiring of the focus timer: the engine's clock, the broadcast to the floating windows and
// the tray, commands coming back, sounds/notifications/popup, shell preferences and global shortcuts.
import { useEffect } from "react";
import { store, useApp, type AppState } from "../state/store";
import * as A from "../state/actions";
import * as F from "../state/focus";
import { isTauri } from "../platform";
import { clockValue, isActivePhase, snapshotOf, type FocusState, type TimerSnapshot } from "../domain/focus";
import { fmtClock, fmtDuration } from "../domain/format";
import { MINUTE } from "../domain/time";
import type { Settings } from "../domain/types";
import { onCommand, publish, type TimerBroadcast } from "../timerBus";
import { playSound } from "../sound";
import { systemNotify } from "../notify";

const run = (p: Promise<unknown>) => void p.catch(A.reportError);

async function tauri() {
  return Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")]);
}

/** Runs the timer transitions every second, on wake-ups from the shell, and when the window shows. */
export function useFocusEngine() {
  const ready = useApp((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    void F.tick();
    const t = setInterval(() => void F.tick(), 1000);
    const onVis = () => document.visibilityState === "visible" && void F.tick();
    document.addEventListener("visibilitychange", onVis);
    let un: (() => void) | undefined;
    if (isTauri()) void tauri().then(async ([, ev]) => (un = await ev.listen("timer-wake", () => void F.tick())));
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      un?.();
    };
  }, [ready]);
}

export function resolvedTheme(s: Settings): "dark" | "light" {
  if (s.theme !== "system") return s.theme;
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function currentSnapshot(s: AppState = store.get()): TimerSnapshot {
  const blocks = [...s.blocks, ...s.today.blocks];
  return snapshotOf({
    focus: s.focus,
    running: s.running,
    paused: s.paused,
    runAccumulatedMs: s.runAccumulatedMs,
    categories: s.categories,
    blockTitle: (id) => {
      const b = blocks.find((x) => x.id === id);
      return b ? (b.title ?? s.categories.find((c) => c.id === b.categoryId)?.name ?? null) : null;
    },
  });
}

function broadcastOf(s: AppState): TimerBroadcast {
  return {
    ...currentSnapshot(s),
    ui: {
      theme: resolvedTheme(s.settings),
      layout: s.settings.miniLayout,
      opacity: s.settings.miniOpacity,
      clickThrough: s.settings.miniClickThrough,
      takesFocus: s.settings.focusPopupTakesFocus,
      onTop: s.settings.miniOnTop,
      categories: s.categories.filter((c) => !c.archivedAt && !c.isBreak).map((c) => ({ id: c.id, name: c.name, color: c.color, icon: c.emoji ?? null })),
      focusMin: s.settings.pomodoroFocus,
      annotate: s.settings.annotatePrompt,
      mode: s.settings.focusTimerMode,
    },
  };
}

/** Publishes the timer to the tray and the floating windows whenever it changes; keeps the window title live. */
export function useTimerBroadcast() {
  const ready = useApp((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    let last = "";
    const push = (force = false) => {
      const b = broadcastOf(store.get());
      const key = JSON.stringify(b);
      if (!force && key === last) return;
      last = key;
      publish(b);
    };
    const title = () => {
      const snap = currentSnapshot();
      if (snap.status === "idle") document.title = "Interval";
      else {
        const v = snap.status === "completed" ? snap.label : fmtClock(clockValue(snap, Date.now()));
        document.title = `${v} · ${snap.title || snap.categoryName || snap.label} — Interval`;
      }
    };
    push(true);
    const unsub = store.subscribe(() => push());
    const t = setInterval(title, 1000);
    const unCmd = onCommand(
      (cmd, rev) => run(F.runCommand(cmd, rev)),
      () => push(true),
    );
    return () => {
      unsub();
      unCmd();
      clearInterval(t);
    };
  }, [ready]);
}

/** Tray menu actions, preference changes made from the shell (click-through, mini position). */
export function useShellEvents() {
  const ready = useApp((s) => s.ready);
  useEffect(() => {
    if (!ready || !isTauri()) return;
    const uns: Array<() => void> = [];
    let posTimer: ReturnType<typeof setTimeout> | null = null;
    void tauri().then(async ([, ev]) => {
      uns.push(
        await ev.listen<string>("tray-action", (e) => {
          switch (e.payload) {
            case "toggle":
              return run(F.toggle());
            case "stop":
              return run(F.stop());
            case "skip-break":
              return run(F.skip());
          }
        }),
      );
      uns.push(
        await ev.listen<Partial<Settings>>("shell-pref", (e) => {
          const patch = e.payload;
          if (patch.miniPos) {
            // Window moves arrive continuously while dragging; store the final position only.
            store.set({ settings: { ...store.get().settings, miniPos: patch.miniPos } });
            if (posTimer) clearTimeout(posTimer);
            posTimer = setTimeout(() => run(A.updateSettings({ miniPos: store.get().settings.miniPos })), 600);
          } else run(A.updateSettings(patch));
        }),
      );
    });
    return () => uns.forEach((u) => u());
  }, [ready]);
}

/** Sends the settings the shell acts on by itself (tray, minimize, floating windows). */
export function useShellPrefs() {
  const s = useApp((x) => x.settings);
  const ready = useApp((x) => x.ready);
  const key = JSON.stringify([s.closeToTray, s.minimizeToTray, s.miniAuto, s.miniOnTop, s.miniClickThrough, s.miniHideFullscreen, s.miniLayout, s.focusPopupOverFullscreen, s.focusPopupTakesFocus]);
  useEffect(() => {
    if (!ready || !isTauri()) return;
    const st = store.get().settings;
    const prefs = {
      closeToTray: st.closeToTray,
      minimizeToTray: st.minimizeToTray,
      miniAuto: st.miniAuto,
      miniOnTop: st.miniOnTop,
      miniClickThrough: st.miniClickThrough,
      miniHideFullscreen: st.miniHideFullscreen,
      miniLayout: st.miniLayout,
      miniPos: st.miniPos,
      popupOverFullscreen: st.focusPopupOverFullscreen,
      popupTakesFocus: st.focusPopupTakesFocus,
    };
    void tauri().then(([core]) => core.invoke("set_shell_prefs", { prefs }).catch(() => {}));
  }, [key, ready]);
}

// -------------------------------------------------------------------------------- alerts

export interface Alert {
  kind: "focusEnd" | "cycleEnd" | "breakEnd";
  title: string;
  body: string;
}

/** The one alert a transition deserves (a focus end that also starts a break is one moment, not two). */
export function alertFor(events: F.FocusEvent[], f: FocusState | null): Alert | null {
  const has = (t: F.FocusEventType) => events.some((e) => e.type === t && e.live);
  const c = f?.completed;
  const every = Math.max(1, f?.preset.every ?? 1);
  if (has("cycleEnd") || has("focusEnd")) {
    const mins = c ? fmtDuration(c.activeMs) : "";
    const brk = f?.phase === "break" ? `${f.breakKind === "long" ? "Long" : "Short"} break started · ${Math.round((f.phaseMs ?? 0) / MINUTE)} min` : `Time for a ${f?.suggestedBreakMin ?? 5}-minute break.`;
    if (has("cycleEnd")) return { kind: "cycleEnd", title: `Cycle complete · ${every} rounds`, body: brk };
    return { kind: "focusEnd", title: `Focus complete${mins ? ` · ${mins}` : ""}`, body: brk };
  }
  if (has("breakEnd")) {
    const next = f?.phase === "focus" ? `Focus ${f.round + 1}${f.kind === "pomodoro" ? ` of ${every}` : ""} started.` : f?.phase === "done" ? "Cycle finished. Start a new one when you’re ready." : "Back to focus when you’re ready.";
    return { kind: "breakEnd", title: "Break over", body: next };
  }
  return null;
}

/** Sounds, notifications and the completion popup, according to Settings › Focus timer. */
export function useFocusAlerts() {
  useEffect(
    () =>
      F.onFocusEvents((events, f) => {
        const s = store.get().settings;
        const live = events.filter((e) => e.live);
        if (!live.length) return;
        const alert = alertFor(live, f);
        // One sound per moment, the most meaningful one.
        const order: F.FocusEventType[] = ["cycleEnd", "focusEnd", "breakEnd", "breakStart", "focusStart"];
        const top = order.find((t) => live.some((e) => e.type === t));
        if (top && s.focusNotify !== "silent") void playSound(top);
        if (!alert) return;
        A.toast(`${alert.title} · ${alert.body}`);
        if (s.focusNotify === "silent") return;
        const away = typeof document === "undefined" || document.visibilityState !== "visible" || !document.hasFocus();
        if (s.focusNotify === "system") {
          if (away) void systemNotify(alert.title, alert.body).catch(() => {});
          return;
        }
        // Popup: a small window of its own (desktop) or a card inside the app (browser).
        if (isTauri()) {
          void tauri()
            .then(([core]) => core.invoke<boolean>("popup_show"))
            .then((shown) => {
              if (!shown && away) void systemNotify(alert.title, alert.body);
            })
            .catch(() => {});
        } else store.set({ completionPopup: Date.now() });
      }),
    [],
  );
}

// ----------------------------------------------------------------------- global shortcuts

export const GLOBAL_ACTIONS: Array<{ id: string; label: string }> = [
  { id: "toggle", label: "Start / pause / resume" },
  { id: "mini", label: "Show or hide the floating timer" },
  { id: "clickThrough", label: "Toggle floating timer click-through" },
];

export async function runGlobal(id: string) {
  if (!isTauri()) return;
  const [core] = await tauri();
  if (id === "toggle") return F.toggle();
  if (id === "mini") {
    const open = await core.invoke<boolean>("mini_is_open");
    return core.invoke("mini_show", { open: !open });
  }
  if (id === "clickThrough") {
    const on = !store.get().settings.miniClickThrough;
    await core.invoke("mini_click_through", { on });
    await A.updateSettings({ miniClickThrough: on });
    A.toast(on ? "Floating timer is click-through" : "Floating timer is clickable again");
  }
}

/** Registers the system-wide shortcuts (work while another app has focus). Failures are reported, not fatal. */
export function useGlobalShortcuts() {
  const ready = useApp((s) => s.ready);
  const map = useApp((s) => s.settings.globalShortcuts);
  const key = JSON.stringify(map);
  useEffect(() => {
    if (!ready || !isTauri()) return;
    let alive = true;
    void (async () => {
      try {
        const gs = await import("@tauri-apps/plugin-global-shortcut");
        await gs.unregisterAll();
        const failed: string[] = [];
        for (const [id, accel] of Object.entries(store.get().settings.globalShortcuts ?? {})) {
          if (!accel || !alive) continue;
          try {
            await gs.register(accel, (e) => {
              if (e.state === "Pressed") void runGlobal(id).catch(A.reportError);
            });
          } catch {
            failed.push(accel);
          }
        }
        store.set({ globalShortcutErrors: failed });
      } catch (e) {
        console.warn("global shortcuts unavailable", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, key]);
}

export function timerIsActive(s: AppState = store.get()): boolean {
  return isActivePhase(s.focus) || !!s.running || !!s.paused;
}
