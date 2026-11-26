// End-to-end checks for the focus timer (v0.4): docked panel, calendar link, shared state with the
// floating mini timer and the completion popup (as browser pages on the same BroadcastChannel), settings
// and focus history. Runs on demo data with a fake clock shared by every page.
//   npm run e2e:focus
import { createServer } from "vite";
import { chromium } from "playwright";
import { nav } from "./nav.mjs";
import { mkdirSync } from "node:fs";

const OUT = new URL("./artifacts/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 1424, strictPort: false }, logLevel: "error" });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Europe/Warsaw", deviceScaleFactor: 2 });
const errors = [];
const watch = (p, name) => {
  p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
};
const local = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();

let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);
let page;
const shot = (name, target = page) => target.screenshot({ path: new URL(`${name}.png`, OUT).pathname });
const fail = async (msg) => {
  await shot("focus-failure").catch(() => {});
  throw new Error(`Step ${step + 1} failed: ${msg}`);
};
const expectText = async (locator, re, msg) => {
  try {
    await locator.filter({ hasText: re }).first().waitFor({ timeout: 5000 });
  } catch {
    await fail(`${msg} (expected ${re}, got ${JSON.stringify(await locator.first().textContent().catch(() => null))})`);
  }
};
const secs = (txt) => {
  const m = /(\d+):(\d\d)(?::(\d\d))?/.exec(txt ?? "");
  if (!m) return NaN;
  return m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
};

try {
  await ctx.clock.install({ time: local(2026, 11, 25, 10, 5) });
  page = await ctx.newPage();
  watch(page, "main");
  await page.addInitScript(() => (window.__intervalSounds = []));
  await page.goto(`${base}?db=e2ef-${Date.now()}&demo=1`);
  await page.locator(".tl-col").first().waitFor({ timeout: 30000 });
  const panel = page.locator(".focus-panel");

  // 1. Docked panel below Activities, idle, presets
  await panel.waitFor();
  const order = await page.evaluate(() => {
    const secs = [...document.querySelectorAll(".sidebar .side-section")];
    const act = secs.findIndex((s) => /Activities/i.test(s.querySelector(".eyebrow, h3, .side-head")?.textContent ?? ""));
    const fp = secs.findIndex((s) => s.classList.contains("focus-panel"));
    return { act, fp };
  });
  if (order.fp !== order.act + 1) await fail(`focus panel should follow Activities (got ${JSON.stringify(order)})`);
  await panel.getByRole("tab", { name: "Pomodoro" }).click();
  await panel.locator(".ftp-presets").getByRole("button", { name: /^50/ }).click();
  await expectText(panel.locator(".ftp-clock"), /50:00/, "50 min preset");
  await panel.locator(".ftp-presets").getByRole("button", { name: /^25/ }).click();
  await expectText(panel.locator(".ftp-clock"), /25:00/, "25 min preset");
  await expectText(panel.locator(".ftp-label"), /Focus 1 of 4/, "idle label");
  await shot("focus-panel-idle", panel);
  ok("Docked panel sits under Activities; presets 25/50 set the clock");

  // 1b. Category picker: choosing a category drops the suggested block; relink brings it back
  const pick = async (name) => {
    await panel.locator(".ftp-cat-btn").click();
    await panel.getByRole("listbox", { name: "Category" }).getByRole("option", { name }).click();
    await expectText(panel.locator(".ftp-cat-btn"), new RegExp(name), `category ${name} shown`);
  };
  const hadBlock = await panel.locator(".ftp-block").count();
  const blockCat = (await panel.locator(".ftp-cat-name").textContent()).trim();
  await pick(blockCat === "Studying" ? "Personal art" : "Studying");
  if (hadBlock) {
    if (await panel.locator(".ftp-block").count()) await fail("block should be unlinked after choosing another category");
    await panel.locator(".ftp-relink").click();
    await panel.locator(".ftp-block").waitFor();
    await expectText(panel.locator(".ftp-cat-name"), new RegExp(blockCat), "relinking restores the block's category");
  }
  await panel.locator(".ftp-cat-btn").focus();
  await page.keyboard.press("ArrowDown");
  await panel.getByRole("listbox").waitFor();
  await page.keyboard.press("Escape");
  await panel.getByRole("listbox").waitFor({ state: "detached" });
  ok("Category picker opens, picks, closes with Escape; picking another category unlinks the block, relink restores it");

  // 2. Start (linked to the planned block if there is one), the clock counts down
  const linked = await panel.locator(".ftp-block").count();
  await panel.getByRole("button", { name: "Start", exact: true }).click();
  await page.locator(".focus-panel.is-running").waitFor();
  if (linked) await panel.locator(".ftp-block.linked").waitFor();
  await ctx.clock.runFor(60_000);
  await expectText(panel.locator(".ftp-clock"), /24:0\d|23:5\d/, "counting down");
  await shot("focus-panel-running", panel);
  await pick("Creative research");
  await ctx.clock.runFor(1500);
  const recCat = await page.evaluate(async () => {
    const st = (await import("/src/state/store.ts")).store.get();
    return st.categories.find((c) => c.id === st.running?.categoryId)?.name;
  });
  if (recCat !== "Creative research") await fail(`running session category is ${recCat}`);
  await pick(blockCat === "Creative research" ? "Studying" : blockCat || "Studying");
  ok(`Pomodoro started${linked ? ", linked to the current planned block" : ""}; countdown runs; category can be changed while running`);

  // 3. Floating mini timer shares the state and sends commands back
  const mini = await ctx.newPage();
  watch(mini, "mini");
  await mini.setViewportSize({ width: 360, height: 173 }); // v0.9: matches mini_size("standard") in shell.rs (25% larger)
  await mini.goto(`${base}?window=mini`);
  await mini.locator(".float-root.mini .mt-clock").waitFor();
  await ctx.clock.runFor(1000);
  const a = secs(await panel.locator(".ftp-clock").textContent());
  const b = secs(await mini.locator(".mt-clock").textContent());
  const nows = [await page.evaluate(() => Date.now()), await mini.evaluate(() => Date.now())];
  // Playwright's fake clock can sit a moment apart between pages; allow for that drift, nothing more.
  if (!(Math.abs(a - b) <= 1 + Math.ceil(Math.abs(nows[1] - nows[0]) / 1000))) await fail(`mini clock ${b}s differs from panel ${a}s (now ${nows})`);
  await expectText(mini.locator(".mt-foot"), /Focus 1 of 4/, "mini shows the phase");
  await expectText(mini.locator(".mt-next"), /Short break · 5 min/, "mini shows what's next");
  await shot("focus-mini-standard", mini);
  const fit = await mini.evaluate(() => [document.querySelector(".mt-toggle")?.getBoundingClientRect().bottom ?? 999, innerHeight, document.querySelector(".mt-note")?.getBoundingClientRect().bottom ?? 999]);
  if (fit[0] > fit[1] + 0.5 || fit[2] > fit[1]) await fail(`note line and arrow must fit the standard window (${fit})`);
  await mini.getByRole("button", { name: "Pause" }).click();
  await panel.getByRole("button", { name: "Resume" }).waitFor();
  const frozen = await panel.locator(".ftp-clock").textContent();
  await ctx.clock.runFor(120_000);
  if ((await panel.locator(".ftp-clock").textContent()) !== frozen) await fail("clock moved while paused");
  await expectText(mini.locator(".mt-clock"), new RegExp(frozen.trim()), "mini frozen at the same time");
  await mini.getByRole("button", { name: "Resume" }).click();
  await panel.getByRole("button", { name: "Pause" }).waitFor();
  ok("Mini timer mirrors the panel clock; pause/resume from the mini timer, paused time excluded");

  // 4. Extend +5 / +10
  const before = secs(await panel.locator(".ftp-clock").textContent());
  await panel.getByRole("button", { name: "Add 5 minutes" }).click();
  await panel.getByRole("button", { name: "Add 10 minutes" }).click();
  await ctx.clock.runFor(500);
  const after = secs(await panel.locator(".ftp-clock").textContent());
  if (Math.abs(after - before - 15 * 60) > 2) await fail(`extend added ${after - before}s, expected 900`);
  ok("+5 and +10 extend the running round");

  // 5. Compact layout from Settings › Focus timer
  await panel.getByRole("button", { name: "Focus timer settings" }).click();
  await page.locator("#focus-timer").waitFor();
  await page.getByRole("tab", { name: "Floating timer & tray" }).click();
  await page.getByRole("radiogroup", { name: "Floating timer layout" }).getByRole("radio", { name: "Compact" }).click();
  await mini.locator(".float-root.mini.compact").waitFor();
  await mini.setViewportSize({ width: 235, height: 50 });
  await shot("focus-mini-compact", mini);
  await shot("focus-settings");
  await page.getByRole("radiogroup", { name: "Floating timer layout" }).getByRole("radio", { name: "Standard" }).click();
  await mini.locator(".float-root.mini.standard").waitFor();
  ok("Settings › Focus timer opens from the panel; layout switches the mini timer to compact and back");

  // 6. Round ends: break starts by itself, completion card offers the next steps; +5 focus withdraws the break
  await page.keyboard.press("t");
  const left = secs(await panel.locator(".ftp-clock").textContent());
  await ctx.clock.runFor((left + 2) * 1000);
  await expectText(panel.locator(".ftp-label"), /Short break/, "short break started");
  await page.locator(".in-app-completion .completion-card").waitFor();
  await expectText(page.locator(".in-app-completion"), /Focus complete/, "in-app card");
  const popup = await ctx.newPage();
  watch(popup, "popup");
  await popup.setViewportSize({ width: 320, height: 176 });
  await popup.goto(`${base}?window=popup`);
  await popup.locator(".completion-card").waitFor();
  await expectText(popup.locator(".cc-title"), /39m|40m/, "focused duration");
  await expectText(popup.locator(".cc-body"), /Short break running · 5 min/, "break running");
  // "What did you get done?" on the popup: saved as a diary note on the round's session
  const ask = popup.getByRole("textbox", { name: "What did you get done?" });
  await ask.fill("Blocked out the hero shot");
  await ask.press("Enter");
  await expectText(popup.locator(".annotate-saved"), /Saved/, "note saved from the popup");
  await expectText(page.locator(".toast"), /Note saved/, "main window saved the note");
  await shot("focus-popup", popup);
  await popup.getByRole("button", { name: "+5 min focus" }).click();
  await expectText(panel.locator(".ftp-label"), /Focus 1 of 4/, "back in focus 1");
  await expectText(panel.locator(".ftp-clock"), /0[45]:\d\d/, "five more minutes");
  await page.locator(".in-app-completion").waitFor({ state: "detached" });
  const sounds = await page.evaluate(() => window.__intervalSounds);
  if (!sounds.includes("focusStart") || !sounds.includes("focusEnd")) await fail(`sounds played: ${JSON.stringify(sounds)}`);
  ok("Focus ends → break starts, completion card + popup asks what got done (note saved); “+5 min focus” continues the round seamlessly");

  // 7. Skip to break, skip break, stop
  await panel.getByRole("button", { name: "Skip to break" }).click();
  await expectText(panel.locator(".ftp-label"), /Short break/, "skipped to break");
  if ((await panel.locator(".cycle-dot.done").count()) !== 1) await fail("one round done");
  await panel.getByRole("button", { name: "Skip break" }).click();
  await expectText(panel.locator(".ftp-label"), /Break over|Focus 2 of 4/, "break skipped");
  await panel.getByRole("button", { name: /Finish|Stop/ }).first().click();
  await page.locator(".focus-panel.is-running").waitFor({ state: "detached" });
  ok("Skip to break, skip break, finish");

  // 8. Focus history in Statistics
  await nav(page, "Statistics");
  await page.getByRole("tab", { name: "Today" }).click();
  const fh = page.locator(".focus-history");
  await fh.waitFor();
  await expectText(fh.locator(".kpi").filter({ hasText: "Focus sessions" }).locator(".kpi-val"), /^1$/, "one focus session today");
  await expectText(fh.locator(".kpi").filter({ hasText: "Focused" }).first(), /\d+h|\d+m/, "focused time shown");
  await expectText(fh.locator(".kpi").filter({ hasText: "Break time" }), /\d/, "break time shown");
  await fh.scrollIntoViewIfNeeded();
  await shot("focus-history", fh);
  await page.getByRole("tab", { name: "This year" }).click();
  await fh.getByRole("radiogroup", { name: "Focus history period" }).getByRole("radio", { name: "Month" }).click();
  ok("Statistics › Focus timer: focused time, sessions, breaks, per-period and per-category breakdown");

  // 9. Sidebar width: drag the edge, remembered after a reload; double-click resets
  const side = page.locator(".sidebar");
  const w0 = (await side.boundingBox()).width;
  const grip = page.locator(".sidebar-resizer");
  const g = await grip.boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + 300);
  await page.mouse.down();
  await page.mouse.move(g.x + 60, g.y + 300, { steps: 6 });
  await page.mouse.move(g.x + 100, g.y + 300, { steps: 6 });
  await page.mouse.up();
  const w1 = (await side.boundingBox()).width;
  if (Math.abs(w1 - (w0 + 97)) > 6) await fail(`sidebar ${w0} → ${w1}, expected about +100`);
  await page.waitForTimeout(1500); // let the browser database flush before reloading
  await page.reload();
  await page.locator(".tl-col").first().waitFor({ timeout: 30000 });
  const w2 = (await side.boundingBox()).width;
  if (Math.abs(w2 - w1) > 2) await fail(`sidebar width not remembered: ${w1} → ${w2}`);
  await shot("focus-sidebar-wide");
  await page.locator(".sidebar-resizer").dblclick();
  await page.waitForTimeout(300);
  const w3 = (await side.boundingBox()).width;
  if (Math.abs(w3 - w0) > 2) await fail(`double-click should reset to ${w0}, got ${w3}`);
  ok(`Sidebar resizes by dragging its edge (${Math.round(w0)} → ${Math.round(w1)}px), is remembered, double-click resets`);

  // 10. Abandon: a discarded session leaves no trace in the history
  await nav(page, "Statistics");
  await page.getByRole("tab", { name: "Today" }).click();
  const sessionsKpi = page.locator(".focus-history .kpi").filter({ hasText: "Focus sessions" }).locator(".kpi-val");
  await expectText(sessionsKpi, /^1$/, "one session before abandoning");
  await panel.locator(".ftp-controls .btn-focus", { hasText: "Start" }).click();
  await page.locator(".focus-panel.is-running").waitFor();
  await ctx.clock.runFor(180_000);
  await panel.getByRole("button", { name: "Abandon" }).click();
  await panel.getByRole("alertdialog", { name: "Abandon session" }).getByRole("button", { name: "Discard" }).click();
  await page.locator(".focus-panel.is-running").waitFor({ state: "detached" });
  await expectText(page.locator(".toast"), /Session discarded/, "discard toast");
  await nav(page, "Day log");
  await nav(page, "Statistics");
  await expectText(sessionsKpi, /^1$/, "still one session after abandoning");
  ok("Abandon → confirm discards the running session; history still shows only the earlier session");

  // 11. Mini timer edit view (v0.8: opened by the always-visible arrow at the bottom): name, category, length, start, keep on top
  await mini.setViewportSize({ width: 360, height: 575 });
  if (!(await mini.locator(".mt-toggle").isVisible())) await fail("the down arrow should always be visible");
  await mini.getByRole("button", { name: "Name, category, length" }).click();
  await mini.getByRole("textbox", { name: "Session name" }).fill("Lookdev pass");
  // v0.9: category is a dropdown with icon and colour
  if (await mini.getByRole("listbox", { name: "Category" }).count()) await fail("category list should stay closed until the dropdown opens");
  await mini.getByRole("button", { name: /^Category:/ }).click();
  await mini.getByRole("listbox", { name: "Category" }).getByRole("option", { name: "Studying" }).click();
  if (await mini.getByRole("listbox", { name: "Category" }).count()) await fail("category dropdown should close after picking");
  await expectText(mini.locator(".mt-dd-btn"), /Studying/, "dropdown shows the picked category");
  await mini.locator(".mt-lengths").getByRole("button", { name: /^15/ }).click();
  await shot("focus-mini-edit", mini);
  await mini.locator(".mt-edit").getByRole("button", { name: /^Start/ }).click();
  await page.locator(".focus-panel.is-running").waitFor();
  await expectText(panel.locator(".ftp-cat-name"), /Studying/, "category from the mini timer");
  await expectText(panel.locator(".ftp-clock"), /1[45]:\d\d/, "15 minute round");
  await expectText(panel.locator(".ftp-title"), /Lookdev pass/, "name from the mini timer");
  await mini.locator(".mt-clock.live").waitFor({ timeout: 4000 }).catch(() => fail("running clock should have the green live indicator"));
  const liveBg = await mini.locator(".mt-clock.live").evaluate((el) => getComputedStyle(el).backgroundColor);
  if (!liveBg || liveBg === "rgba(0, 0, 0, 0)") await fail("live indicator should have a background");
  const pin = mini.getByRole("button", { name: /Keep on top|Stop keeping on top/ });
  const pinned = await pin.getAttribute("aria-pressed");
  await pin.click();
  await mini.waitForFunction((was) => document.querySelector(".mt-top [aria-pressed]")?.getAttribute("aria-pressed") !== was, pinned);
  // v0.9: Abandon sits on the main face next to pause and stop, behind the same confirm step
  if (await mini.locator(".mt-edit").count()) await mini.getByRole("button", { name: "Hide name, category and length" }).click();
  await mini.locator(".mt-actions").getByRole("button", { name: "Abandon" }).click();
  await mini.getByRole("alertdialog", { name: "Abandon session" }).getByRole("button", { name: "Keep" }).click();
  await page.locator(".focus-panel.is-running").waitFor();
  await mini.locator(".mt-actions").getByRole("button", { name: "Abandon" }).click();
  await shot("focus-mini-abandon", mini);
  await mini.getByRole("alertdialog", { name: "Abandon session" }).getByRole("button", { name: "Discard" }).click();
  await page.locator(".focus-panel.is-running").waitFor({ state: "detached" });
  ok("Mini timer: bottom arrow opens name, category, 15 min length and Start; green live pill while running; pin toggles on-top; category dropdown; abandon from the main face (Keep, then Discard)");

  // 11b. Quick note line on the mini timer → Day log, in the accent colour, at the time it was sent
  const note = mini.getByRole("textbox", { name: "Quick note for the day log" });
  await note.fill("client wants the logo bigger");
  await note.press("Enter");
  await expectText(page.locator(".toast"), /Note added to the day log/, "note toast");
  if ((await note.inputValue()) !== "") await fail("note box should clear after sending");
  await shot("focus-mini-note", mini);
  await nav(page, "Day log");
  const noteRow = page.locator(".daylog-list li.dl-note", { hasText: "client wants the logo bigger" });
  await noteRow.waitFor({ timeout: 4000 }).catch(() => fail("note should be listed in the day log"));
  if (!/^\d\d:\d\d$/.test((await noteRow.locator(".dl-time").textContent()).trim())) await fail("note should show the time it was posted");
  const [noteColor, accent] = await noteRow.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()]);
  const hex = (rgb) => "#" + rgb.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  if (hex(noteColor) !== accent.toLowerCase()) await fail(`note should use the accent colour (${noteColor} vs ${accent})`);
  await page.getByRole("radio", { name: "Markdown" }).click();
  await expectText(page.locator(".daylog-md"), /\*Note:\* client wants the logo bigger/, "note in the Markdown log");
  await page.getByRole("radio", { name: "Timeline" }).click();
  await shot("daylog-note");
  ok("Quick note from the mini timer lands in the Day log with its time, in the accent colour, and in the Markdown");

  // 12. Settings are split into tabs
  await nav(page, "Settings");
  for (const [tab, section] of [["General", "Appearance"], ["Alerts & sounds", "Sounds"], ["Floating timer & tray", "Close to tray"], ["Data & updates", "Updates"]]) {
    await page.getByRole("tab", { name: tab }).click();
    await page.getByText(section, { exact: false }).first().waitFor({ timeout: 5000 }).catch(() => fail(`${tab} tab should show ${section}`));
  }
  if (!(await page.getByRole("checkbox", { name: "Close to tray" }).isChecked().catch(() => false))) {
    await page.getByRole("tab", { name: "Floating timer & tray" }).click();
    if (!(await page.getByRole("checkbox", { name: "Close to tray" }).isChecked())) await fail("close to tray should default to on");
  }
  await shot("settings-tabs");
  ok("Settings are split into tabs; close-to-tray is on by default");

  // 13. Category icons (Lucide) + colours; block icon and colour from the inspector
  await nav(page, "Categories");
  const row = page.locator(".cat-grid[data-name='Studying']");
  await row.getByRole("button", { name: "Change colour" }).click();
  const swatches = await row.locator(".swatches .swatch:not(.custom)").count();
  if (swatches < 24) await fail(`expected 24+ colours, got ${swatches}`);
  await row.getByRole("button", { name: "Change colour" }).click();
  await row.getByRole("button", { name: "Category icon" }).click();
  if (await page.getByRole("textbox", { name: "Search emoji" }).count()) await fail("no emoji picker any more");
  await page.getByRole("textbox", { name: "Search icons" }).fill("book");
  await page.getByRole("dialog", { name: "Pick an icon" }).locator("[data-icon='library']").click();
  await page.locator(".sidebar .cat-row", { hasText: "Studying" }).locator(".cat-icon svg").waitFor({ timeout: 4000 }).catch(() => fail("icon should show in Activities"));
  await shot("categories-icons");
  await nav(page, "Today");
  const blk = page.locator(".tl-col .block").first();
  await blk.click();
  await page.getByRole("button", { name: "Block icon" }).click();
  await page.getByRole("textbox", { name: "Search icons" }).fill("rocket");
  await page.getByRole("textbox", { name: "Search icons" }).press("Enter");
  await page.locator(".insp-title-row .icon-trigger.has svg").waitFor({ timeout: 4000 }).catch(() => fail("block icon set"));
  await page.locator(".insp .color-field").getByRole("radio", { name: "Colour #d98c9a" }).click();
  const blkC = await page.locator(".tl-col .block.selected").evaluate((el) => el.style.getPropertyValue("--c"));
  if (blkC !== "#d98c9a") await fail(`block should take its own colour, got ${blkC}`);
  await page.locator(".tl-col .block.selected .block-title .cat-icon svg").waitFor({ timeout: 4000 }).catch(() => fail("block shows its icon"));
  await shot("block-icon-colour");
  ok(`${swatches} category colours; Lucide icon shows in Activities; a block gets its own icon and colour from the inspector`);

  // 15. Diary notes in the details panel: the note from the popup is on the recorded session; add another
  await page.keyboard.press("Escape");
  // The round's session: the longest recorded "Client production" entry today
  const idx = await page.evaluate(() => {
    const els = [...document.querySelectorAll(".session")];
    let best = -1, h = 0;
    els.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if ((el.getAttribute("title") || "").startsWith("Client production") && r.height > h) (best = i), (h = r.height);
    });
    return best;
  });
  if (idx < 0) await fail("no recorded Client production session");
  await page.locator(".session").nth(idx).click();
  await expectText(page.locator(".diary-item"), /Blocked out the hero shot/, "popup note on the session");
  await page.getByRole("button", { name: /^Note type/ }).last().click();
  await page.getByRole("listbox", { name: "Note type" }).getByRole("option", { name: /Learning/ }).click();
  await page.getByRole("textbox", { name: "Add a diary note" }).fill("Long lens flattens the set nicely");
  await page.getByRole("textbox", { name: "Add a diary note" }).press("Enter");
  await expectText(page.locator(".diary-item.kind-learning"), /Long lens/, "learning note added");
  await page.locator(".diary-item", { hasText: "Long lens" }).locator(".diary-text").click();
  await page.getByRole("textbox", { name: "Edit note" }).fill("Long lens flattens the set");
  await page.getByRole("textbox", { name: "Edit note" }).press("Enter");
  await expectText(page.locator(".diary-item.kind-learning .diary-text"), /^Long lens flattens the set$/, "note edited");
  await shot("diary-notes");
  ok("Details panel › Diary: the popup's note sits on the recorded session; notes can be added, typed and edited");

  if (errors.length) throw new Error(`Console errors:\n${errors.join("\n")}`);
  console.log(`\nAll ${step} focus timer steps passed.`);
} catch (e) {
  console.error(e.message);
  if (errors.length) console.error(errors.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
