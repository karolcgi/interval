// End-to-end checks for the focus timer (v0.4): docked panel, calendar link, shared state with the
// floating mini timer and the completion popup (as browser pages on the same BroadcastChannel), settings
// and focus history. Runs on demo data with a fake clock shared by every page.
//   npm run e2e:focus
import { createServer } from "vite";
import { chromium } from "playwright";
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

  // 2. Start (linked to the planned block if there is one), the clock counts down
  const linked = await panel.locator(".ftp-block").count();
  await panel.getByRole("button", { name: "Start", exact: true }).click();
  await page.locator(".focus-panel.is-running").waitFor();
  if (linked) await panel.locator(".ftp-block.linked").waitFor();
  await ctx.clock.runFor(60_000);
  await expectText(panel.locator(".ftp-clock"), /24:0\d|23:5\d/, "counting down");
  await shot("focus-panel-running", panel);
  ok(`Pomodoro started${linked ? ", linked to the current planned block" : ""}; countdown runs`);

  // 3. Floating mini timer shares the state and sends commands back
  const mini = await ctx.newPage();
  watch(mini, "mini");
  await mini.setViewportSize({ width: 288, height: 118 });
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
  await page.getByRole("radiogroup", { name: "Floating timer layout" }).getByRole("radio", { name: "Compact" }).click();
  await mini.locator(".float-root.mini.compact").waitFor();
  await mini.setViewportSize({ width: 188, height: 40 });
  await shot("focus-mini-compact", mini);
  await page.locator("#focus-timer").scrollIntoViewIfNeeded();
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
  await shot("focus-popup", popup);
  await popup.getByRole("button", { name: "+5 min focus" }).click();
  await expectText(panel.locator(".ftp-label"), /Focus 1 of 4/, "back in focus 1");
  await expectText(panel.locator(".ftp-clock"), /0[45]:\d\d/, "five more minutes");
  await page.locator(".in-app-completion").waitFor({ state: "detached" });
  ok("Focus ends → break starts, completion card + popup; “+5 min focus” continues the round seamlessly");

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
  await page.locator(".nav-item", { hasText: "Statistics" }).click();
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
