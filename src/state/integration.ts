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
  baseInfo,
  completedStatusValue,
  DEFAULT_INTEGRATION,
  isAbsolutePath,
  isProjectNote,
  matchesBase,
  metaOf,
  nestedVaultHint,
  joinPath,
  projectSource,
  type BaseInfo,
  type ProjectMapping,
  type TnMeta,
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

let tokenKnown: boolean | null = null;

/** TaskNotes 5 answers 401 to every request when Interval sends no token, so say which case it is. */
export function unauthorizedMessage(haveToken: boolean | null): string {
  return haveToken === false
    ? "TaskNotes needs its API token. TaskNotes 5 rejects every request without one: copy the token from Obsidian › Settings › TaskNotes › Integrations › HTTP API and paste it here."
    : "TaskNotes rejected the token. Copy it again from Obsidian › Settings › TaskNotes › Integrations › HTTP API (it changes if the API was reset).";
}

function apiError(r: TnResponse, what: string): Error {
  if (r.status === 401) return new Error(unauthorizedMessage(tokenKnown));
  const msg = (r.body as { error?: string } | null)?.error;
  return new Error(`${what} failed (HTTP ${r.status}${msg ? `: ${msg}` : ""})`);
}

// ------------------------------------------------------------------ token

export async function saveToken(token: string): Promise<void> {
  if (isTauri()) await invoke("tn_token_set", { token });
  else browserToken = token.trim();
}

export async function hasToken(): Promise<boolean> {
  tokenKnown = isTauri() ? await invoke<boolean>("tn_token_status").catch(() => false) : !!browserToken;
  return tokenKnown;
}

// ------------------------------------------------------------------ projects source (v0.12)

export interface ProjectSetup {
  folder: string;
  base: string | null;
  info: BaseInfo | null;
  mapping: ProjectMapping;
  isProject: (n: ScannedNote) => boolean;
}

/**
 * Where projects come from: a folder, or a .base file whose filters pick the project notes from the whole
 * vault (like the Bases kanban). The base's group-by property and image property are used as the status and
 * cover properties unless those were changed from their defaults in Settings.
 */
export async function projectSetup(c: IntegrationConfig): Promise<ProjectSetup> {
  const src = projectSource(c.projects.folder, c.vaultPath);
  if (!src.base) return { ...src, info: null, mapping: c.projects, isProject: (n) => isProjectNote(n, c.projects) };
  if (!c.vaultPath || !isTauri()) throw new Error("Choose the vault folder first");
  const yaml = await invoke<unknown>("vault_read_yaml", { vault: c.vaultPath, rel: src.base });
  const info = baseInfo(yaml);
  const d = DEFAULT_INTEGRATION.projects;
  const mapping: ProjectMapping = {
    ...c.projects,
    statusProp: c.projects.statusProp === d.statusProp && info.groupBy ? info.groupBy : c.projects.statusProp,
    coverProp: c.projects.coverProp === d.coverProp && info.imageProperty ? info.imageProperty : c.projects.coverProp,
  };
  return { folder: "", base: src.base, info, mapping, isProject: (n) => !n.path.toLowerCase().endsWith(".base") && matchesBase(info.filters, { path: n.path, frontmatter: n.frontmatter }) };
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
  /** v0.12: the vault folder looks one level too high; the folder to use instead. */
  vaultFix: string | null;
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
  const rep: ConnectionReport = { ok: false, version: null, vault: null, tasks: null, query: false, fields: [], projectNotes: null, projectFields: [], problems: [], vaultFix: null };
  await hasToken();
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
      const probe = await invoke<{ exists: boolean; obsidian: boolean; tasknotes: boolean; children: Array<{ name: string; tasknotes: boolean }> }>("vault_probe", { path: c.vaultPath });
      const fix = probe.exists ? nestedVaultHint(probe, rep.vault) : null;
      if (fix) {
        rep.vaultFix = joinPath(c.vaultPath, fix);
        rep.problems.push(`The vault folder looks one level too high: your vault is the “${fix}” folder inside it (${rep.vaultFix}). Use that one so note links and covers resolve.`);
      } else if (probe.exists && !probe.obsidian) rep.problems.push("The vault folder has no .obsidian folder. Is it the vault itself?");
    } catch {
      /* older shell: skip the check */
    }
  }
  if (c.vaultPath && isTauri()) {
    try {
      if (isAbsolutePath(projectSource(c.projects.folder, c.vaultPath).folder)) rep.problems.push("The projects folder is outside the vault folder.");
      const setup = await projectSetup(c);
      if (setup.info?.unsupported.length) rep.problems.push(`Some filters in ${setup.base} aren't understood and were ignored: ${setup.info.unsupported.join(", ")}`);
      const scan = await invoke<{ notes: ScannedNote[] }>("vault_scan", { vault: c.vaultPath, folder: setup.folder, known: null });
      const projects = scan.notes.filter(setup.isProject);
      rep.projectNotes = projects.length;
      const keys = new Set<string>();
      for (const n of projects) for (const k of Object.keys(n.frontmatter ?? {})) keys.add(k);
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
  lastAttempt = Date.now();
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
      const setup = await projectSetup(c);
      const mappingKey = JSON.stringify([c.projects, c.vaultPath, setup.info?.filters ?? null, setup.mapping]);
      const sameMapping = (await repo.getSetting<string>(db, "integration.projectMapping")) === mappingKey;
      const known: Record<string, number> = {};
      if (sameMapping) for (const p of cached) if (p.mtime != null && !p.goneAt) known[p.ref] = p.mtime;
      const scan = await invoke<{ notes: ScannedNote[]; truncated: boolean }>("vault_scan", { vault: c.vaultPath, folder: setup.folder, known });
      const stmts = [];
      const found: string[] = [];
      const cachedRefs = new Set(cached.filter((p) => !p.goneAt).map((p) => p.ref));
      for (const n of scan.notes) {
        if (n.unchanged && cachedRefs.has(n.path)) {
          stmts.push(repo.touchExtItemStmt("project", n.path, now));
          found.push(n.path);
          continue;
        }
        if (n.error || !setup.isProject(n)) continue;
        found.push(n.path);
        const p = normalizeProject(n, setup.mapping);
        stmts.push(repo.upsertExtItemStmt({ kind: "project", ref: p.ref, uid: null, title: p.title, status: p.status, active: p.active, data: p, mtime: n.mtime }, now));
      }
      if (!scan.truncated) stmts.push(repo.markExtGoneStmt("project", now, now));
      stmts.push(repo.setSettingStmt("integration.projectMapping", mappingKey));
      const board = { columns: setup.info?.columns ?? [], cardOrder: setup.info?.cardOrder ?? {}, statusProp: setup.mapping.statusProp };
      stmts.push(repo.setSettingStmt("integration.board", board));
      store.set({ projectBoard: board });
      await db.batch(stmts);
      projectPaths = found;
      // Only notes that would count as projects matter when the whole vault is scanned for a .base.
      const bad = scan.notes.filter((n) => n.error && (!setup.base || /project/i.test(n.path))).length;
      if (bad) errors.push(`${bad} project note${bad > 1 ? "s have" : " has"} unreadable frontmatter and ${bad > 1 ? "were" : "was"} skipped`);
    } catch (e) {
      errors.push(`Projects: ${String(e)}`);
    }
  }

  // TaskNotes statuses & priorities (colours, icons, order). Best effort: the cached copy stays otherwise.
  try {
    const f = await tnRequest("GET", "/api/filter-options");
    if (f.status < 300) {
      const meta = metaOf(f.body);
      if (meta.statuses.length) {
        store.set({ extMeta: meta });
        await db.batch([repo.setSettingStmt("integration.tnMeta", meta)]);
      }
    }
  } catch {
    /* reported by the task fetch below */
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
    // A task renamed or moved in Obsidian gets a new path; with a stable uid (TaskNotes 5) PLAN blocks follow it.
    for (const r of raw) {
      const t = normalizeTask(r, c.tasks, projectPaths);
      if (t?.uid) stmts.push(repo.followRenamedTaskStmt(t.uid, t.ref), repo.followRenamedTaskInSessionsStmt(t.uid, t.ref));
    }
    stmts.push(repo.markExtGoneStmt("task", now, now));
    await db.batch(stmts);
  } catch (e) {
    offline = e instanceof OfflineError;
    errors.push(e instanceof Error ? e.message : String(e));
  }

  // PLAN blocks remember the latest title of their source, for when it is later deleted.
  await db.batch([repo.snapshotSourceTitlesStmt(), ...repo.snapshotSessionTitlesStmts()]);
  await import("./actions").then((A) => A.refresh()).catch(() => undefined);
  const { tasks, projects } = await loadExtIntoStore();
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
  const [meta, board] = await Promise.all([repo.getSetting<TnMeta>(db, "integration.tnMeta"), repo.getSetting<NonNullable<ReturnType<typeof store.get>["projectBoard"]>>(db, "integration.board")]);
  store.set({ extMeta: meta ?? null, projectBoard: board ?? null });
  void hasToken();
  const { tasks, projects } = await loadExtIntoStore();
  setStatus({ lastSync, tasks, projects });
  startLiveRefresh();
  if (store.get().settings.integration.enabled) void refreshIntegration();
}

/** Cached items for the preview in Settings (and, from Phase 2, the sidebar). */
export async function cachedItems() {
  const db = store.get().db;
  if (!db) return { tasks: [], projects: [] };
  const [tasks, projects] = await Promise.all([repo.listExtItems<ExtTask>(db, "task"), repo.listExtItems<ExtProject>(db, "project")]);
  return { tasks, projects };
}

/** Puts the live cached tasks and projects in the store (sidebar, PLAN block titles). */
async function loadExtIntoStore(): Promise<{ tasks: number; projects: number }> {
  const db = store.get().db;
  if (!db) return { tasks: 0, projects: 0 };
  const [extTasks, extProjects] = await Promise.all([repo.listExtItems<ExtTask>(db, "task"), repo.listExtItems<ExtProject>(db, "project")]);
  store.set({ extTasks, extProjects });
  return { tasks: extTasks.filter((t) => t.active).length, projects: extProjects.length };
}

// ------------------------------------------------------------------ live refresh (v0.11)

/** Every 5 minutes while Interval is visible, and when it regains focus (at most once a minute). */
export const POLL_MS = 5 * 60_000;
const FOCUS_MIN_GAP_MS = 60_000;
let liveStarted = false;
let lastAttempt = 0;

function maybeRefresh(minGap: number) {
  const s = store.get();
  if (!s.settings.integration.enabled || s.integration.state === "syncing") return;
  if (Date.now() - lastAttempt < minGap) return;
  lastAttempt = Date.now();
  void refreshIntegration();
}

export function startLiveRefresh() {
  if (liveStarted || typeof window === "undefined") return;
  liveStarted = true;
  window.addEventListener("focus", () => maybeRefresh(FOCUS_MIN_GAP_MS));
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && maybeRefresh(FOCUS_MIN_GAP_MS));
  setInterval(() => document.visibilityState === "visible" && maybeRefresh(POLL_MS - 5_000), POLL_MS);
}

// ------------------------------------------------------------------ explicit task write-back (v0.12, Phase 3)
//
// Only ever called from an explicit click ("Mark task completed" / a status from the menu). Each call reads the
// task first, so a repeated click, a stale popup or a change from another computer can't flip it back:
// complete-instance and toggle-status both toggle in TaskNotes, so they're only sent when the state is not
// already the wanted one.

export type WriteResult = "done" | "already" | "missing";

function taskPath(ref: string): string {
  return `/api/tasks/${encodeURIComponent(ref)}`;
}

async function readTask(ref: string): Promise<Record<string, unknown> | null> {
  const r = await tnRequest("GET", taskPath(ref));
  if (r.status === 404) return null;
  if (r.status >= 400) throw apiError(r, "Reading the task");
  const b = r.body as { data?: unknown } | null;
  return ((b && typeof b === "object" && "data" in b ? b.data : b) ?? null) as Record<string, unknown> | null;
}

/**
 * Marks a task completed in TaskNotes. A recurring task completes only the occurrence of `day` (YYYY-MM-DD),
 * never the whole series.
 */
export async function completeTask(ref: string, day: string): Promise<WriteResult> {
  const t = await readTask(ref);
  if (!t) return "missing";
  const meta = store.get().extMeta;
  if (typeof t.recurrence === "string" && t.recurrence.trim()) {
    const done = Array.isArray(t.complete_instances) ? (t.complete_instances as unknown[]).map(String) : [];
    if (done.includes(day)) return "already";
    const r = await tnRequest("POST", `${taskPath(ref)}/complete-instance`, { date: day });
    if (r.status >= 400) throw apiError(r, "Completing the occurrence");
  } else {
    const status = typeof t.status === "string" ? t.status : "";
    const isDone = meta?.statuses.some((s) => s.isCompleted && s.value.toLowerCase() === status.toLowerCase()) ?? cfg().tasks.completedStatuses.some((c) => c.toLowerCase() === status.toLowerCase());
    if (isDone) return "already";
    const r = await tnRequest("PUT", taskPath(ref), { status: completedStatusValue(meta, cfg().tasks.completedStatuses) });
    if (r.status >= 400) throw apiError(r, "Completing the task");
  }
  void refreshIntegration();
  return "done";
}

/** Sets a task's status to one of TaskNotes' statuses (secondary menu after a session). */
export async function setTaskStatus(ref: string, value: string): Promise<WriteResult> {
  const t = await readTask(ref);
  if (!t) return "missing";
  if (typeof t.status === "string" && t.status.toLowerCase() === value.toLowerCase()) return "already";
  const r = await tnRequest("PUT", taskPath(ref), { status: value });
  if (r.status >= 400) throw apiError(r, "Changing the status");
  void refreshIntegration();
  return "done";
}
