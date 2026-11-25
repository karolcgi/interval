// End-to-end acceptance test for the Phase 1 workflow (spec section 21), driven through
// the real UI in Chromium against the browser build (same React app, SQLite via WASM).
//
//   npm run e2e            (starts its own Vite server; needs `npx playwright install chromium` once)
//
// Time is controlled with Playwright's clock so durations are exact.

import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("./artifacts/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const server = await createServer({ server: { port: 1421, strictPort: false }, logLevel: "error" });
await server.listen();
const base = server.resolvedUrls.local[0];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Europe/Warsaw", acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);
const fail = async (msg) => {
  await page.screenshot({ path: new URL("failure.png", OUT).pathname });
  throw new Error(`Step ${step + 1} failed: ${msg}`);
};
const expectText = async (locator, re, msg) => {
  try {
    await locator.filter({ hasText: re }).first().waitFor({ timeout: 4000 });
  } catch {
    await fail(`${msg} (expected ${re})`);
  }
};
const local = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h - 1, min)); // Europe/Warsaw is UTC+1 in Nov/Dec

const HH = 56; // default hour height in px
async function dragOnPlan(fromMin, toMin) {
  const col = page.locator(".tl-col").first();
  await page.evaluate(([m, hh]) => (document.querySelector(".tl-scroll").scrollTop = (m / 60) * hh - 80), [fromMin, HH]);
  const lane = col.locator(".lane-plan");
  const box = await lane.boundingBox();
  const x = box.x + box.width / 2;
  const y = (m) => box.y + (m / 60) * HH;
  await page.mouse.move(x, y(fromMin) + 2);
  await page.mouse.down();
  await page.mouse.move(x, y((fromMin + toMin) / 2), { steps: 5 });
  await page.mouse.move(x, y(toMin) - 2, { steps: 5 });
  await page.mouse.up();
}

try {
  const dbKey = `e2e-${Date.now()}`;
  await page.clock.install({ time: local(2026, 11, 25, 8, 0) });
  await page.goto(`${base}?db=${dbKey}&demo=0`);

  // 1. Opens on today
  await expectText(page.locator(".cal-title"), /November 25/, "opens on today");
  await expectText(page.locator(".cal-eyebrow"), /Today/, "today label");
  ok("App opens on today's timeline");

  // 2-3. Drag 09:00 -> 11:30, name it, and pick Freelance work with its shortcut key
  await dragOnPlan(9 * 60, 11 * 60 + 30);
  await page.locator(".picker").waitFor();
  await page.keyboard.type("Client cut");
  await page.keyboard.press("Enter"); // name -> category
  await page.keyboard.press("1");
  await expectText(page.locator(".block"), /Client cut/, "named block created");
  const b1 = await page.locator(".block").first().getAttribute("aria-label");
  if (!/^Client cut, 09:00 – 11:30/.test(b1)) await fail(`first block has wrong name/time: ${b1}`);
  await expectText(page.locator(".block").first().locator(".block-meta"), /Freelance work/, "category shown under the name");
  ok("Drag 09:00–11:30, name “Client cut”, key 1 assigns Freelance work");

  // 4. Studying block tagged Houdini (no name: Enter skips to category, type to filter, Enter)
  await dragOnPlan(15 * 60, 16 * 60 + 30);
  await page.keyboard.press("Enter");
  await page.getByLabel("Filter categories").fill("stud");
  await page.keyboard.press("Enter");
  await page.getByLabel("Add tag").first().fill("Houdini");
  await page.keyboard.press("Enter");
  await expectText(page.locator(".tag-pill"), /#Houdini/, "tag added");
  ok("Second block: Studying, tagged #Houdini");

  // 5-6. Start a focus session from the block at 15:10, stop at 16:20
  await page.clock.setSystemTime(local(2026, 11, 25, 15, 10));
  await page.locator(".insp-actions").getByRole("button", { name: /Start session/ }).click();
  await page.locator(".focus-panel.is-running").waitFor();
  await page.clock.setSystemTime(local(2026, 11, 25, 16, 20));
  await page.clock.runFor(1500);
  await page.locator(".focus-panel").getByRole("button", { name: "Stop", exact: true }).click();
  await expectText(page.locator(".toast"), /Recorded 70 min/, "70 minutes recorded");
  ok("Session started from the block and stopped: 70 min recorded");

  // 7. Planned vs actual for today
  await page.keyboard.press("Escape");
  await expectText(page.locator(".insp-stat, .panel"), /1h 10m/, "panel shows recorded");
  await expectText(page.locator(".hero-sub"), /4h 00m planned/, "panel shows planned total");
  await expectText(page.locator(".dist li"), /Studying.*1h 10m.*1h 30m/, "studying actual vs planned");
  ok("Right panel shows 1h 10m recorded vs 4h 00m planned; Studying 1h 10m / 1h 30m");
  await page.screenshot({ path: new URL("today.png", OUT).pathname });

  // Phase 2: rename inline (double-click) and with F2, colour follows the category
  const first = page.locator(".lane-plan .block").first();
  await first.locator(".block-title").dblclick();
  await page.locator(".inline-name").fill("Client cut v2");
  await page.keyboard.press("Enter");
  await expectText(page.locator(".lane-plan .block"), /Client cut v2/, "inline rename via double-click");
  await page.keyboard.press("Escape");
  await first.click();
  await page.keyboard.press("F2");
  await page.locator(".inline-name").fill("Final cut");
  await page.keyboard.press("Enter");
  await expectText(page.locator(".lane-plan .block"), /Final cut/, "inline rename via F2");
  await page.keyboard.press("Escape");
  await page.locator(".inline-name").waitFor({ state: "detached" });
  ok("Rename a block inline with double-click and with F2");

  const colourOf = () => first.evaluate((el) => el.style.getPropertyValue("--c"));
  const before = await colourOf();
  await page.getByRole("button", { name: "Categories" }).click();
  const row = page.locator(`.cat-grid[data-name="Freelance work"]`);
  await row.getByLabel("Change colour").click();
  await row.locator("input[type=color]").fill("#e06c75");
  await page.locator(".nav-item", { hasText: "Today" }).click();
  const after = await colourOf();
  if (after !== "#e06c75" || before === after) await fail(`block colour did not follow the category (${before} -> ${after})`);
  ok("Changing a category colour recolours its blocks");

  // 12. Close and reopen a week later: everything is still there
  await page.clock.setSystemTime(local(2026, 12, 2, 10, 0));
  await page.reload();
  await page.keyboard.press("ArrowLeft"); // ensure app ready
  await page.keyboard.press("t");
  await page.evaluate(() => window.scrollTo(0, 0));
  ok("Reopened the app one week later");

  // 8-9. Statistics, Last week, studying hours
  await page.getByRole("button", { name: "Statistics" }).click();
  await page.getByRole("tab", { name: "Last week" }).click();
  await expectText(page.locator(".kpi"), /Recorded\s*1h 10m/, "last week recorded");
  await expectText(page.locator(".dist li"), /Studying\s*1\.2h/, "studying hours");
  ok("Statistics › Last week: Studying 1.2h (1h 10m) recorded");

  // 10. Filter by Houdini tag
  const tf = page.getByLabel("Filter by tag");
  await tf.fill("Houd");
  await page.keyboard.press("Enter");
  await expectText(page.locator(".kpi"), /Recorded\s*1h 10m/, "houdini filter");
  ok("Filter by #Houdini: 1h 10m");

  // 11. This year
  await page.getByRole("tab", { name: "This year" }).click();
  await expectText(page.locator(".kpi"), /Recorded\s*1h 10m/, "this year");
  ok("Range This year: 1h 10m Houdini studying");
  await page.screenshot({ path: new URL("stats.png", OUT).pathname });

  // Data integrity after reopen: both blocks still on Nov 25
  await page.locator(".nav-item", { hasText: "Today" }).click();
  await page.keyboard.press("ArrowLeft");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
  await expectText(page.locator(".cal-title"), /November 25/, "navigate back");
  const count = await page.locator(".lane-plan .block").count();
  if (count !== 2) await fail(`expected 2 blocks on Nov 25 after reopen, got ${count}`);
  ok("Both blocks persisted across reload");

  // 13. Export
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV" }).click()]);
  const csvPath = new URL("export.csv", OUT).pathname;
  await dl.saveAs(csvPath);
  const { readFileSync } = await import("node:fs");
  const csv = readFileSync(csvPath, "utf8");
  if (!/actual,.*,70,Studying,,Houdini/.test(csv)) await fail("CSV export missing the 70-minute Studying/Houdini row");
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "JSON" }).click()]);
  await dl2.saveAs(new URL("export.json", OUT).pathname);
  ok("Exported CSV and JSON (CSV contains the 70-min Studying #Houdini row)");

  if (errors.length) throw new Error("Console errors:\n" + errors.join("\n"));
  console.log(`\nAll ${step} acceptance steps passed.`);
  writeFileSync(new URL("result.txt", OUT), `passed ${step} steps\n`);
} catch (e) {
  console.error("\n" + e.message);
  if (errors.length) console.error("Console errors:\n" + errors.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
