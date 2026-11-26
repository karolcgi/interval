// v0.7 acceptance: navigation, activity presets and the weekly template (Karol's criteria 1–12),
// driven through the real UI in Chromium against the browser build.
//
//   node e2e/presets.mjs
//
// The clock starts on Wednesday 25 November 2026, 08:00 (Europe/Warsaw).

import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { nav } from "./nav.mjs";

const OUT = new URL("./artifacts/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const server = await createServer({ server: { port: 1424, strictPort: false }, logLevel: "error" });
await server.listen();
const base = server.resolvedUrls.local[0];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Europe/Warsaw", deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);
const fail = async (msg) => {
  await page.screenshot({ path: new URL("presets-failure.png", OUT).pathname });
  throw new Error(`Step ${step + 1} failed: ${msg}`);
};
const expectText = async (locator, re, msg) => {
  try {
    await locator.filter({ hasText: re }).first().waitFor({ timeout: 4000 });
  } catch {
    await fail(`${msg} (expected ${re})`);
  }
};
const expectGone = async (locator, msg) => {
  try {
    await locator.first().waitFor({ state: "detached", timeout: 4000 });
  } catch {
    await fail(msg);
  }
};
const shot = (name) => page.screenshot({ path: new URL(`presets-${name}.png`, OUT).pathname });
const local = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h - 1, min)); // UTC+1 in Nov/Dec
const HH = 56;

/** Scroll the visible timeline so `minute` is near the top, and return the y of that minute in column `i`. */
async function minuteY(i, minute) {
  await page.evaluate(([m, hh]) => (document.querySelector(".tl-scroll").scrollTop = (m / 60) * hh - 120), [minute, HH]);
  const col = page.locator(".tl-col").nth(i);
  const box = await col.boundingBox();
  return { x: box.x + Math.min(box.width / 4, 40), y: box.y + (minute / 60) * HH + 3 };
}

/** Drag a sidebar preset onto timeline column `i` at `minute`. Returns the preview text seen mid-drag. */
async function dropPreset(name, i, minute) {
  const row = page.locator(".sidebar .plib-row", { hasText: name });
  const rb = await row.boundingBox();
  const target = await minuteY(i, minute);
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + rb.width / 2 + 30, rb.y + rb.height / 2 + 10, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 12 });
  const preview = await page.locator(".create-ghost.drop").first().textContent({ timeout: 3000 }).catch(() => null);
  await page.mouse.up();
  return preview;
}

async function dragCreate(i, fromMin, toMin) {
  const a = await minuteY(i, fromMin);
  const lane = page.locator(".tl-col").nth(i).locator(".lane-plan");
  const lb = await lane.boundingBox();
  const x = lb.x + lb.width / 2;
  await page.mouse.move(x, a.y);
  await page.mouse.down();
  await page.mouse.move(x, a.y + ((toMin - fromMin) / 120) * HH, { steps: 5 });
  await page.mouse.move(x, a.y + ((toMin - fromMin) / 60) * HH - 6, { steps: 5 });
  await page.mouse.up();
}

const ghosts = () => page.locator(".block.ghost-suggestion");
const realBlocks = () => page.locator(".lane-plan .block:not(.ghost-suggestion)");
async function goToDay(d) {
  // Today tab, then the date picker input
  await nav(page, "Today");
  await page.locator(".cal-header input[type=date]").fill(d);
  await page.locator(".cal-title").filter({ hasText: new RegExp(String(Number(d.slice(8)))) }).waitFor();
}

try {
  const dbKey = `e2ep-${Date.now()}`;
  await page.clock.install({ time: local(2026, 11, 25, 8, 0) });
  await page.goto(`${base}?db=${dbKey}&demo=0`);
  await page.locator(".tl-col").first().waitFor({ timeout: 30000 });

  // 1. Top tabs
  if (!(await page.locator(".topbar .tab.active", { hasText: /^Today$/ }).count())) await fail("app should open on Today");
  for (const [tab, check] of [
    ["Calendar", page.locator(".timeline.multi")],
    ["Statistics", page.locator(".stats, .page").first()],
    ["Presets", page.getByRole("heading", { name: "Presets" })],
    ["Template", page.getByRole("heading", { name: "Weekly template" })],
    ["Today", page.locator(".timeline.single")],
  ]) {
    await nav(page, tab);
    await check.first().waitFor({ timeout: 4000 }).catch(() => fail(`${tab} tab did not open`));
    if (!(await page.locator(".topbar .tab.active", { hasText: new RegExp(`^${tab}$`) }).count())) await fail(`${tab} tab not marked active`);
  }
  await page.locator(".topbar .tab-more").click();
  for (const m of ["Time budgets", "Progress", "Reviews", "Day log", "Categories & tags", "Settings"]) {
    if (!(await page.getByRole("menuitem", { name: m }).count())) await fail(`More menu lacks ${m}`);
  }
  await page.keyboard.press("Escape");
  await page.mouse.click(700, 500);
  await nav(page, "Reviews");
  await expectText(page.locator(".topbar .tab-more"), /Reviews/, "More shows the active secondary page");
  await nav(page, "Today");
  ok("Top tabs: Today, Calendar, Statistics, Presets, Template; More menu holds the rest; opens on Today");

  // 2. Create the Houdini preset in the Presets tab
  await nav(page, "Presets");
  await page.getByRole("button", { name: /Create your first preset/ }).click();
  const ed = page.locator(".plib-editor");
  await ed.getByLabel("Preset name").fill("Houdini studying");
  await ed.locator(".cat-select select").selectOption({ label: "Studying" });
  await ed.getByLabel("Duration in minutes").fill("90");
  await ed.locator(".tag-input input").fill("Houdini");
  await ed.locator(".tag-input input").press("Enter");
  await expectText(ed.locator(".tag-pill"), /#Houdini/, "tag added");
  await ed.getByLabel("Focus timer preset").selectOption({ label: "Pomodoro 50 / 10" });
  await ed.getByRole("button", { name: "Create preset" }).click();
  await expectText(page.locator(".presets-page .preset-card"), /Houdini studying/, "preset listed in the Presets tab");
  await expectText(page.locator(".presets-page .preset-card"), /1h 30m|1\.5h|90/, "duration shown");
  await expectText(page.locator(".presets-page .preset-card"), /#Houdini/, "tag shown");
  // A second preset for later
  await page.locator(".presets-page .page-head").getByRole("button", { name: "New preset" }).click();
  await ed.getByLabel("Preset name").fill("Client production");
  await ed.locator(".cat-select select").selectOption({ label: "Freelance work" });
  await ed.locator(".pf-duration .chip", { hasText: /^2h$/ }).click();
  await ed.getByRole("button", { name: "Create preset" }).click();
  await expectText(page.locator(".presets-page .preset-card"), /Client production/, "second preset listed");
  await shot("1-presets-tab");
  ok("Created “Houdini studying” (Studying, 90 min, #Houdini, focus 50/10) and “Client production” (2h)");

  // 3. Sidebar library
  await expectText(page.locator(".sidebar .plib-row"), /Houdini studying/, "preset in the sidebar");
  await expectText(page.locator(".sidebar .plib-row", { hasText: "Houdini" }).locator(".preset-dur"), /1h 30m/, "sidebar shows duration");
  await page.locator(".sidebar .preset-search input").fill("houd");
  if ((await page.locator(".sidebar .plib-row").count()) !== 1) await fail("search should leave one preset");
  await page.locator(".sidebar .preset-search input").fill("");
  ok("Preset shows in the sidebar library (search works)");

  // 4. Drag it into today at 15:00
  await nav(page, "Today");
  const preview = await dropPreset("Houdini studying", 0, 15 * 60);
  if (!preview || !/15:00\s*–\s*16:30/.test(preview)) await fail(`drop preview should read 15:00 – 16:30, got ${preview}`);
  await expectText(realBlocks(), /Houdini studying/, "block created on drop");
  const lbl = await realBlocks().filter({ hasText: "Houdini studying" }).first().getAttribute("aria-label");
  if (!/15:00 – 16:30/.test(lbl)) await fail(`block should be 15:00–16:30, got ${lbl}`);
  await expectText(page.locator(".panel .tag-pill"), /#Houdini/, "block inherits the tag");
  if (await page.locator(".focus-offer").count()) await fail("dropping must not start or offer a timer");
  await shot("2-today-drop");
  ok("Dragged onto Today at 15:00: a 90-minute planned block, live preview 15:00 – 16:30, tag inherited, no dialog");

  // Editing the block never changes the preset
  await page.locator(".panel .tag-pill button").first().click();
  await nav(page, "Presets");
  await expectText(page.locator(".presets-page .preset-card", { hasText: "Houdini" }), /#Houdini/, "preset kept its tag after the block changed");
  await nav(page, "Today");

  // Focus offer from a preset block
  // v0.9: blocks have no Start button or menu item; the S key still starts the selected block
  await realBlocks().filter({ hasText: "Houdini studying" }).first().click({ button: "right" });
  if (await page.getByRole("menuitem", { name: /Start session|Confirm as done/ }).count()) await fail("block menu must not offer Start or Confirm (v0.9)");
  await page.mouse.click(5, 300); // close the menu
  await page.locator(".popover-modal").waitFor({ state: "detached" });
  if (await realBlocks().first().locator(".block-actions").count()) await fail("blocks must not show hover Start/Confirm buttons (v0.9)");
  await realBlocks().filter({ hasText: "Houdini studying" }).first().click();
  await page.keyboard.press("s");
  await expectText(page.locator(".focus-offer"), /50 \/ 10/, "offers the preset's focus timer");
  await page.locator(".focus-offer").getByRole("button", { name: "Cancel" }).click();
  if (await page.locator(".ftp-clock").filter({ hasText: /^0?0:0[1-9]/ }).count()) await fail("timer must not start on cancel");
  ok("Block keeps its own tags (preset untouched); starting it offers Pomodoro 50 / 10, nothing auto-starts");

  // 5. Template: drop the preset on Wednesday 15:00
  await nav(page, "Template");
  await page.getByRole("heading", { name: "Weekly template" }).waitFor();
  await dropPreset("Houdini studying", 2, 15 * 60);
  await expectText(page.locator(".template-mode .tl-col").nth(2).locator(".block"), /Houdini studying/, "template block on Wednesday");
  await expectText(page.locator(".tpl-panel .dist"), /Houdini studying/, "weekly totals per block name (no categories in the template)");
  if (await page.locator(".tpl-editor").getByText("Category", { exact: true }).count()) await fail("template block editor must not show a category (v0.9)");
  await expectText(page.locator(".tpl-dayhead").nth(2), /1h 30m/, "Wednesday total");
  // and the second preset on Wednesday 09:00 plus Friday by copy
  await dropPreset("Client production", 2, 9 * 60);
  await expectText(page.locator(".template-mode .tl-col").nth(2).locator(".block"), /Client production/, "second template block");
  await page.locator(".tpl-header").getByRole("button", { name: /Copy day/ }).click();
  await page.locator(".copy-day").getByLabel("Copy from").selectOption("2");
  await page.locator(".copy-day").getByRole("button", { name: "Fri" }).click();
  await page.locator(".copy-day").getByRole("button", { name: /Copy 2 blocks/ }).click();
  await expectText(page.locator(".template-mode .tl-col").nth(4).locator(".block"), /Client production/, "Friday got Wednesday's structure");
  await expectText(page.locator(".tpl-panel .sec-head"), /7h/, "week total 7h (2 × 3.5h)");
  // undo / redo
  await page.keyboard.press("Control+z");
  await expectGone(page.locator(".template-mode .tl-col").nth(4).locator(".block"), "undo removes the copied day");
  await page.keyboard.press("Control+y");
  await expectText(page.locator(".template-mode .tl-col").nth(4).locator(".block"), /Client production/, "redo restores it");
  await shot("3-template");
  ok("Template: preset dropped on Wednesday 15:00, weekly and daily totals, copy day to Friday, undo/redo");

  // 6. A future Wednesday shows the ghost at ~30% opacity
  await goToDay("2026-12-02");
  await expectText(ghosts(), /Houdini studying/, "ghost on next Wednesday");
  const g = ghosts().filter({ hasText: "Houdini" }).first();
  const op = Number(await g.evaluate((el) => getComputedStyle(el).opacity));
  if (op < 0.2 || op > 0.4) await fail(`ghost opacity should be ~0.3, got ${op}`);
  const border = await g.evaluate((el) => getComputedStyle(el).borderTopStyle);
  if (border !== "dashed") await fail(`ghost border should be dashed, got ${border}`);
  if (await page.locator(".lane-actual .ghost-suggestion").count()) await fail("ghosts must never appear in Actual");
  await expectText(page.locator(".sidebar .three-layers"), /Suggested\s*3h 30m/, "three layers (now in the left sidebar) show what the template lays out");
  await shot("4-future-wednesday");
  // past days show none by default
  await goToDay("2026-11-18");
  if (await ghosts().count()) await fail("no suggestions on past days by default");
  // overlay toggle
  await goToDay("2026-12-02");
  await page.getByRole("button", { name: "Show template overlay" }).click();
  await expectGone(ghosts(), "toggle hides suggestions");
  await page.getByRole("button", { name: "Show template overlay" }).click();
  await ghosts().first().waitFor();
  ok("Future Wednesday: ghost at ~30% opacity, dashed, Plan lane only; none on past days; toolbar toggle works");

  // 7. v0.9: ghosts are a pure overlay: no double-click confirm, no menu, no Apply/Restore
  const pe = await g.evaluate((el) => getComputedStyle(el).pointerEvents);
  if (pe !== "none") await fail(`ghosts should ignore the pointer, got pointer-events ${pe}`);
  if (await page.locator(".apply-tpl").count()) await fail("no Apply template button (v0.9)");
  if (await page.getByRole("button", { name: /Restore \d/ }).count()) await fail("no Restore button (v0.9)");
  const gb = await g.boundingBox();
  await page.mouse.dblclick(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.keyboard.press("Escape");
  if (await realBlocks().filter({ hasText: "Houdini" }).count()) await fail("double-clicking a ghost must not confirm it");
  ok("Ghosts ignore the pointer: no confirm, no menu, no Apply or Restore");

  // 8. A real block planned over a ghost sits on top of it, full width, and the ghost stays
  await goToDay("2026-12-16");
  await dragCreate(0, 15 * 60 + 30, 16 * 60 + 30);
  await page.keyboard.press("Enter"); // no name
  await page.keyboard.press("6"); // Administration
  await expectText(realBlocks(), /Administration/, "block planned over the ghost");
  await page.keyboard.press("Escape");
  await expectText(ghosts(), /Houdini/, "the ghost stays under it");
  const [rb, gh, lane] = await Promise.all([
    realBlocks().filter({ hasText: "Administration" }).first().boundingBox(),
    ghosts().filter({ hasText: "Houdini" }).first().boundingBox(),
    page.locator(".lane-plan").first().boundingBox(),
  ]);
  if (Math.abs(rb.width - gh.width) > 2 || rb.width < lane.width * 0.8) await fail(`real block should be full width over the ghost (block ${rb.width}, ghost ${gh.width}, lane ${lane.width})`);
  const z = await Promise.all([realBlocks().filter({ hasText: "Administration" }).first(), ghosts().filter({ hasText: "Houdini" }).first()].map((l) => l.evaluate((el) => Number(getComputedStyle(el).zIndex) || 0)));
  if (!(z[0] > z[1])) await fail(`real block should stack above the ghost (z ${z})`);
  await shot("5-block-over-ghost");
  ok("A block planned over a ghost sits on top of it, full width; the ghost stays visible underneath");

  // 11. Suggestions never inflate statistics
  await goToDay("2026-12-30");
  await expectText(page.locator(".sidebar .three-layers"), /Planned\s*0m/, "planned excludes suggestions");
  await expectText(page.locator(".sidebar .three-layers"), /Actual\s*0m/, "actual excludes suggestions");
  await expectText(page.locator(".sidebar .hero-sub"), /of 0m planned/, "hero planned total excludes suggestions");
  await nav(page, "Calendar");
  await page.locator(".tl-dayhead").nth(2).filter({ hasText: /\/ 0m/ }).waitFor({ timeout: 3000 }).catch(() => fail("week header planned stays 0m"));
  await shot("6-week-ghosts");
  ok("The template overlay adds nothing to planned or actual totals (sidebar card, week header)");

  // Save as preset from a block, and sidebar collapse state
  await goToDay("2026-12-16");
  await realBlocks().filter({ hasText: "Administration" }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Save as preset" }).click();
  await expectText(page.locator(".sidebar .plib-row"), /Administration/, "saved block as a preset");
  await page.locator(".sidebar .side-section", { hasText: "Activities" }).locator(".side-toggle").click();

  // 12. Restart: everything persists
  await page.waitForTimeout(300);
  await page.clock.runFor(1000); // let the browser build flush to IndexedDB (debounced)
  await page.waitForTimeout(300);
  await page.reload();
  await page.locator(".tl-col").first().waitFor({ timeout: 30000 });
  await expectText(page.locator(".sidebar .plib-row"), /Houdini studying/, "presets survive a restart");
  if ((await page.locator(".sidebar .plib-row").count()) !== 3) await fail("3 presets after restart");
  if (!(await page.locator(".sidebar .side-section.collapsed", { hasText: "Activities" }).count())) await fail("collapsed section remembered");
  await nav(page, "Template");
  if ((await page.locator(".template-mode .block").count()) !== 4) await fail("template has 4 blocks after restart");
  await goToDay("2026-12-16");
  await expectText(realBlocks(), /Administration/, "block planned over the ghost survives");
  await goToDay("2026-11-25");
  await expectText(realBlocks(), /Houdini studying/, "today's block survives");
  ok("Restart keeps presets, the template, calendar blocks and the collapsed sidebar section");

  if (errors.length) throw new Error("Console errors:\n" + errors.join("\n"));
  console.log(`\nAll ${step} preset & template steps passed.`);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
