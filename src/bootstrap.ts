import type { DbDriver } from "./db/driver";
import { migrate } from "./db/migrations";
import * as repo from "./db/repo";
import { generateDemoData } from "./db/fixtures";
import { TauriDriver } from "./db/tauri-driver";
import { bootPrefs, isTauri } from "./platform";
import { store } from "./state/store";
import { backupNow, checkSleepOnStartup, refresh, reloadMeta } from "./state/actions";
import { initEngine } from "./state/focus";

/**
 * Real records and demo records live in different databases:
 *   desktop: interval.db vs interval-demo.db (same data directory)
 *   browser: IndexedDB keys "interval" vs "interval-demo"
 * Switching demo mode reloads the app against the other database.
 */
async function openDriver(demo: boolean): Promise<DbDriver> {
  if (isTauri()) {
    return TauriDriver.open(bootPrefs.dataDir, demo ? "interval-demo.db" : "interval.db");
  }
  const [{ default: initSqlJs }, { SqlJsDriver, indexedDbPersistence }, wasmUrl] = await Promise.all([
    import("sql.js"),
    import("./db/sqljs-driver"),
    import("sql.js/dist/sql-wasm.wasm?url").then((m) => m.default as string),
  ]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const params = new URLSearchParams(location.search);
  const key = params.get("db") ?? (demo ? "interval-demo" : "interval");
  return SqlJsDriver.create(SQL, `browser:${key}`, indexedDbPersistence(key));
}

export async function boot() {
  const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
  const demo = params.has("demo") ? params.get("demo") === "1" : bootPrefs.demo;
  try {
    const db = await openDriver(demo);
    await migrate(db);
    await repo.seedDefaults(db);
    if (demo) {
      const any = await db.select<{ n: number }>("SELECT COUNT(*) AS n FROM sessions");
      if (Number(any[0]?.n) === 0) await generateDemoData(db);
    }
    store.set({ db, demo, storageLabel: db.location });
    await reloadMeta();
    await refresh();
    await checkSleepOnStartup();
    await initEngine();
    store.set({ ready: true });
    if (db.kind === "tauri") {
      // Daily rolling backup to the configured folder. Failure is reported but never blocks the app.
      void backupNow(false);
      void import("./state/obsidian").then((o) => o.autoExport()).catch((e) => console.warn(e));
      // Check for a new version shortly after start, then every 6 hours.
      const { checkForUpdate } = await import("./updater");
      setTimeout(() => void checkForUpdate(), 5_000);
      setInterval(() => void checkForUpdate(), 6 * 3_600_000);
    }
    const flush = () => void db.flush?.();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  } catch (e) {
    console.error(e);
    store.set({ fatal: e instanceof Error ? e.message : String(e) });
  }
}

export function switchDemo(on: boolean) {
  bootPrefs.demo = on;
  const url = new URL(location.href);
  url.searchParams.delete("demo");
  location.href = url.toString();
}
