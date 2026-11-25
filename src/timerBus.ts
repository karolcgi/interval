// Transport between the main window (which owns the timer) and the floating windows.
//   desktop: Tauri events + the shell's cached snapshot (src-tauri/src/shell.rs)
//   browser preview / tests: a BroadcastChannel, so ?window=mini and ?window=popup work in a tab too
import type { TimerSnapshot } from "./domain/focus";
import type { TimerCommand } from "./state/focus";
import { isTauri } from "./platform";

/** Look of the floating windows, sent along with every snapshot. */
export interface FloatUi {
  theme: "dark" | "light";
  layout: "standard" | "compact";
  opacity: number;
  clickThrough: boolean;
  takesFocus: boolean;
  onTop: boolean;
  /** For the floating timer's edit view. */
  categories: Array<{ id: string; name: string; color: string; icon: string | null }>;
  focusMin: number;
  mode: "pomodoro" | "flowtime" | "stopwatch";
  annotate: boolean; // ask "what did you get done?" on the completion card
}

export type TimerBroadcast = TimerSnapshot & { ui: FloatUi };

type Msg = { type: "snapshot"; data: TimerBroadcast } | { type: "command"; cmd: TimerCommand; rev: number | null } | { type: "hello" } | { type: "popup"; open: boolean };

let channel: BroadcastChannel | null = null;
function bc(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  channel ??= new BroadcastChannel("interval-timer");
  return channel;
}

function onBc(fn: (m: Msg) => void): () => void {
  const c = bc();
  if (!c) return () => {};
  const h = (e: MessageEvent<Msg>) => fn(e.data);
  c.addEventListener("message", h);
  return () => c.removeEventListener("message", h);
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

async function tauriListen<T>(event: string, fn: (payload: T) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (e) => fn(e.payload));
}

// ----------------------------------------------------------------------------- main window side

export function publish(data: TimerBroadcast) {
  if (isTauri()) void tauriInvoke("timer_publish", { snapshot: data }).catch(() => {});
  else bc()?.postMessage({ type: "snapshot", data } satisfies Msg);
}

/** Commands from the floating windows. Browser: new windows say hello and get the latest snapshot. */
export function onCommand(fn: (cmd: TimerCommand, rev: number | null) => void, onHello: () => void): () => void {
  if (isTauri()) {
    let un: (() => void) | undefined;
    let dead = false;
    void tauriListen<{ cmd: TimerCommand; rev: number | null }>("timer-command", (p) => fn(p.cmd, p.rev)).then((u) => (dead ? u() : (un = u)));
    return () => {
      dead = true;
      un?.();
    };
  }
  return onBc((m) => {
    if (m.type === "command") fn(m.cmd, m.rev);
    if (m.type === "hello") onHello();
  });
}

// ------------------------------------------------------------------------- floating window side

export function sendCommand(cmd: TimerCommand, rev: number | null = null) {
  if (isTauri()) {
    void import("@tauri-apps/api/event").then(({ emitTo }) => emitTo("main", "timer-command", { cmd, rev }));
  } else bc()?.postMessage({ type: "command", cmd, rev } satisfies Msg);
}

export function onSnapshot(fn: (s: TimerBroadcast) => void): () => void {
  if (isTauri()) {
    let un: (() => void) | undefined;
    let dead = false;
    void tauriListen<TimerBroadcast>("timer-snapshot", fn).then((u) => (dead ? u() : (un = u)));
    void tauriInvoke<TimerBroadcast | null>("timer_snapshot").then((s) => s && !dead && fn(s));
    return () => {
      dead = true;
      un?.();
    };
  }
  const un = onBc((m) => m.type === "snapshot" && fn(m.data));
  bc()?.postMessage({ type: "hello" } satisfies Msg);
  return un;
}

export async function restoreMain() {
  if (isTauri()) await tauriInvoke("restore_main");
}

export async function closeWindow(which: "mini" | "popup") {
  if (!isTauri()) return;
  if (which === "mini") await tauriInvoke("mini_show", { open: false });
  else await tauriInvoke("popup_close");
}

/** Floating timer: grow for the edit view, shrink back (desktop only). */
/** Resize the completion popup to its card, keeping its bottom edge where it is. */
export async function popupFit(height: number) {
  if (!isTauri()) return;
  await tauriInvoke("popup_fit", { height }).catch(() => {});
}

export async function miniExpand(expanded: boolean, height?: number) {
  if (!isTauri()) return;
  await tauriInvoke("mini_expand", { expanded, height: height ?? null }).catch(() => {});
}
