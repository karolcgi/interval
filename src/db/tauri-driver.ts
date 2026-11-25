import { invoke } from "@tauri-apps/api/core";
import type { DbDriver, SqlValue, Statement } from "./driver";

/** Talks to the Rust `db_*` commands in src-tauri/src/db.rs. */
export class TauriDriver implements DbDriver {
  readonly kind = "tauri" as const;
  private constructor(readonly location: string) {}

  /** Opens (or creates) the database file. Pass null to use the default data directory. */
  static async open(dataDir: string | null, fileName: string): Promise<TauriDriver> {
    const path = await invoke<string>("db_open", { dataDir, fileName });
    return new TauriDriver(path);
  }

  select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return invoke<T[]>("db_select", { sql, params });
  }

  batch(statements: Statement[]): Promise<void> {
    if (statements.length === 0) return Promise.resolve();
    return invoke("db_batch", { statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })) });
  }

  backup(dest: string): Promise<void> {
    return invoke("db_backup", { dest });
  }

  close(): Promise<void> {
    return invoke("db_close");
  }
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
