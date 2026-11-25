// Thin platform layer: desktop (Tauri) vs browser preview.
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./db/tauri-driver";

export { isTauri };

export async function saveTextFile(defaultName: string, content: string, ext: string): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return null;
    await invoke("write_text_file", { path, contents: content });
    return path;
  }
  const mime = ext === "json" ? "application/json" : ext === "csv" ? "text/csv" : "text/plain";
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return defaultName;
}

export async function openTextFile(exts: string[]): Promise<{ name: string; text: string } | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, filters: [{ name: "Data", extensions: exts }] });
    if (!path || Array.isArray(path)) return null;
    const text = await invoke<string>("read_text_file", { path });
    return { name: path, text };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = exts.map((e) => "." + e).join(",");
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.click();
  });
}

export async function pickDirectory(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const p = await open({ directory: true, multiple: false });
  return typeof p === "string" ? p : null;
}

export async function openExternal(url: string) {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else window.open(url, "_blank", "noopener");
}

export async function revealDataFolder(path: string) {
  if (!isTauri()) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

/** Bootstrap preferences that must live outside the database (they decide which DB to open). */
export const bootPrefs = {
  get dataDir(): string | null {
    try {
      return localStorage.getItem("interval.dataDir");
    } catch {
      return null;
    }
  },
  set dataDir(v: string | null) {
    try {
      if (v) localStorage.setItem("interval.dataDir", v);
      else localStorage.removeItem("interval.dataDir");
    } catch {
      /* ignore */
    }
  },
  get demo(): boolean {
    try {
      return localStorage.getItem("interval.demo") === "1";
    } catch {
      return false;
    }
  },
  set demo(v: boolean) {
    try {
      localStorage.setItem("interval.demo", v ? "1" : "0");
    } catch {
      /* ignore */
    }
  },
};
