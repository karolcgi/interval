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
  { path: "TaskNotes/Particle lesson.md", title: "Particle simulation lesson", status: "open", scheduled: "2026-11-27", projects: ["[[Learning Houdini]]"], customProperties: { taskType: "Study" } },
  { path: "TaskNotes/Camera moves.md", title: "Camera movements", status: "open", due: "2026-11-28", projects: ["[[Roger AMEX]]"], customProperties: { taskType: "Deep Work" } },
  { path: "TaskNotes/Driving lesson.md", title: "Driving lesson", status: "open", scheduled: "2026-11-29T10:00", customProperties: { taskType: "Scheduled Event" } },
  { path: "TaskNotes/Inbox zero.md", title: "Process inbox", status: "open", customProperties: { taskType: "Inbox" } },
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
    if (req.url === "/api/filter-options") return send(200, { success: true, data: { userProperties: [{ id: "taskType", frontmatterKey: "taskType" }] } });
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

  await page.getByRole("button", { name: "Refresh" }).click();
  await page.waitForSelector(".int-row");
  await expect(page.locator(".int-col").nth(1).locator(".int-row").count().then((n) => n === 4), "Refresh imports the 4 active tasks");
  await expect(page.locator(".sync-status").innerText().then((t) => t.includes("Connected")), "Status shows Connected");

  await page.getByRole("button", { name: /Mappings/ }).click();
  const group = page.getByLabel("Group by");
  await group.fill("taskType");
  await group.press("Enter");
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.waitForFunction(() => document.querySelector(".int-col:nth-child(2)")?.textContent?.includes("Deep Work"));
  ok("Group-by mapping picks up the custom TaskNotes property");
  await page.screenshot({ path: new URL("integration-settings.png", OUT).pathname, fullPage: true });

  up = false;
  await page.getByRole("button", { name: "Refresh" }).click();
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
