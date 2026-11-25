// End-to-end checks for Phase 2 features, driven through the real UI in Chromium.
//   npm run e2e:phase2
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("./artifacts/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 1422, strictPort: false }, logLevel: "error" });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: "Europe/Warsaw" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);
const shot = (name) => page.screenshot({ path: new URL(`${name}.png`, OUT).pathname });
const fail = async (msg) => {
  await shot("phase2-failure");
  throw new Error(`Step ${step + 1} failed: ${msg}`);
};
const expectText = async (locator, re, msg) => {
  try {
    await locator.filter({ hasText: re }).first().waitFor({ timeout: 4000 });
  } catch {
    await fail(`${msg} (expected ${re})`);
  }
};
const expectCount = async (locator, n, msg) => {
  for (let i = 0; i < 40; i++) {
    if ((await locator.count()) === n) return;
    await page.waitForTimeout(100);
  }
  await fail(`${msg}: expected ${n}, got ${await locator.count()}`);
};
const local = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h - 1, min)); // CET (winter)
const HH = 56;
async function dragOnPlan(fromMin, toMin) {
  const col = page.locator(".tl-col").first();
  await page.evaluate(([m, hh]) => (document.querySelector(".tl-scroll").scrollTop = (m / 60) * hh - 80), [fromMin, HH]);
  const box = await col.locator(".lane-plan").boundingBox();
  const x = box.x + box.width / 2;
  const y = (m) => box.y + (m / 60) * HH;
  await page.mouse.move(x, y(fromMin) + 2);
  await page.mouse.down();
  await page.mouse.move(x, y((fromMin + toMin) / 2), { steps: 5 });
  await page.mouse.move(x, y(toMin) - 2, { steps: 5 });
  await page.mouse.up();
}
const planBlocks = () => page.locator(".lane-plan .block");
async function newBlock(from, to, name, key) {
  await dragOnPlan(from, to);
  await page.locator(".picker").waitFor();
  if (name) await page.keyboard.type(name);
  await page.keyboard.press("Enter");
  await page.keyboard.press(key);
  await expectText(planBlocks(), name ? new RegExp(name) : /./, `created ${name}`);
}

try {
  await page.clock.install({ time: local(2026, 11, 25, 8, 0) }); // Wednesday
  await page.goto(`${base}?db=e2e2-${Date.now()}&demo=0`);
  await page.locator(".tl-col").first().waitFor();

  // ---------------------------------------------------------------- recurrence
  await newBlock(16 * 60, 17 * 60, "Houdini", "2");
  await page.getByLabel("Repeat", { exact: true }).selectOption({ label: "Every weekday" });
  await expectText(page.locator(".repeat-meta"), /Every weekday · since/, "rule described");
  await page.keyboard.press("Escape");
  await page.keyboard.press("ArrowRight"); // Thu
  await expectText(planBlocks(), /Houdini/, "Thursday occurrence");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight"); // Sat
  await expectCount(planBlocks(), 0, "no occurrence on Saturday");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight"); // Mon
  await expectCount(planBlocks(), 1, "Monday occurrence");
  ok("Repeat every weekday: occurrences on Thu and Mon, none on Sat");

  // move Monday's occurrence and apply to following
  await planBlocks().first().click();
  await page.getByLabel("End time").fill("18:30");
  await page.getByLabel("End time").press("Enter");
  await page.getByLabel("Start time").fill("17:00");
  await page.getByLabel("Start time").press("Enter");
  await page.getByRole("button", { name: "Apply changes to following" }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("ArrowRight"); // Tue
  await expectText(planBlocks(), /17:00 – 18:30/, "following occurrences moved");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft"); // Fri
  await expectText(planBlocks(), /16:00 – 17:00/, "earlier occurrences unchanged");
  ok("Apply changes to following: Tue moves to 17:00–18:30, Fri stays at 16:00");

  // delete one occurrence; it stays deleted after a reload
  await planBlocks().first().click();
  await page.keyboard.press("Delete");
  await expectCount(planBlocks(), 0, "Friday occurrence deleted");
  await page.clock.runFor(1000); // let the browser build flush to IndexedDB (debounced)
  await page.reload();
  await page.locator(".tl-col").first().waitFor();
  for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowRight"); // Fri again
  await expectText(page.locator(".cal-title"), /November 27/, "back on Friday");
  await expectCount(planBlocks(), 0, "deleted occurrence did not come back");
  ok("A deleted occurrence stays deleted across a reload");

  // ----------------------------------------------------------------- templates
  await page.keyboard.press("t");
  await newBlock(9 * 60, 12 * 60, "Client edit", "1");
  await page.keyboard.press("Escape");
  await page.getByLabel("Day templates").click();
  await page.getByLabel("New template name").fill("Freelance day");
  await page.keyboard.press("Enter");
  await expectText(page.locator(".tpl-row"), /Freelance day.*2 blocks/, "template saved");
  await shot("phase2-templates");
  await page.keyboard.press("Escape");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight"); // Sun Nov 29
  await expectCount(planBlocks(), 0, "Sunday empty");
  await page.getByLabel("Day templates").click();
  await page.locator(".tpl-row", { hasText: "Freelance day" }).getByRole("button", { name: "Apply" }).click();
  await expectCount(planBlocks(), 2, "template applied");
  await page.keyboard.press("Control+z");
  await expectCount(planBlocks(), 0, "template undone");
  ok("Save today as “Freelance day”, apply it to Sunday, undo");

  // --------------------------------------------------------------- focus modes
  await page.keyboard.press("t");
  const panel = page.locator(".focus-panel");
  await panel.getByRole("tab", { name: "Pomodoro" }).click();
  await panel.locator(".ftp-presets").getByRole("button", { name: /^25/ }).click();
  await panel.getByRole("button", { name: "Start", exact: true }).click();
  await expectText(panel.locator(".ftp-label"), /Focus 1 of 4/, "pomodoro running");
  await expectText(panel.locator(".ftp-clock"), /25:00|24:5\d/, "countdown");
  await page.clock.runFor(25 * 60_000 + 2000);
  await expectText(panel.locator(".ftp-label"), /Short break/, "break phase starts by itself");
  await page.keyboard.press("f");
  await page.locator(".focus-overlay").waitFor();
  await expectText(page.locator(".focus-clock"), /0[45]:\d\d/, "focus overlay shows the break countdown");
  await shot("phase2-focus-mode");
  await page.keyboard.press("Escape");
  await page.locator(".focus-overlay").waitFor({ state: "detached" });
  await page.clock.runFor(5 * 60_000 + 2000);
  await expectText(panel.locator(".ftp-label"), /Break over/, "break over");
  await expectText(panel.locator(".ftp-next"), /Focus 2 of 4/, "next round announced");
  await shot("phase2-break-over");
  await panel.getByRole("button", { name: "Next round" }).click();
  await expectText(panel.locator(".ftp-label"), /Focus 2 of 4/, "round 2");
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await page.locator(".focus-panel.is-running").waitFor({ state: "detached" });
  ok("Pomodoro 25/5: focus, break (recorded), focus mode, break over, round 2, stop");

  await panel.getByRole("tab", { name: "Flowtime" }).click();
  await panel.getByRole("button", { name: "Start", exact: true }).click();
  await expectText(panel.locator(".ftp-label"), /Flowtime/, "flowtime running");
  await page.clock.runFor(62 * 60_000);
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await expectText(panel.locator(".ftp-next"), /Break · 10 min/, "flowtime suggestion");
  await panel.getByRole("button", { name: "Start break" }).click();
  await expectText(panel.locator(".ftp-label"), /Short break/, "flowtime break");
  await page.clock.runFor(10 * 60_000 + 2000);
  await panel.getByRole("button", { name: "Finish" }).click();
  await page.locator(".focus-panel.is-running").waitFor({ state: "detached" });
  await expectText(panel.locator(".ftp-clock"), /--:--|00:00|\d\d:\d\d/, "panel back to idle");
  await panel.getByRole("tab", { name: "Pomodoro" }).click();
  ok("Flowtime: 62 min focus, stop suggests 10 min break, break ends, finish");

  // ------------------------------------------------------------------- budgets
  await page.getByRole("button", { name: "Time budgets" }).click();
  await page.getByLabel("Budget for").selectOption({ label: "Studying" });
  await page.getByLabel("Target hours").first().fill("7");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel("Budget for").selectOption({ label: "Freelance work" });
  await page.getByLabel("Limit hours").first().fill("1");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expectText(page.locator(".budget-row"), /Studying.*Needs planning|Studying.*On track/, "studying budget");
  await expectText(page.locator(".budget-row"), /Freelance work.*Over limit/, "freelance limit exceeded (25 + 62 min)");
  await shot("phase2-budgets");
  ok("Weekly budgets: Studying ≥ 7h, Freelance ≤ 1h shows Over limit");

  // -------------------------------------------------------------- daily ritual
  await page.locator(".nav-item", { hasText: "Today" }).click();
  await page.locator(".ritual-prompt", { hasText: "Morning planning" }).click();
  await expectText(page.locator(".ritual"), /Plan today/, "planning opens");
  await expectText(page.locator(".ritual .ritual-total"), /planned of a 8h day/, "workday allocation");
  await shot("phase2-plan");
  await page.getByRole("button", { name: "Done planning" }).click();
  await page.locator(".ritual").waitFor({ state: "detached" });
  await page.clock.setSystemTime(local(2026, 11, 25, 18, 0));
  await page.clock.runFor(31_000);
  await page.locator(".ritual-prompt", { hasText: "Evening review" }).click();
  await expectText(page.locator(".ritual h3"), /2 blocks to confirm/, "unreviewed blocks listed");
  await page.locator(".ritual-block", { hasText: "Client edit" }).getByRole("button", { name: "Done" }).click();
  await page.locator(".ritual-block", { hasText: "Houdini" }).getByRole("button", { name: "Skipped" }).click();
  await expectText(page.locator(".ritual h3"), /All blocks reviewed/, "all reviewed");
  await expectText(page.locator(".ritual .daylog-list"), /Client edit/, "review shows the day log");
  await shot("phase2-review");
  await page.getByRole("button", { name: "Finish review" }).click();
  await page.locator(".ritual").waitFor({ state: "detached" });
  if ((await page.locator(".ritual-prompt").count()) !== 0) await fail("prompt should disappear after review");
  ok("Morning planning; evening review confirms one block, skips one, shows the day log");

  // ------------------------------------------------- click to create: name, then category
  await page.keyboard.press("Escape");
  await page.evaluate((hh) => (document.querySelector(".tl-scroll").scrollTop = 19 * hh), HH);
  {
    const box = await page.locator(".tl-col").first().locator(".lane-plan").boundingBox();
    const y = box.y + 20.5 * HH;
    await page.mouse.click(box.x + box.width / 2, y);
  }
  // Type straight away, no waiting: the name field must already have focus.
  await page.keyboard.type("Evening sketch");
  await page.keyboard.press("Enter");
  await page.keyboard.press("2");
  await expectText(planBlocks(), /Evening sketch/, "click-created block is named");
  const sketch = planBlocks().filter({ hasText: "Evening sketch" });
  await expectText(sketch, /Studying/, "and has the chosen category");
  ok("Click an empty Plan slot, type a name at once, Enter, pick category by key");

  // ------------------------------------------------------------------ day log
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.locator(".nav-item", { hasText: "Day log" }).click();
  await expectText(page.locator(".daylog-list"), /Client edit/, "day log lists recorded work");
  await page.getByRole("radio", { name: "Markdown" }).click();
  await expectText(page.locator(".daylog-md"), /# Wednesday 25 November 2026[\s\S]*\*\*Client edit\*\*/, "markdown timeline");
  await page.getByRole("button", { name: "Copy Markdown" }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  if (!/\*\*Client edit\*\*/.test(clip)) await fail("clipboard should hold the markdown, got: " + clip.slice(0, 120));
  await shot("phase2-daylog");
  await page.getByRole("button", { name: "Previous day" }).click();
  await expectText(page.locator(".daylog-date"), /Nov 24/, "browse to the previous day");
  ok("Day log: timeline from recorded time, Markdown view, copy, browse previous days");

  if (errors.length) throw new Error("Console errors:\n" + errors.join("\n"));
  console.log(`\nAll ${step} Phase 2 steps passed.`);
  writeFileSync(new URL("phase2-result.txt", OUT), `passed ${step} steps\n`);
} catch (e) {
  console.error("\n" + e.message);
  if (errors.length) console.error("Console errors:\n" + errors.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
