// v0.10 integration Phase 1: Settings › Obsidian against a fake local TaskNotes API (browser build).
//
//   node e2e/integration.mjs
//
// Checks: integration off by default and nothing contacted; enabling + token + test connection; refresh imports
// tasks read-only (only GET and POST /api/tasks/query are ever called); offline keeps the cache; app works on.

import { createServer as createVite } from "vite";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { nav } from "./nav.mjs";

const OUT = new URL("./artifacts/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const TOKEN = "test-token";
const tasks = [
  { path: "TaskNotes/Particle lesson.md", title: "Particle simulation lesson", status: "study", scheduled: "2026-11-27", projects: ["[[Learning Houdini]]"], customProperties: { taskType: "Study" } },
  { path: "TaskNotes/Camera moves.md", title: "Camera movements", status: "deep work", priority: "p1", due: "2026-11-28", projects: ["[[Roger AMEX]]"], customProperties: { taskType: "Deep Work" } },
  { path: "TaskNotes/Driving lesson.md", title: "Driving lesson", status: "event", scheduled: "2026-11-29T10:00", customProperties: { taskType: "Scheduled Event" } },
  { path: "TaskNotes/Inbox zero.md", title: "Process inbox", status: "inbox", customProperties: { taskType: "Inbox" } },
];
const calls = [];
let up = true;
const api = createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": req.headers.origin ?? "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS" };
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  if (!up) return req.socket.destroy();
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    calls.push(`${req.method} ${req.url}`);
    const send = (status, json) => res.writeHead(status, { ...cors, "Content-Type": "application/json" }).end(JSON.stringify(json));
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { success: false, error: "Unauthorized" });
    if (req.url === "/api/health") return send(200, { success: true, data: { status: "ok", version: "4.12.5", vault: { name: "Karol_OS" } } });
    if (req.url.startsWith("/api/tasks?")) return send(200, { success: true, data: { tasks: tasks.slice(0, 1), pagination: { total: tasks.length, hasMore: false } } });
    if (req.url === "/api/tasks/query") {
      const q = JSON.parse(body);
      const done = q.children.some((c) => c.operator === "is-checked");
      return send(200, { success: true, data: { tasks: done ? [] : tasks } });
    }
    if (req.url === "/api/filter-options")
      return send(200, {
        success: true,
        data: {
          userProperties: [{ id: "taskType", frontmatterKey: "taskType" }],
          statuses: [
            { value: "inbox", label: "INBOX", color: "#e3e3e3", isCompleted: false, order: 0 },
            { value: "deep work", label: "DEEP WORK", color: "#db7a18", isCompleted: false, order: 2, icon: "lucide-badge-check" },
            { value: "event", label: "SCHEDULED EVENT", color: "#732a78", isCompleted: false, order: 4 },
            { value: "study", label: "STUDY", color: "#6366f1", isCompleted: false, order: 6, icon: "lucide-book-open" },
            { value: "done", label: "DONE", color: "#00aa00", isCompleted: true, order: 10 },
          ],
          priorities: [{ value: "p1", label: "90 - IMMEDIATE", color: "#fc0303", weight: 4 }],
        },
      });
    send(404, { success: false, error: "Not found" });
  });
});
await new Promise((r) => api.listen(0, "127.0.0.1", r));
const apiUrl = `http://127.0.0.1:${api.address().port}`;

const server = await createVite({ server: { port: 1425, strictPort: false }, logLevel: "error" });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Europe/Warsaw", deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);
const fail = async (msg) => {
  await page.screenshot({ path: new URL("integration-failure.png", OUT).pathname });
  console.error(`  ✗ ${msg}`);
  process.exitCode = 1;
  await browser.close();
  await server.close();
  api.close();
  process.exit(1);
};
const expect = async (cond, msg) => ((await cond) ? ok(msg) : fail(msg));

try {
  await page.goto(`${base}?db=e2e-integration-${Date.now()}`);
  await page.waitForSelector(".topbar");
  await nav(page, "Settings");
  await page.getByRole("tab", { name: "Obsidian" }).click();
  await expect(page.getByLabel("Enable Obsidian integration").isVisible(), "Obsidian tab shows the integration switch");
  await expect(!(await page.getByLabel("Enable Obsidian integration").isChecked()) && calls.length === 0, "Off by default; TaskNotes not contacted");

  await page.getByLabel("Enable Obsidian integration").check();
  const addr = page.getByLabel("TaskNotes API address");
  await addr.fill(apiUrl);
  await addr.press("Enter");
  await page.getByLabel("TaskNotes token").fill(TOKEN);
  await page.getByRole("button", { name: "Save token" }).click();
  await page.getByRole("button", { name: "Test connection" }).click();
  await page.waitForSelector(".conn-report");
  await expect(page.locator(".conn-report").innerText().then((t) => /TaskNotes 4\.12\.5 in Karol_OS: 4 tasks/.test(t)), "Test connection reports version, vault and task count");

  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.waitForSelector(".int-row");
  await expect(page.locator(".int-col").nth(1).locator(".int-row").count().then((n) => n === 4), "Refresh imports the 4 active tasks");
  await expect(page.locator(".sync-status").innerText().then((t) => t.includes("Connected")), "Status shows Connected");

  await page.getByRole("button", { name: /Mappings/ }).click();
  const group = page.getByLabel("Group by");
  await group.fill("taskType");
  await group.press("Enter");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".int-col:nth-child(2)")?.textContent?.includes("Deep Work"));
  ok("Group-by mapping picks up the custom TaskNotes property");
  await page.screenshot({ path: new URL("integration-settings.png", OUT).pathname, fullPage: true });

  // ---- Phase 2: sidebar TASKS section and drag onto PLAN
  await nav(page, "Today");
  const tasksSec = page.locator(".sidebar section[aria-label='Tasks']");
  await expect(tasksSec.isVisible(), "TASKS section appears in the sidebar when the integration is on");
  await expect(page.locator(".sidebar section[aria-label='Projects']").isVisible(), "PROJECTS section appears too");
  await tasksSec.getByRole("tab", { name: "All" }).click();
  await expect(tasksSec.locator(".ext-group-head", { hasText: "Scheduled Event" }).isVisible(), "Tasks grouped by the TaskNotes property (scheduled events get their own group)");
  await tasksSec.getByLabel("Search tasks").fill("camera");
  await expect(tasksSec.locator(".ext-row").count().then((n) => n === 1), "Search narrows the list");
  await tasksSec.getByLabel("Search tasks").fill("");

  const HH = 56;
  const dropTask = async (title, minute) => {
    const row = tasksSec.locator(".ext-row", { hasText: title });
    await row.scrollIntoViewIfNeeded();
    const rb = await row.boundingBox();
    await page.evaluate(([m, hh]) => (document.querySelector(".tl-scroll").scrollTop = (m / 60) * hh - 120), [minute, HH]);
    const col = await page.locator(".tl-col").first().boundingBox();
    const target = { x: col.x + Math.min(col.width / 4, 40), y: col.y + (minute / 60) * HH + 3 };
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    await page.mouse.down();
    await page.mouse.move(rb.x + rb.width / 2 + 30, rb.y + rb.height / 2 + 10, { steps: 4 });
    await page.mouse.move(target.x, target.y, { steps: 12 });
    await page.mouse.up();
  };
  const blocksNamed = (t) => page.locator(".tl-col .block", { hasText: t });
  await dropTask("Camera movements", 10 * 60);
  await page.waitForTimeout(200);
  await expect(blocksNamed("Camera movements").count().then((n) => n === 1), "Dragging a task onto Today creates a PLAN block at once (no dialog)");
  await expect(tasksSec.locator(".ext-row", { hasText: "Camera movements" }).count().then((n) => n === 0), "v0.12: a task on today's plan leaves the TASKS list");
  await tasksSec.getByTitle("Show the tasks already on today's plan").click();
  await expect(tasksSec.locator(".ext-row.planned", { hasText: "Camera movements" }).isVisible(), "…and comes back (dimmed) with the 'on plan' chip");
  await dropTask("Camera movements", 14 * 60);
  await page.waitForTimeout(200);
  await expect(blocksNamed("Camera movements").count().then((n) => n === 2), "The same task can be dropped again");
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(200);
  await expect(blocksNamed("Camera movements").count().then((n) => n === 1), "Undo removes the last drop");

  tasks[1].title = "Camera movements v2"; // renamed in Obsidian
  await page.locator(".sidebar section[aria-label='Tasks'] .sync-btn").click();
  await page.waitForFunction(() => [...document.querySelectorAll(".tl-col .block")].some((b) => b.textContent.includes("Camera movements v2")));
  ok("A task renamed in Obsidian renames its PLAN block");
  await page.screenshot({ path: new URL("integration-today.png", OUT).pathname });

  // ---- v0.12: grouped and coloured by TaskNotes status
  await tasksSec.getByLabel("Group tasks by").selectOption("status");
  await expect(tasksSec.locator(".ext-group-head", { hasText: "DEEP WORK" }).isVisible(), "v0.12: tasks grouped by TaskNotes status, with TaskNotes' labels");
  const heads = await tasksSec.locator(".ext-group-label").allTextContents();
  await expect(heads.join("|") === "INBOX|DEEP WORK|SCHEDULED EVENT|STUDY", `…in TaskNotes' order (${heads.join("|")})`);
  const icoColor = await tasksSec.locator(".ext-group-head", { hasText: "DEEP WORK" }).locator(".ext-status-ico").evaluate((e) => getComputedStyle(e).color);
  await expect(icoColor === "rgb(219, 122, 24)", "…coloured with the status colour");
  await tasksSec.locator(".ext-group-head", { hasText: "INBOX" }).click();
  await expect(tasksSec.locator(".ext-row", { hasText: "Process inbox" }).count().then((n) => n === 0), "Groups collapse");
  await tasksSec.locator(".ext-group-head", { hasText: "INBOX" }).click();
  await page.locator(".sidebar").screenshot({ path: new URL("v12-tasks-by-status.png", OUT).pathname });

  // ---- v0.12 / Phase 3: optional task on the focus timer
  const panel = page.locator(".focus-panel");
  await panel.getByLabel("Task: none").click();
  await panel.getByRole("option", { name: /Particle simulation lesson/ }).click();
  await expect(panel.getByLabel(/^Task: Particle simulation lesson/).isVisible(), "Focus timer: a task can be picked (optional)");
  await expect(panel.locator(".ftp-cat-name").textContent().then((t) => t === "Studying"), "…which suggests a matching activity (STUDY → Studying)");
  await panel.screenshot({ path: new URL("v12-focus-task.png", OUT).pathname });

  await nav(page, "Settings");
  await page.getByRole("tab", { name: "Obsidian" }).click();
  up = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".sync-status")?.textContent?.includes("Offline"));
  await expect(page.locator(".int-col").nth(1).locator(".int-row").count().then((n) => n === 4), "Offline: status says so, cached tasks stay");

  const writes = calls.filter((c) => !c.startsWith("GET") && c !== "POST /api/tasks/query");
  await expect(writes.length === 0, "Read-only: no write calls were made to TaskNotes");

  await nav(page, "Today");
  await expect(page.locator(".timeline, .day-view, .tl").first().isVisible(), "The rest of the app keeps working");
  await expect(errors.length === 0, `No page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  console.log("integration: all passed");
} catch (e) {
  await fail(e instanceof Error ? e.message : String(e));
}
await browser.close();
await server.close();
api.close();
