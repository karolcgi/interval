// v0.12: TaskNotes statuses, projects from a .base, the Projects board, sessions linked to tasks/projects
// (integration Phase 3), explicit task completion, and "Skip break". Against real SQLite (sql.js).
import { afterEach, describe, expect, it, vi } from "vitest";
import { t, testDb } from "../test/helpers";
import { store } from "./store";
import * as A from "./actions";
import * as F from "./focus";
import * as repo from "../db/repo";
import { startOfDay } from "../domain/time";
import {
  DEFAULT_INTEGRATION,
  baseInfo,
  coverTarget,
  completedStatusValue,
  evalExpr,
  groupByStatus,
  matchesBase,
  metaOf,
  nestedVaultHint,
  projectColumns,
  projectSource,
  type ExtTask,
} from "../domain/integration";
import { buildDayLog, dayLogMarkdown, wikiLink } from "../domain/daylog";
import { completeTask, refreshIntegration, unauthorizedMessage } from "./integration";
import { linksForTask } from "./links";

const MINUTE = 60_000;

const FILTER_OPTIONS = {
  success: true,
  data: {
    statuses: [
      { id: "none", value: "inbox", label: "INBOX", color: "#e3e3e3", isCompleted: false, order: 0 },
      { id: "s2", value: "deep work", label: "DEEP WORK", color: "#db7a18", isCompleted: false, order: 2, icon: "lucide-badge-check" },
      { id: "s6", value: "study", label: "STUDY", color: "#6366f1", isCompleted: false, order: 6, icon: "lucide-book-open" },
      { id: "done", value: "done", label: "DONE", color: "#00aa00", isCompleted: true, order: 10 },
    ],
    priorities: [{ id: "p", value: "p1", label: "90 - IMMEDIATE", color: "#fc0303", weight: 4 }],
  },
};

const task = (o: Partial<ExtTask> & { ref: string }) =>
  ({ ref: o.ref, title: o.title ?? o.ref, active: true, data: { status: o.status ?? null, projects: [], projectNames: [], ...o } as unknown as ExtTask });

describe("TaskNotes statuses", () => {
  it("reads statuses (colour, Lucide icon, order) and groups tasks in TaskNotes' order", () => {
    const meta = metaOf(FILTER_OPTIONS);
    expect(meta.statuses.map((s) => s.label)).toEqual(["INBOX", "DEEP WORK", "STUDY", "DONE"]);
    expect(meta.statuses[1]).toMatchObject({ icon: "badge-check", color: "#db7a18" });
    expect(completedStatusValue(meta, ["finished"])).toBe("done");
    const groups = groupByStatus([task({ ref: "a", status: "study" }), task({ ref: "b", status: "Deep Work" }), task({ ref: "c", status: "weird" }), task({ ref: "d", status: null }), task({ ref: "e", status: "inbox" })], meta);
    expect(groups.map((g) => g.label)).toEqual(["INBOX", "DEEP WORK", "STUDY", "weird", "No status"]);
    expect(groups[1].status?.color).toBe("#db7a18");
  });

  it("says why TaskNotes answers 401", () => {
    expect(unauthorizedMessage(false)).toMatch(/TaskNotes 5 rejects every request without one/);
    expect(unauthorizedMessage(true)).toMatch(/rejected the token/);
  });
});

describe("projects folder, .base files and the board", () => {
  it("normalises a full path, backslashes, a note or a .base file", () => {
    const vault = "X:\\Dropbox\\Karol_OS_Obsidian\\Karol_OS";
    expect(projectSource("X:\\Dropbox\\Karol_OS_Obsidian\\Karol_OS\\02_ACTIONS\\02_PROJECTS", vault)).toEqual({ folder: "02_ACTIONS/02_PROJECTS", base: null });
    expect(projectSource('"X:\\Dropbox\\Karol_OS_Obsidian\\Karol_OS\\02_ACTIONS\\02_PROJECTS\\PROJECTS.base"', vault)).toEqual({ folder: "", base: "02_ACTIONS/02_PROJECTS/PROJECTS.base" });
    expect(projectSource("/02_ACTIONS/02_PROJECTS/", vault)).toEqual({ folder: "02_ACTIONS/02_PROJECTS", base: null });
    expect(projectSource("02_ACTIONS/02_PROJECTS/Roger AMEX.md", vault)).toEqual({ folder: "02_ACTIONS/02_PROJECTS", base: null });
    expect(projectSource(vault, vault)).toEqual({ folder: "", base: null });
  });

  it("evaluates the Bases filters a projects board uses", () => {
    const yaml = {
      filters: { and: ['type.contains("project")', '!file.folder.contains("98_ARCHIVE")', '!file.folder.contains("99_META")'] },
      views: [
        {
          type: "kanban-view",
          groupByProperty: "note.project_status",
          imageProperty: "note.cover",
          columnOrders: { "note.status": ["done"], "note.project_status": ["INBOX", "ACTIVE", "COMPLETED", "ON HOLD", "ABANDONED"] },
          cardOrders: { "note.project_status": { ACTIVE: ["Learning Houdini.md", "Prawo jazdy.md", "02_ACTIONS/02_PROJECTS/Roger AMEX.md"] } },
        },
      ],
    };
    const info = baseInfo(yaml);
    expect(info).toMatchObject({ groupBy: "project_status", imageProperty: "cover", columns: ["INBOX", "ACTIVE", "COMPLETED", "ON HOLD", "ABANDONED"], unsupported: [] });
    const is = (path: string, fm: Record<string, unknown> | null) => matchesBase(info.filters, { path, frontmatter: fm });
    expect(is("Learning Houdini.md", { type: "project", project_status: "ACTIVE" })).toBe(true);
    expect(is("02_ACTIONS/02_PROJECTS/Roger AMEX.md", { type: "project" })).toBe(true);
    expect(is("99_META/_migration_backups/x/Sideways.md", { type: "project" })).toBe(false);
    expect(is("Recipe.md", { type: "recipe" })).toBe(false);
    expect(is("No frontmatter.md", null)).toBe(false);
    expect(is("Tagged list.md", { type: ["note", "project"] })).toBe(true);
    // other common forms
    const n = { path: "A/B/c.md", frontmatter: { tags: ["project/client"], status: "[[Active]]", n: 3 } };
    expect(evalExpr('file.hasTag("project")', n)).toBe(true);
    expect(evalExpr('file.inFolder("A")', n)).toBe(true);
    expect(evalExpr('status == "Active"', n)).toBe(true);
    expect(evalExpr("n != 3", n)).toBe(false);
    expect(evalExpr("file.ext == \"md\"", n)).toBe(true);
    expect(evalExpr("formula.x > now()", n)).toBeNull();
    expect(matchesBase({ and: ["formula.x > now()"] }, n)).toBe(true); // unknown → shows more, never fewer
  });

  it("lays out columns in the base's order, then other statuses, then no status", () => {
    const p = (ref: string, status: string | null) => ({ ref, title: ref.replace(/\.md$/, "").split("/").pop()!, status });
    const cols = projectColumns(
      [p("02_ACTIONS/02_PROJECTS/Roger AMEX.md", "ACTIVE"), p("Prawo jazdy.md", "active"), p("Learning Houdini.md", "ACTIVE"), p("X.md", "Someday"), p("Y.md", null)],
      ["INBOX", "ACTIVE", "COMPLETED"],
      { ACTIVE: ["Learning Houdini.md", "Prawo jazdy.md", "02_ACTIONS/02_PROJECTS/Roger AMEX.md"] },
    );
    expect(cols.map((c) => [c.key, c.items.map((i) => i.title)])).toEqual([
      ["INBOX", []],
      ["ACTIVE", ["Learning Houdini", "Prawo jazdy", "Roger AMEX"]],
      ["COMPLETED", []],
      ["Someday", ["X"]],
      ["", ["Y"]],
    ]);
  });

  it("spots a vault folder chosen one level too high", () => {
    const probe = { tasknotes: false, children: [{ name: "Karol_OS", tasknotes: true }, { name: "tools", tasknotes: false }] };
    expect(nestedVaultHint(probe, "Karol_OS")).toBe("Karol_OS");
    expect(nestedVaultHint(probe, null)).toBe("Karol_OS");
    expect(nestedVaultHint({ tasknotes: true, children: [] }, "Karol_OS")).toBeNull();
  });

  it("reads cover links the ways Obsidian writes them", () => {
    expect(coverTarget("[[Roger AMEX-1791451380260.webp]]")).toBe("Roger AMEX-1791451380260.webp");
    expect(coverTarget("![[covers/a.png|300]]")).toBe("covers/a.png");
    expect(coverTarget("![](attachments/b%20c.jpg)")).toBe("attachments/b c.jpg");
    expect(coverTarget("https://x.test/a.png")).toBe("https://x.test/a.png");
    expect(coverTarget("")).toBeNull();
  });
});

// ------------------------------------------------------------------ engine + database

function fakeTaskNotes(tasks: Record<string, unknown>[], byId: Record<string, Record<string, unknown>> = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^http:\/\/[^/]+/, "");
      const method = init?.method ?? "GET";
      calls.push(`${method} ${decodeURIComponent(path)}${init?.body && method !== "GET" && !path.includes("query") ? " " + init.body : ""}`);
      if (path === "/api/filter-options") return new Response(JSON.stringify(FILTER_OPTIONS), { status: 200 });
      const m = /^\/api\/tasks\/([^/]+)$/.exec(path);
      if (m && method === "GET") {
        const t = byId[decodeURIComponent(m[1])];
        return t ? new Response(JSON.stringify({ success: true, data: t }), { status: 200 }) : new Response(JSON.stringify({ success: false, error: "Task not found" }), { status: 404 });
      }
      if (method === "PUT" || path.endsWith("/complete-instance")) return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
      const done = init?.body && String(init.body).includes('is-checked"');
      return new Response(JSON.stringify({ success: true, data: { tasks: done ? [] : tasks } }), { status: 200 });
    }),
  );
  return calls;
}

async function boot(now = t(2026, 11, 27, 8)) {
  const db = await testDb();
  store.reset();
  A.clearHistory();
  store.set({ db, date: startOfDay(now), ready: true });
  await A.reloadMeta();
  await A.updateSettings({ integration: { ...DEFAULT_INTEGRATION, enabled: true }, focusAutoBreak: true, focusRecordBreaks: true });
  await A.refresh();
  return db;
}

const eagle = { path: "02_ACTIONS/03_TASKS/2026/Eagle - full set up.md", id: "42f2b8a2", title: "Eagle - full set up", status: "deep work", priority: "p1", projects: ["[[Obsidian Rework]]"] };
const jazdy = { path: "02_ACTIONS/03_TASKS/2026/Jazdy.md", title: "Jazdy", status: "event", recurrence: "FREQ=WEEKLY", complete_instances: ["2026-11-20"] };

describe("sessions about a task or project (Phase 3)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refresh stores TaskNotes' statuses; picking a task suggests its project and a matching activity", async () => {
    const course = { path: "T/Houdini-Course.md", title: "Houdini-Course.com BASICS", status: "study" };
    fakeTaskNotes([eagle, course]);
    await boot();
    await refreshIntegration(t(2026, 11, 27, 8));
    expect(store.get().extMeta?.statuses.map((s) => s.value)).toContain("deep work");
    const l = linksForTask(eagle.path);
    expect(l).toMatchObject({ taskRef: eagle.path, taskTitle: "Eagle - full set up", projectRef: "Obsidian Rework", projectTitle: "Obsidian Rework", categoryId: null });
    const studying = store.get().categories.find((c) => c.name === "Studying")!.id;
    expect(linksForTask(course.path).categoryId).toBe(studying); // STUDY → Studying
  });

  it("a focus session records its task and project; changing them later never changes its times", async () => {
    fakeTaskNotes([eagle]);
    const db = await boot();
    await refreshIntegration(t(2026, 11, 27, 8));
    const start = t(2026, 11, 27, 9);
    await F.start("pomodoro", { title: "Eagle", taskRef: eagle.path, taskTitle: eagle.title, projectRef: "P/Obsidian Rework.md", projectTitle: "Obsidian Rework" }, { focus: 25, brk: 5, long: 15, every: 4 }, start);
    await F.tick(start + 25 * MINUTE);
    await F.settled();
    const [s] = (await repo.listSessions(db, start, start + 60 * MINUTE)).filter((x) => !store.get().categories.find((c) => c.id === x.categoryId)?.isBreak);
    expect(s).toMatchObject({ taskRef: eagle.path, taskTitle: "Eagle - full set up", projectRef: "P/Obsidian Rework.md", projectTitle: "Obsidian Rework", startAt: start, endAt: start + 25 * MINUTE });
    await A.updateSession(s.id, { taskRef: null, taskTitle: null, projectRef: "P/Other.md", projectTitle: "Other" });
    const after = (await repo.listSessions(db, start, start + 60 * MINUTE)).find((x) => x.id === s.id)!;
    expect(after).toMatchObject({ taskRef: null, projectRef: "P/Other.md", startAt: start, endAt: start + 25 * MINUTE });
    // Day log shows and links the project
    const log = buildDayLog(startOfDay(start), [after], [], store.get().categories, [], start + 60 * MINUTE);
    expect(log.entries[0].projectTitle).toBe("Other");
    expect(dayLogMarkdown(log, { heading: false })).toContain("[[P/Other|Other]]");
    expect(wikiLink("a/b [x].md", "b|x")).toBe("[[a/b x|bx]]");
  });

  it("Skip break withdraws the break that just started and starts the next round", async () => {
    fakeTaskNotes([]);
    const db = await boot();
    const start = t(2026, 11, 27, 9);
    await F.start("pomodoro", {}, { focus: 25, brk: 5, long: 15, every: 4 }, start);
    await F.tick(start + 25 * MINUTE);
    await F.settled();
    expect(store.get().focus?.phase).toBe("break");
    await F.skipBreakNow(start + 25 * MINUTE + 10_000);
    const f = store.get().focus!;
    expect(f.phase).toBe("focus");
    expect(f.round).toBe(1);
    const sessions = await repo.listSessions(db, start, start + 60 * MINUTE);
    const breaks = sessions.filter((x) => store.get().categories.find((c) => c.id === x.categoryId)?.isBreak);
    expect(breaks).toHaveLength(0);
    expect(sessions).toHaveLength(2); // round 1 recorded, round 2 running
  });

  it("completes a task only on request: the right call, once; a recurring task only for that day", async () => {
    const calls = fakeTaskNotes([eagle, jazdy], { [eagle.path]: eagle, [jazdy.path]: jazdy, "gone.md": undefined as never });
    await boot();
    await refreshIntegration(t(2026, 11, 27, 8));
    calls.length = 0;
    expect(await completeTask(eagle.path, "2026-11-27")).toBe("done");
    expect(calls).toContain(`PUT /api/tasks/${eagle.path} {"status":"done"}`);
    calls.length = 0;
    expect(await completeTask(jazdy.path, "2026-11-27")).toBe("done");
    expect(calls).toContain(`POST /api/tasks/${jazdy.path}/complete-instance {"date":"2026-11-27"}`);
    calls.length = 0;
    expect(await completeTask(jazdy.path, "2026-11-20")).toBe("already");
    expect(calls.filter((c) => !c.startsWith("GET"))).toEqual([]);
    expect(await completeTask("gone.md", "2026-11-27")).toBe("missing");
  });
});
