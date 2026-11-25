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

// Sounds go through Web Audio, not <audio>: the bytes are fetched (bundled file) or read through the
// shell (custom file) and decoded once. A media element would depend on the webview's media pipeline
// (MIME types, range requests on the app protocol, autoplay rules), which is where desktop playback failed.
type Ctx = AudioContext;
let ctx: Ctx | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>(); // bundled path or custom file path -> decoded audio

function audio(): Ctx | null {
  if (ctx) return ctx;
  const C = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx = new C();
  return ctx;
}

/** Browsers start an AudioContext suspended until the page is used; resume it on the first click or key. */
export function unlockAudio() {
  if (typeof window === "undefined") return;
  const resume = () => void audio()?.resume().catch(() => {});
  window.addEventListener("pointerdown", resume, { capture: true });
  window.addEventListener("keydown", resume, { capture: true });
}

async function bytesFor(ev: SoundEvent, custom: string | null): Promise<{ key: string; load: () => Promise<ArrayBuffer> }> {
  const bundled = `/sounds/${SOUND_EVENTS.find((s) => s.id === ev)!.file}.wav`;
  const fromBundle = { key: bundled, load: async () => (await fetch(bundled)).arrayBuffer() };
  if (!custom || !isTauri()) return fromBundle;
  return {
    key: custom,
    load: async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<ArrayBuffer>("read_sound", { path: custom });
    },
  };
}

async function bufferFor(c: Ctx, ev: SoundEvent, custom: string | null): Promise<AudioBuffer> {
  const src = await bytesFor(ev, custom);
  let p = buffers.get(src.key);
  if (!p) {
    p = src.load().then((b) => c.decodeAudioData(b));
    buffers.set(src.key, p);
    p.catch(() => buffers.delete(src.key));
  }
  try {
    return await p;
  } catch (e) {
    if (!custom) throw e;
    console.warn("custom sound unavailable, using the built-in one", e);
    return bufferFor(c, ev, null);
  }
}

let current: AudioBufferSourceNode | null = null;

/** Play a cue. `force` ignores the on/off switches (previews). */
export async function playSound(ev: SoundEvent, opts: { force?: boolean; volume?: number } = {}) {
  const s = store.get().settings;
  const cfg = s.soundEvents?.[ev];
  if (!cfg) return;
  if (!opts.force && (!s.sounds || !cfg.on || s.focusNotify === "silent")) return;
  const volume = Math.max(0, Math.min(1, (opts.volume ?? s.soundVolume) * cfg.volume));
  const c = audio();
  if (volume <= 0 || !c) return;
  try {
    if (c.state !== "running") await c.resume().catch(() => {});
    const buf = await bufferFor(c, ev, cfg.file);
    try {
      current?.stop();
    } catch {
      /* already ended */
    }
    const src = c.createBufferSource();
    const gain = c.createGain();
    gain.gain.value = volume;
    src.buffer = buf;
    src.connect(gain).connect(c.destination);
    src.start();
    current = src;
    (globalThis as { __intervalSounds?: string[] }).__intervalSounds?.push(ev);
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
  buffers.delete(path);
  return path;
}
