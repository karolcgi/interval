// In-app updates (desktop only). Releases are signed in CI; the public key is in
// src-tauri/tauri.conf.json, so a tampered download is rejected by the updater plugin.
// Updates replace the program files only. The database in the data folder is never touched.
import { isTauri } from "./platform";
import { store } from "./state/store";
import { toast } from "./state/actions";

type Update = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;
let pending: Update = null;

export async function checkForUpdate(manual = false): Promise<void> {
  if (!isTauri()) {
    if (manual) toast("Updates are available in the desktop app only");
    return;
  }
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    pending = await check();
    store.set({ update: pending ? { version: pending.version, notes: pending.body ?? null, progress: null } : null });
    if (manual && !pending) toast("Interval is up to date");
  } catch (e) {
    console.warn("Update check failed", e);
    if (manual) toast("Couldn’t check for updates (offline?)");
  }
}

export async function installUpdate(): Promise<void> {
  if (!pending) return;
  const s = store.get();
  await s.db?.flush?.();
  let total = 0;
  let got = 0;
  await pending.downloadAndInstall((ev) => {
    if (ev.event === "Started") total = ev.data.contentLength ?? 0;
    if (ev.event === "Progress") got += ev.data.chunkLength;
    const cur = store.get().update;
    if (cur) store.set({ update: { ...cur, progress: total ? Math.round((got / total) * 100) : 0 } });
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
