// Storage driver abstraction.
//
// The same SQL (SQLite dialect, positional `?` parameters) runs on two engines:
//  * TauriDriver: the desktop app. Rust owns one rusqlite connection to a real file on disk
//    (WAL mode, atomic batches, online backups).
//  * SqlJsDriver: SQLite compiled to WebAssembly. Used by unit tests and by the browser
//    preview (`npm run dev` without Tauri), persisted to IndexedDB.
//
// Writes always go through `batch`, which is atomic on both engines.

export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params?: SqlValue[];
}

export interface DbDriver {
  readonly kind: "tauri" | "sqljs";
  /** Human-readable location of the database (file path or browser storage key). */
  readonly location: string;
  select<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Execute statements atomically: all succeed or none are applied. */
  batch(statements: Statement[]): Promise<void>;
  /** Write a consistent copy of the database to `dest` (desktop only). */
  backup?(dest: string): Promise<void>;
  /** Serialise the whole database (browser/tests). */
  exportBytes?(): Promise<Uint8Array>;
  flush?(): Promise<void>;
  close(): Promise<void>;
}
