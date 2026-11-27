// Obsidian & TaskNotes integration, Phase 1: connection, read-only import, local cache.
//
// Desktop: every TaskNotes call goes through the Rust command `tn_request` (loopback only; the token stays in
// the OS credential store). Browser preview: `fetch` with an in-memory token, for UI work only.
// Project notes are read from the vault folder by `vault_scan` (desktop only).
// Nothing in this module writes to the vault or to TaskNotes.

import { invoke } from "@tauri-apps/api/core";
import { store, type IntegrationStatus } from "./store";
import * as repo from "../db/repo";
import { isTauri } from "../platform";
import {
  activeTasksQuery,
  isProjectNote,
  keepFromFullList,
  normalizeProject,
  normalizeTask,
  recentlyCompletedQuery,
  tasksOf,
  type ExtProject,
  type ExtTask,
  type IntegrationConfig,
  type ScannedNote,
} from "../domain/integration";
import { addDays, dayKey, startOfDay } from "../domain/time";

export interface TnResponse {
  status: number;
  body: unknown;
}

/** Days of recently completed tasks kept in the cache, so a task finished in Obsidian shows as done. */
const RECENT_DONE_DAYS = 14;
const MAX_PAGES = 25; // 25 × 200 tasks

let browserToken = ""; // browser preview only

export class OfflineError extends Error {}

function setStatus(patch: Partial<IntegrationStatus>) {
  store.set((s) => ({ integration: { ...s.integration, ...patch } }));
}

function cfg(): IntegrationConfig {
  return store.get().settings.integration;
}

export async function tnRequest(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<TnResponse> {
  const base = cfg().apiUrl;
  if (isTauri()) {
    try {
      return await invoke<TnResponse>("tn_request", { base, method, path, body: body ?? null });
    } catch (e) {
      const msg = String(e);
      if (msg.startsWith("offline")) throw new OfflineError("TaskNotes isn't reachable. Is Obsidian open with the HTTP API on?");
      throw new Error(msg);
    }
  }
  let res: Response;
  try {
    res = await fetch(base.replace(/\/$/, "") + path, {
      method,
      headers: { "Content-Type": "application/json", ...(browserToken ? { Authorization: `Bearer ${browserToken}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new OfflineError("TaskNotes isn't reachable. Is Obsidian open with the HTTP API on?");
  }
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { status: res.status, body: parsed };
}

function apiError(r: TnResponse, what: string): Error {
  if (r.status === 401) return new Error("TaskNotes rejected the token. Copy it again from TaskNotes › HTTP API settings.");
  const msg = (r.body as { error?: string } | null)?.error;
  return new Error(`${what} failed (HTTP ${r.status}${msg ? `: ${msg}` : ""})`);
}

// ------------------------------------------------------------------ token

export async function saveToken(token: string): Promise<void> {
  if (isTauri()) await invoke("tn_token_set", { token });
  else browserToken = token.trim();
}

export async function hasToken(): Promise<boolean> {
  if (isTauri()) return invoke<boolean>("tn_token_status").catch(() => false);
  return !!browserToken;
}

// ------------------------------------------------------------------ connection test

export interface ConnectionReport {
  ok: boolean;
  version: string | null;
  vault: string | null;
  tasks: number | null;
  query: boolean; // POST /api/tasks/query available
  fields: string[]; // custom user fields TaskNotes reports (for the mapping dropdowns)
  projectNotes: number | null;
  projectFields: string[];
  problems: string[];
}

function pick(o: unknown, ...keys: string[]): string | null {
  let cur = o as Record<string, unknown> | null;
  for (const k of keys) {
    if (!cur || typeof cur !== "object") return null;
    cur = cur[k] as Record<string, unknown> | null;
  }
  return cur == null ? null : String(cur);
}

/** Checks the API, the token, the query endpoint and the projects folder. Changes nothing. */
export async function testConnection(): Promise<ConnectionReport> {
  const c = cfg();
  const rep: ConnectionReport = { ok: false, version: null, vault: null, tasks: null, query: false, fields: [], projectNotes: null, projectFields: [], problems: [] };
  try {
    const h = await tnRequest("GET", "/api/health");
    if (h.status === 401) throw apiError(h, "Health check");
    if (h.status >= 400) rep.problems.push(`Health check returned HTTP ${h.status}`);
    rep.version = pick(h.body, "data", "version") ?? pick(h.body, "version") ?? pick(h.body, "data", "pluginVersion");
    rep.vault = pick(h.body, "data", "vault", "name") ?? pick(h.body, "data", "vault") ?? pick(h.body, "vault", "name");
    const list = await tnRequest("GET", "/api/tasks?limit=1&offset=0");
    if (list.status >= 400) throw apiError(list, "Reading tasks");
    rep.tasks = Number(pick(list.body, "data", "pagination", "total") ?? tasksOf(list.body)?.length ?? 0);
    const q = await tnRequest("POST", "/api/tasks/query", activeTasksQuery());
    rep.query = q.status < 300 && tasksOf(q.body) !== null;
    if (!rep.query) rep.problems.push("This TaskNotes version has no task query endpoint; Interval will page through all tasks instead.");
    const f = await tnRequest("GET", "/api/filter-options");
    if (f.status < 300) {
      const ups = ((f.body as { data?: { userProperties?: unknown[] } })?.data?.userProperties ?? []) as Array<{ frontmatterKey?: string; id?: string }>;
      rep.fields = ups.map((u) => u.frontmatterKey ?? u.id ?? "").filter(Boolean);
    }
    rep.ok = true;
    setStatus({ state: "connected", version: rep.version, error: null });
  } catch (e) {
    rep.problems.unshift(e instanceof Error ? e.message : String(e));
    setStatus({ state: e instanceof OfflineError ? "offline" : "error", error: rep.problems[0] });
  }
  if (c.vaultPath && isTauri()) {
    try {
      const scan = await invoke<{ notes: ScannedNote[] }>("vault_scan", { vault: c.vaultPath, folder: c.projects.folder, known: null });
      const projects = scan.notes.filter((n) => isProjectNote(n, c.projects));
      rep.projectNotes = projects.length;
      const keys = new Set<string>();
      for (const n of scan.notes) for (const k of Object.keys(n.frontmatter ?? {})) keys.add(k);
      rep.projectFields = [...keys].sort();
    } catch (e) {
      rep.problems.push(String(e));
      rep.ok = false;
    }
  } else if (!c.vaultPath) {
    rep.problems.push("Choose your vault folder to import projects.");
  }
  return rep;
}

// ------------------------------------------------------------------ refresh

async function fetchTasks(since: string): Promise<{ raw: Record<string, unknown>[]; filteredOnServer: boolean }> {
  const active = await tnRequest("POST", "/api/tasks/query", activeTasksQuery());
  const activeTasks = active.status < 300 ? tasksOf(active.body) : null;
  if (activeTasks) {
    const done = await tnRequest("POST", "/api/tasks/query", recentlyCompletedQuery(since));
    const doneTasks = done.status < 300 ? (tasksOf(done.body) ?? []) : [];
    return { raw: [...activeTasks, ...doneTasks], filteredOnServer: true };
  }
  if (active.status === 401) throw apiError(active, "Reading tasks");
  // Older TaskNotes: page through everything (max 200 per page) and filter here.
  const out: Record<string, unknown>[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await tnRequest("GET", `/api/tasks?limit=200&offset=${page * 200}`);
    if (r.status >= 400) throw apiError(r, "Reading tasks");
    const batch = tasksOf(r.body) ?? [];
    out.push(...batch);
    const more = (r.body as { data?: { pagination?: { hasMore?: boolean } } })?.data?.pagination?.hasMore;
    if (!more || batch.length === 0) break;
  }
  return { raw: out, filteredOnServer: false };
}

let running: Promise<void> | null = null;

/**
 * Pulls projects from the vault and tasks from TaskNotes into the cache. Each source is independent: if one
 * fails, the other still refreshes and the failed one keeps its cached rows (nothing is marked gone).
 */
export function refreshIntegration(now = Date.now()): Promise<void> {
  running ??= doRefresh(now).finally(() => {
    running = null;
  });
  return running;
}

async function doRefresh(now: number): Promise<void> {
  const s = store.get();
  const c = s.settings.integration;
  const db = s.db;
  if (!db || !c.enabled) {
    setStatus({ state: "off" });
    return;
  }
  setStatus({ state: "syncing" });
  const errors: string[] = [];
  let offline = false;

  // Projects (vault files)
  let projectPaths = (await repo.listExtItems<ExtProject>(db, "project")).map((p) => p.ref);
  if (c.vaultPath && isTauri()) {
    try {
      const cached = await repo.listExtItems<ExtProject>(db, "project", true);
      // Unchanged notes are skipped only while the project mapping is the same one they were read with.
      const mappingKey = JSON.stringify(c.projects);
      const sameMapping = (await repo.getSetting<string>(db, "integration.projectMapping")) === mappingKey;
      const known: Record<string, number> = {};
      if (sameMapping) for (const p of cached) if (p.mtime != null && !p.goneAt) known[p.ref] = p.mtime;
      const scan = await invoke<{ notes: ScannedNote[]; truncated: boolean }>("vault_scan", { vault: c.vaultPath, folder: c.projects.folder, known });
      const stmts = [];
      const found: string[] = [];
      const cachedRefs = new Set(cached.filter((p) => !p.goneAt).map((p) => p.ref));
      for (const n of scan.notes) {
        if (n.unchanged && cachedRefs.has(n.path)) {
          stmts.push(repo.touchExtItemStmt("project", n.path, now));
          found.push(n.path);
          continue;
        }
        if (n.error || !isProjectNote(n, c.projects)) continue;
        found.push(n.path);
        const p = normalizeProject(n, c.projects);
        stmts.push(repo.upsertExtItemStmt({ kind: "project", ref: p.ref, uid: null, title: p.title, status: p.status, active: p.active, data: p, mtime: n.mtime }, now));
      }
      if (!scan.truncated) stmts.push(repo.markExtGoneStmt("project", now, now));
      stmts.push(repo.setSettingStmt("integration.projectMapping", mappingKey));
      await db.batch(stmts);
      projectPaths = found;
      const bad = scan.notes.filter((n) => n.error).length;
      if (bad) errors.push(`${bad} project note${bad > 1 ? "s have" : " has"} unreadable frontmatter and ${bad > 1 ? "were" : "was"} skipped`);
    } catch (e) {
      errors.push(`Projects: ${String(e)}`);
    }
  }

  // Tasks (TaskNotes API)
  try {
    const since = dayKey(addDays(startOfDay(now), -RECENT_DONE_DAYS));
    const { raw, filteredOnServer } = await fetchTasks(since);
    const stmts = [];
    const seen = new Set<string>();
    for (const r of raw) {
      const t = normalizeTask(r, c.tasks, projectPaths);
      if (!t || seen.has(t.ref)) continue;
      if (!filteredOnServer && !keepFromFullList(t, r, since)) continue;
      seen.add(t.ref);
      stmts.push(repo.upsertExtItemStmt({ kind: "task", ref: t.ref, uid: t.uid, title: t.title, status: t.status, active: !t.completed && !t.archived, data: t as ExtTask, raw: r }, now));
    }
    stmts.push(repo.markExtGoneStmt("task", now, now));
    await db.batch(stmts);
  } catch (e) {
    offline = e instanceof OfflineError;
    errors.push(e instanceof Error ? e.message : String(e));
  }

  const tasks = (await repo.listExtItems(db, "task")).filter((t) => t.active).length;
  const projects = (await repo.listExtItems(db, "project")).length;
  const ok = errors.length === 0;
  setStatus({
    state: ok ? "connected" : offline ? "offline" : "error",
    error: ok ? null : errors.join(" · "),
    lastSync: ok ? now : store.get().integration.lastSync,
    tasks,
    projects,
    rev: store.get().integration.rev + 1,
  });
  if (ok) await db.batch([repo.setSettingStmt("integration.lastSync", now)]);
}

/** At startup: show what's cached immediately, then refresh in the background. */
export async function initIntegration(): Promise<void> {
  const db = store.get().db;
  if (!db) return;
  const lastSync = await repo.getSetting<number>(db, "integration.lastSync");
  const tasks = (await repo.listExtItems(db, "task")).filter((t) => t.active).length;
  const projects = (await repo.listExtItems(db, "project")).length;
  setStatus({ lastSync, tasks, projects });
  if (store.get().settings.integration.enabled) void refreshIntegration();
}

/** Cached items for the preview in Settings (and, from Phase 2, the sidebar). */
export async function cachedItems() {
  const db = store.get().db;
  if (!db) return { tasks: [], projects: [] };
  const [tasks, projects] = await Promise.all([repo.listExtItems<ExtTask>(db, "task"), repo.listExtItems<ExtProject>(db, "project")]);
  return { tasks, projects };
}
