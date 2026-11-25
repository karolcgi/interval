// Notifications and sounds. Respect the user's settings; never nag.
import { store } from "./state/store";
import { isTauri } from "./platform";
import { toast } from "./state/actions";

let permission: boolean | null = null;

async function systemNotify(title: string, body: string) {
  if (isTauri()) {
    const n = await import("@tauri-apps/plugin-notification");
    if (permission === null) permission = (await n.isPermissionGranted()) || (await n.requestPermission()) === "granted";
    if (permission) n.sendNotification({ title, body });
    return;
  }
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") await Notification.requestPermission();
  if (Notification.permission === "granted") new Notification(title, { body });
}

/** A soft two-note chime, synthesised (no audio assets). */
export function chime() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const t0 = ctx.currentTime;
    [
      [659.25, 0],
      [987.77, 0.16],
    ].forEach(([freq, delay]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t0 + delay);
      g.gain.linearRampToValueAtTime(0.12, t0 + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 1.1);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + delay);
      o.stop(t0 + delay + 1.2);
    });
    setTimeout(() => void ctx.close(), 1600);
  } catch {
    /* audio unavailable */
  }
}

export function notify(title: string, body: string) {
  const s = store.get().settings;
  toast(`${title} · ${body}`);
  if (s.sounds) chime();
  if (s.notifications && (typeof document === "undefined" || document.visibilityState !== "visible" || !document.hasFocus())) {
    void systemNotify(title, body).catch(() => {});
  }
}
