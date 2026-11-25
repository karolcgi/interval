import type { Database, SqlJsStatic } from "sql.js";
import type { DbDriver, SqlValue, Statement } from "./driver";

export interface Persistence {
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<void>;
}

export class SqlJsDriver implements DbDriver {
  readonly kind = "sqljs" as const;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  private constructor(
    private db: Database,
    readonly location: string,
    private persistence: Persistence | null,
  ) {}

  static async create(SQL: SqlJsStatic, location: string, persistence: Persistence | null): Promise<SqlJsDriver> {
    const bytes = persistence ? await persistence.load() : null;
    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    db.run("PRAGMA foreign_keys = ON;");
    return new SqlJsDriver(db, location, persistence);
  }

  async select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  async batch(statements: Statement[]): Promise<void> {
    if (statements.length === 0) return;
    this.db.run("BEGIN");
    try {
      for (const s of statements) this.db.run(s.sql, s.params ?? []);
      this.db.run("COMMIT");
    } catch (e) {
      this.db.run("ROLLBACK");
      throw e;
    }
    this.scheduleSave();
  }

  async exportBytes(): Promise<Uint8Array> {
    return this.db.export();
  }

  private scheduleSave() {
    if (!this.persistence) return;
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), 150);
  }

  async flush(): Promise<void> {
    if (!this.persistence || !this.dirty) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.dirty = false;
    await this.persistence.save(this.db.export());
  }

  async close(): Promise<void> {
    await this.flush();
    this.db.close();
  }
}

/** IndexedDB persistence for the browser preview. */
export function indexedDbPersistence(key: string): Persistence {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("interval", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("db");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  return {
    async load() {
      const idb = await open();
      return new Promise((resolve, reject) => {
        const req = idb.transaction("db").objectStore("db").get(key);
        req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
        req.onerror = () => reject(req.error);
      });
    },
    async save(bytes) {
      const idb = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction("db", "readwrite");
        tx.objectStore("db").put(bytes, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}
