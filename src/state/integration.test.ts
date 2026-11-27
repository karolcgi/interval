// Obsidian & TaskNotes integration, Phase 1: mappings, cache and read-only refresh.
import { afterEach, describe, expect, it, vi } from "vitest";
import { testDb } from "../test/helpers";
import { store } from "./store";
import * as repo from "../db/repo";
import { DEFAULT_SETTINGS } from "../domain/types";
import {
  DEFAULT_INTEGRATION,
  isProjectNote,
  matchesFilter,
  normalizeProject,
  normalizeTask,
  obsidianUri,
  parseLink,
  resolveProject,
  tasksOf,
  vaultNameOf,
  withDefaults,
  type ExtTask,
} from "../domain/integration";
import { cachedItems, refreshIntegration, saveToken, testConnection } from "./integration";

const P = DEFAULT_INTEGRATION.projects;
const T = DEFAULT_INTEGRATION.tasks;

describe("project notes", () => {
  const note = (path: string, fm: Record<string, unknown> | null) => ({ path, mtime: 1, frontmatter: fm });

  it("reads title, status, cover, category and client with configurable property names", () => {
    const p = normalizeProject(note("Projects/Roger AMEX.md", { Status: "Active", cover: "[[amex.png]]", category: "[[Freelance]]", client: "Perception", color: "#d49a72" }), P);
    expect(p).toMatchObject({ ref: "Projects/Roger AMEX.md", title: "Roger AMEX", status: "Active", active: true, cover: "[[amex.png]]", category: "Freelance", client: "Perception", color: "#d49a72" });
    const custom = normalizeProject(note("P/x.md", { name: "Learning Houdini", state: "on hold" }), { ...P, titleProp: "name", statusProp: "state", activeValues: ["Active", "On Hold"] });
    expect(custom).toMatchObject({ title: "Learning Houdini", status: "on hold", active: true });
  });

  it("only Active (configurable) projects are active; missing status is not", () => {
    for (const s of ["Inbox", "Completed", "On Hold", "Abandoned"]) expect(normalizeProject(note("a.md", { status: s }), P).active).toBe(false);
    expect(normalizeProject(note("a.md", {}), P).active).toBe(false);
    expect(normalizeProject(note("a.md", null), P).title).toBe("a");
  });

  it("identifies projects by folder, tag or property", () => {
    const n = note("Projects/a.md", { tags: ["project/client", "x"], type: "[[Project]]" });
    expect(isProjectNote(n, P)).toBe(true);
    expect(isProjectNote(n, { ...P, rule: "tag", ruleTag: "#project" })).toBe(true);
    expect(isProjectNote(n, { ...P, rule: "tag", ruleTag: "area" })).toBe(false);
    expect(isProjectNote(n, { ...P, rule: "property", ruleProperty: "type", ruleValue: "project" })).toBe(true);
    expect(isProjectNote(n, { ...P, rule: "property", ruleProperty: "kind", ruleValue: "" })).toBe(false);
    expect(isProjectNote(note("b.md", { tags: "project" }), { ...P, rule: "tag", ruleTag: "project" })).toBe(true);
  });
});

describe("links and references", () => {
  it("parses wikilinks with aliases, headings and markdown links", () => {
    expect(parseLink("[[Projects/Roger AMEX|Roger]]")).toEqual({ target: "Projects/Roger AMEX", label: "Roger" });
    expect(parseLink("[[Roger AMEX#Notes]]")).toEqual({ target: "Roger AMEX", label: "Roger AMEX" });
    expect(parseLink("[Roger](Projects/Roger%20AMEX.md)")).toEqual({ target: "Projects/Roger AMEX", label: "Roger" });
    expect(parseLink("Plain")).toEqual({ target: "Plain", label: "Plain" });
  });

  it("resolves by path, then by unique name; duplicate names stay unresolved", () => {
    const paths = ["Projects/Roger AMEX.md", "Projects/Learning Houdini.md", "Archive/2024/Notes.md", "Projects/Notes.md"];
    expect(resolveProject("[[Roger AMEX]]", paths)).toBe("Projects/Roger AMEX.md");
    expect(resolveProject("[[projects/learning houdini]]", paths)).toBe("Projects/Learning Houdini.md");
    expect(resolveProject("[[Notes]]", paths)).toBeNull();
    expect(resolveProject("[[2024/Notes]]", paths)).toBe("Archive/2024/Notes.md");
    expect(resolveProject("[[Missing]]", paths)).toBeNull();
  });

  it("builds obsidian:// links and the vault name", () => {
    expect(obsidianUri("Karol_OS", "Projects/Roger AMEX.md")).toBe("obsidian://open?vault=Karol_OS&file=Projects%2FRoger%20AMEX");
    expect(vaultNameOf({ ...DEFAULT_INTEGRATION, vaultPath: "C:\\Users\\karol\\Karol_OS\\" })).toBe("Karol_OS");
    expect(vaultNameOf({ ...DEFAULT_INTEGRATION, vaultPath: "/x/Karol_OS", vaultName: "Other" })).toBe("Other");
  });

  it("fills in config keys added later", () => {
    const c = withDefaults({ enabled: true, projects: { folder: "Work" } as never });
    expect(c.enabled).toBe(true);
    expect(c.projects.folder).toBe("Work");
    expect(c.projects.statusProp).toBe("status");
    expect(c.tasks.projectField).toBe("projects");
  });
});

describe("TaskNotes tasks", () => {
  const raw = {
    path: "TaskNotes/Tasks/Particle lesson.md",
    title: "Particle lesson",
    status: "open",
    priority: "normal",
    due: "2026-11-30",
    scheduled: "2026-11-27T09:00",
    projects: ["[[Learning Houdini]]", "[[Unknown]]"],
    tags: ["task"],
    contexts: ["@desk"],
    customProperties: { taskType: "Deep Work", area: "Study" },
  };

  it("normalises fields, custom properties and project links", () => {
    const t = normalizeTask(raw, { ...T, groupField: "taskType", categoryField: "area" }, ["Projects/Learning Houdini.md"])!;
    expect(t).toMatchObject({
      ref: raw.path,
      title: "Particle lesson",
      completed: false,
      due: "2026-11-30",
      scheduled: "2026-11-27T09:00",
      projects: ["Projects/Learning Houdini.md", "Unknown"],
      projectNames: ["Learning Houdini", "Unknown"],
      group: "Deep Work",
      category: "Study",
      recurring: false,
    });
    expect(normalizeTask({ title: "no path" }, T, [])).toBeNull();
    expect(normalizeTask({ ...raw, status: "Done" }, T, [])!.completed).toBe(true);
    expect(normalizeTask({ ...raw, status: "custom-done", isCompleted: true }, T, [])!.completed).toBe(true);
    expect(normalizeTask({ ...raw, recurrence: "FREQ=DAILY", complete_instances: ["2026-11-26"] }, T, [])).toMatchObject({ recurring: true, completeInstances: ["2026-11-26"] });
    expect(normalizeTask({ ...raw, id: "8a1e-uuid" }, T, [])!.uid).toBe("8a1e-uuid");
  });

  it("reads both response envelopes", () => {
    expect(tasksOf({ success: true, data: { tasks: [raw] } })).toHaveLength(1);
    expect(tasksOf({ success: true, data: [raw] })).toHaveLength(1);
    expect(tasksOf({ success: false, error: "x" })).toBeNull();
  });

  it("sidebar filters", () => {
    const t = (o: Partial<ExtTask>) => ({ ...normalizeTask(raw, T, [])!, scheduled: null, due: null, ...o });
    const today = "2026-11-27";
    expect(matchesFilter(t({ scheduled: "2026-11-27T09:00" }), "today", today)).toBe(true);
    expect(matchesFilter(t({ due: "2026-11-25" }), "overdue", today)).toBe(true);
    expect(matchesFilter(t({ due: "2026-11-25", completed: true }), "overdue", today)).toBe(false);
    expect(matchesFilter(t({ scheduled: "2026-12-01" }), "upcoming", today)).toBe(true);
    expect(matchesFilter(t({}), "unscheduled", today)).toBe(true);
    expect(matchesFilter(t({ projects: ["P.md"] }), "project", today, "P.md")).toBe(true);
  });
});

// ------------------------------------------------------------------ refresh against a fake TaskNotes

function fakeTaskNotes(tasks: Record<string, unknown>[], opts: { query?: boolean; token?: string } = {}) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("http://localhost:8080", "");
    calls.push(`${init?.method ?? "GET"} ${path}`);
    const auth = (init?.headers as Record<string, string>)?.Authorization;
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (opts.token && auth !== `Bearer ${opts.token}`) return json(401, { success: false, error: "Unauthorized" });
    if (path === "/api/health") return json(200, { success: true, data: { status: "ok", version: "4.12.5", vault: { name: "Karol_OS" } } });
    if (path.startsWith("/api/tasks?")) return json(200, { success: true, data: { tasks: tasks.slice(0, 1), pagination: { total: tasks.length, hasMore: false } } });
    if (path === "/api/tasks/query") {
      if (opts.query === false) return json(404, { success: false, error: "Not found" });
      const body = JSON.parse(String(init?.body));
      const wantDone = body.children.some((c: { operator: string; property: string }) => c.property === "status.isCompleted" && c.operator === "is-checked");
      return json(200, { success: true, data: { tasks: tasks.filter((t) => (t.status === "done") === wantDone && !t.archived) } });
    }
    if (path === "/api/filter-options") return json(200, { success: true, data: { userProperties: [{ id: "tt", frontmatterKey: "taskType" }] } });
    return json(404, { success: false, error: "Not found" });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

async function setup(enabled = true) {
  const db = await testDb();
  store.reset();
  store.set({ db, settings: { ...DEFAULT_SETTINGS, integration: { ...DEFAULT_INTEGRATION, enabled } } });
  return db;
}

describe("refresh (read-only cache)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const tasks = [
    { path: "T/a.md", title: "Particle lesson", status: "open", projects: ["[[Learning Houdini]]"] },
    { path: "T/b.md", title: "Camera moves", status: "open" },
    { path: "T/c.md", title: "Done yesterday", status: "done", completedDate: "2026-11-26" },
  ];

  it("imports active and recently completed tasks, never writing to TaskNotes", async () => {
    const db = await setup();
    const { calls } = fakeTaskNotes(tasks);
    await refreshIntegration(new Date(2026, 10, 27, 9).getTime());
    const { tasks: cached } = await cachedItems();
    expect(cached.map((t) => t.title).sort()).toEqual(["Camera moves", "Done yesterday", "Particle lesson"]);
    expect(cached.find((t) => t.ref === "T/c.md")!.active).toBe(false);
    expect(store.get().integration).toMatchObject({ state: "connected", tasks: 2, error: null });
    expect(calls.every((c) => c.startsWith("GET") || c === "POST /api/tasks/query")).toBe(true);
    expect(await repo.getSetting<number>(db, "integration.lastSync")).toBeGreaterThan(0);
  });

  it("renames update the title; deleted tasks are marked gone but keep their last title", async () => {
    const db = await setup();
    fakeTaskNotes(tasks);
    await refreshIntegration(1000);
    fakeTaskNotes([{ ...tasks[0], title: "Particle lesson (v2)" }]);
    await refreshIntegration(2000);
    const live = await repo.listExtItems(db, "task");
    expect(live.map((t) => t.title)).toEqual(["Particle lesson (v2)"]);
    const all = await repo.listExtItems(db, "task", true);
    expect(all.find((t) => t.ref === "T/b.md")).toMatchObject({ title: "Camera moves", goneAt: 2000 });
  });

  it("offline: keeps the cache, reports Offline and doesn't mark anything gone", async () => {
    const db = await setup();
    fakeTaskNotes(tasks);
    await refreshIntegration(1000);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await refreshIntegration(2000);
    expect(store.get().integration.state).toBe("offline");
    expect(store.get().integration.lastSync).toBe(1000);
    expect((await repo.listExtItems(db, "task")).length).toBe(3);
  });

  it("falls back to paging when the query endpoint is missing", async () => {
    await setup();
    const { calls } = fakeTaskNotes(tasks, { query: false });
    await refreshIntegration(new Date(2026, 10, 27).getTime());
    expect(calls).toContain("GET /api/tasks?limit=200&offset=0");
  });

  it("a rejected token is an error, not offline", async () => {
    await setup();
    fakeTaskNotes(tasks, { token: "secret" });
    await refreshIntegration(1000);
    expect(store.get().integration.state).toBe("error");
    expect(store.get().integration.error).toMatch(/rejected the token/);
    await saveToken("secret");
    await refreshIntegration(2000);
    expect(store.get().integration.state).toBe("connected");
    await saveToken("");
  });

  it("does nothing while the integration is off", async () => {
    await setup(false);
    const { calls } = fakeTaskNotes(tasks);
    await refreshIntegration(1000);
    expect(calls).toHaveLength(0);
    expect(store.get().integration.state).toBe("off");
  });

  it("test connection reports version, task count and custom fields", async () => {
    await setup();
    fakeTaskNotes(tasks);
    const r = await testConnection();
    expect(r).toMatchObject({ ok: true, version: "4.12.5", vault: "Karol_OS", tasks: 3, query: true, fields: ["taskType"] });
  });
});
