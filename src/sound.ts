// Timer sounds: five quiet, original cues (public/sounds, synthesised by scripts/make-sounds.mjs),
// a master volume, per-sound on/off and volume, and optional imported files.
import { store } from "./state/store";
import { isTauri } from "./platform";
import type { SoundEvent } from "./domain/types";

export const SOUND_EVENTS: Array<{ id: SoundEvent; label: string; file: string }> = [
  { id: "focusStart", label: "Focus started", file: "focus-start" },
  { id: "focusEnd", label: "Focus completed", file: "focus-end" },
  { id: "breakStart", label: "Break started", file: "break-start" },
  { id: "breakEnd", label: "Break completed", file: "break-end" },
  { id: "cycleEnd", label: "Cycle completed", file: "cycle-end" },
];

const urls = new Map<string, string>(); // custom file path -> blob URL

async function urlFor(ev: SoundEvent, custom: string | null): Promise<string> {
  const bundled = `/sounds/${SOUND_EVENTS.find((s) => s.id === ev)!.file}.wav`;
  if (!custom || !isTauri()) return bundled;
  const cached = urls.get(custom);
  if (cached) return cached;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const bytes = await invoke<ArrayBuffer>("read_sound", { path: custom });
    const url = URL.createObjectURL(new Blob([bytes]));
    urls.set(custom, url);
    return url;
  } catch (e) {
    console.warn("custom sound unavailable, using the bundled one", e);
    return bundled;
  }
}

let current: HTMLAudioElement | null = null;

/** Play a cue. `force` ignores the on/off switches (previews). */
export async function playSound(ev: SoundEvent, opts: { force?: boolean; volume?: number } = {}) {
  const s = store.get().settings;
  const cfg = s.soundEvents?.[ev];
  if (!cfg) return;
  if (!opts.force && (!s.sounds || !cfg.on || s.focusNotify === "silent")) return;
  const volume = Math.max(0, Math.min(1, (opts.volume ?? s.soundVolume) * cfg.volume));
  if (volume <= 0 || typeof Audio === "undefined") return;
  try {
    const url = await urlFor(ev, cfg.file);
    current?.pause();
    const a = new Audio(url);
    a.volume = volume;
    current = a;
    await a.play();
  } catch (e) {
    console.warn("sound failed", e);
  }
}

/** Import a custom sound for one cue (desktop). Returns the stored path or null if cancelled. */
export async function importSound(ev: SoundEvent): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const src = await open({ multiple: false, filters: [{ name: "Audio", extensions: ["wav", "mp3", "ogg", "m4a", "flac", "opus", "webm"] }] });
  if (!src || Array.isArray(src)) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  const path = await invoke<string>("import_sound", { src, name: `custom-${ev}` });
  const old = urls.get(path);
  if (old) URL.revokeObjectURL(old);
  urls.delete(path);
  return path;
}
