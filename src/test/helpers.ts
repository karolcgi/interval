import initSqlJs from "sql.js";
import { createRequire } from "node:module";
import { SqlJsDriver, type Persistence } from "../db/sqljs-driver";
import { migrate } from "../db/migrations";
import { seedDefaults } from "../db/repo";

const require = createRequire(import.meta.url);
const wasm = require.resolve("sql.js/dist/sql-wasm.wasm");
let SQLp: ReturnType<typeof initSqlJs> | null = null;

export async function testDb(persistence: Persistence | null = null, seed = true) {
  SQLp ??= initSqlJs({ locateFile: () => wasm });
  const db = await SqlJsDriver.create(await SQLp, "test", persistence);
  await migrate(db);
  if (seed) await seedDefaults(db);
  return db;
}

/** In-memory "disk" used to simulate closing and reopening the app. */
export function memoryDisk(): Persistence & { bytes: Uint8Array | null } {
  const disk = {
    bytes: null as Uint8Array | null,
    async load() {
      return disk.bytes;
    },
    async save(b: Uint8Array) {
      disk.bytes = b;
    },
  };
  return disk;
}

/** Local time helper: t(2026, 11, 25, 9, 30) */
export const t = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
