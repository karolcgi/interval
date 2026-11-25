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
  await realBlocks().filter({ hasText: "Houdini studying" }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Start session" }).click();
  await expectText(page.locator(".focus-offer"), /50 \/ 10/, "offers the preset's focus timer");
  await page.locator(".focus-offer").getByRole("button", { name: "Cancel" }).click();
  if (await page.locator(".ftp-clock").filter({ hasText: /^0?0:0[1-9]/ }).count()) await fail("timer must not start on cancel");
  ok("Block keeps its own tags (preset untouched); starting it offers Pomodoro 50 / 10, nothing auto-starts");

  // 5. Template: drop the preset on Wednesday 15:00
  await nav(page, "Template");
  await page.getByRole("heading", { name: "Weekly template" }).waitFor();
  await dropPreset("Houdini studying", 2, 15 * 60);
  await expectText(page.locator(".template-mode .tl-col").nth(2).locator(".block"), /Houdini studying/, "template block on Wednesday");
  await expectText(page.locator(".tpl-panel .dist"), /Studying/, "weekly totals per category");
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
  await expectText(page.locator(".three-layers"), /Suggested\s*3h 30m/, "three layers show what the template suggests");
  await shot("4-future-wednesday");
  // past days show none by default
  await goToDay("2026-11-18");
  if (await ghosts().count()) await fail("no suggestions on past days by default");
  // overlay toggle
  await goToDay("2026-12-02");
  await page.getByRole("button", { name: "Show template suggestions" }).click();
  await expectGone(ghosts(), "toggle hides suggestions");
  await page.getByRole("button", { name: "Show template suggestions" }).click();
  await ghosts().first().waitFor();
  ok("Future Wednesday: ghost at ~30% opacity, dashed, Plan lane only; none on past days; toolbar toggle works");

  // 7. Confirm with a double-click
  await g.dblclick();
  await expectText(realBlocks(), /Houdini studying/, "confirmed block");
  if (await ghosts().filter({ hasText: "Houdini" }).count()) await fail("ghost should hide once confirmed");
  if (await page.locator(".focus-offer").count()) await fail("confirming must not start a timer");
  ok("Double-click confirms it into a real planned block; the ghost hides for that date");

  // 8. Move the confirmed block; the template is unchanged
  const blk = realBlocks().filter({ hasText: "Houdini studying" }).first();
  const bb = await blk.boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + 20);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + 20 + HH, { steps: 6 });
  await page.mouse.move(bb.x + bb.width / 2, bb.y + 20 + 2 * HH, { steps: 6 });
  await page.mouse.up();
  await expectText(realBlocks().filter({ hasText: "Houdini" }), /17:00/, "block moved to 17:00");
  const movedLabel = await realBlocks().filter({ hasText: "Houdini" }).first().getAttribute("aria-label");
  if (!/17:00 – 18:30/.test(movedLabel)) await fail(`moved block should be 17:00–18:30, got ${movedLabel}`);
  if (await ghosts().filter({ hasText: "Houdini" }).count()) await fail("moving a confirmed block must not bring its ghost back");
  await nav(page, "Template");
  const tl = await page.locator(".template-mode .tl-col").nth(2).locator(".block", { hasText: "Houdini" }).getAttribute("aria-label");
  if (!/15:00 – 16:30/.test(tl)) await fail(`template should still be 15:00–16:30, got ${tl}`);
  // Edit original in Template from the confirmed block's menu
  ok("Moved the confirmed block to 17:00; the template block stays at Wednesday 15:00");

  // 9. Apply a whole day without duplicates (and with a conflict)
  await goToDay("2026-12-09");
  await expectText(page.locator(".apply-tpl"), /Apply template \(2\)/, "apply button counts suggestions");
  await page.locator(".apply-tpl").click();
  await expectGone(page.locator(".apply-tpl"), "nothing left to apply");
  if ((await realBlocks().count()) !== 2) await fail(`expected 2 planned blocks, got ${await realBlocks().count()}`);
  if (await ghosts().count()) await fail("no ghosts after applying");
  await page.keyboard.press("Control+z");
  await expectText(page.locator(".apply-tpl"), /\(2\)/, "undo brings the suggestions back");
  await page.keyboard.press("Control+y");
  await expectGone(page.locator(".apply-tpl"), "redo applies again");
  if ((await realBlocks().count()) !== 2) await fail("redo must not duplicate");
  // conflict: plan something at 15:30 on Dec 16 first
  await goToDay("2026-12-16");
  await dragCreate(0, 15 * 60 + 30, 16 * 60 + 30);
  await page.keyboard.press("Enter"); // no name
  await page.keyboard.press("6"); // Administration
  await expectText(realBlocks(), /Administration/, "conflicting block planned");
  await page.locator(".apply-tpl").click();
  await expectText(page.locator(".popover.conflicts"), /overlaps Administration/, "conflict listed");
  await page.locator(".popover.conflicts").getByRole("button", { name: "Apply, skip overlaps" }).click();
  await expectText(realBlocks(), /Client production/, "the clean suggestion was applied");
  if (await realBlocks().filter({ hasText: "Houdini" }).count()) await fail("the conflicting suggestion should be skipped");
  await expectText(ghosts(), /Houdini/, "the skipped suggestion stays a ghost");
  await shot("5-apply-conflict");
  ok("Apply template: 2 blocks, no duplicates on undo/redo; a conflict can be skipped (stays a suggestion)");

  // 10. Dismiss one date only, then restore
  await goToDay("2026-12-23");
  await ghosts().filter({ hasText: "Houdini" }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Dismiss for this day" }).click();
  await expectGone(ghosts().filter({ hasText: "Houdini" }), "dismissed ghost hides");
  await expectText(page.locator(".cal-tools"), /Restore 1/, "restore offered");
  await goToDay("2026-12-30");
  await expectText(ghosts(), /Houdini/, "other weeks unaffected");
  await goToDay("2026-12-23");
  await page.getByRole("button", { name: /Restore 1/ }).click();
  await expectText(ghosts(), /Houdini/, "restored");
  // Edit original in Template from a ghost
  await ghosts().filter({ hasText: "Houdini" }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit original in Template" }).click();
  await page.getByRole("heading", { name: "Weekly template" }).waitFor();
  await expectText(page.locator(".tpl-editor"), /every Wednesday/, "original opens in the Template editor");
  ok("Dismissed for one date (other weeks keep it), restored; “Edit original in Template” opens the source block");

  // 11. Suggestions never inflate statistics
  await goToDay("2026-12-30");
  await expectText(page.locator(".three-layers"), /Planned\s*0m/, "planned excludes suggestions");
  await expectText(page.locator(".three-layers"), /Actual\s*0m/, "actual excludes suggestions");
  await expectText(page.locator(".hero-sub"), /of 0m planned/, "hero planned total excludes suggestions");
  await nav(page, "Calendar");
  await page.locator(".tl-dayhead").nth(2).filter({ hasText: /\/ 0m/ }).waitFor({ timeout: 3000 }).catch(() => fail("week header planned stays 0m"));
  await shot("6-week-ghosts");
  ok("Unconfirmed suggestions add nothing to planned or actual totals (day panel, week header)");

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
  await goToDay("2026-12-02");
  await expectText(realBlocks(), /Houdini studying/, "confirmed block survives");
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
