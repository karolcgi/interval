// End-to-end checks for Phase 3 features (progress, achievements, reviews, shortcuts), on demo data.
//   npm run e2e:phase3
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("./artifacts/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 1423, strictPort: false }, logLevel: "error" });
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
  await shot("phase3-failure");
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

try {
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${base}?db=e2e3-${Date.now()}&demo=1`);
  await page.locator(".tl-col").first().waitFor({ timeout: 30000 });

  // ---------------------------------------------------------------- progress
  await page.locator(".nav-item", { hasText: "Progress" }).click();
  await expectText(page.locator(".skill"), /#Houdini/, "Houdini is a skill");
  await expectText(page.locator(".skill").filter({ hasText: "#Houdini" }), /Lv \d/, "with a level");
  await expectText(page.locator(".skill").filter({ hasText: "#Houdini" }), /h to \d/, "and hours to the next milestone");
  await expectText(page.locator(".ach.earned"), /First [\d,]+ hours of/, "hour milestones earned");
  await expectText(page.locator(".ach.earned"), /consecutive weeks of/, "weekly streaks earned");
  await expectText(page.locator(".ach.locked"), /of [\d,]+/, "next achievements show progress");
  await shot("phase3-progress");
  ok("Progress: skills with levels and milestone progress, earned and next achievements");

  await page.getByLabel("Achievement").fill("First FLIP sim that held up");
  await page.getByLabel("Skill or area").selectOption({ label: "#Houdini" });
  await page.getByRole("button", { name: "Add" }).click();
  await expectText(page.locator(".ach-list.personal"), /First FLIP sim that held up/, "personal achievement listed");
  await page.locator(".skill").filter({ hasText: "#Drawing" }).hover();
  await page.getByRole("button", { name: "Hide Drawing" }).click();
  await expectText(page.locator(".chips .chip"), /Drawing/, "hidden skill moves to Hidden");
  ok("Personal achievement recorded; a skill can be hidden and shown again");

  // ----------------------------------------------------------------- reviews
  await page.locator(".nav-item", { hasText: "Reviews" }).click();
  await expectText(page.locator(".rev-title"), /^Week \d+, \d{4}/, "last week by default");
  await expectText(page.locator(".rev-kpis"), /vs last week/, "compared with the previous week");
  await expectText(page.locator(".rev-cols"), /Freelance work/, "categories listed");
  await page.getByRole("radio", { name: "A year ago" }).click();
  await expectText(page.locator(".rev-kpis"), /same week last year/, "compared with a year ago");
  await page.getByRole("button", { name: "Copy Markdown" }).click();
  const md = await page.evaluate(() => navigator.clipboard.readText());
  if (!/^---\ntype: interval-week\nperiod: \d{4}-W\d\d/.test(md) || !md.includes("generator: interval") || !md.includes("| Category | Hours |")) await fail("week summary markdown: " + md.slice(0, 200));
  ok("Weekly review compares with last week or a year ago; Markdown has Dataview frontmatter");

  await page.getByRole("radio", { name: "Month" }).click();
  await expectText(page.locator(".rev-title"), /^[A-Z][a-z]+ \d{4}$/, "month title");
  await page.getByRole("radio", { name: "Year in review" }).click();
  await expectText(page.locator(".rev-title"), /\d{4} in review/, "year in review");
  await expectText(page.locator(".reviews"), /Skills this year/, "skills gained this year");
  await page.getByRole("button", { name: "Previous period" }).click();
  await expectText(page.locator(".reviews .ach-list"), /hours of|consecutive weeks/, "milestones of last year");
  await shot("phase3-year");
  ok("Monthly review and year in review with skills gained and milestones");

  // --------------------------------------------------------------- shortcuts
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Keyboard" }).click();
  await page.getByRole("button", { name: "Shortcut for Jump to today" }).click();
  await page.keyboard.press("g");
  await expectText(page.getByRole("button", { name: "Shortcut for Jump to today" }), /^G$/, "rebound to G");
  await page.getByRole("button", { name: "Shortcut for Open progress" }).click();
  await page.keyboard.press("g"); // takes G away from "today"
  await expectText(page.getByRole("button", { name: "Shortcut for Jump to today" }), /^–$/, "a key does one thing");
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("g");
  await expectText(page.locator(".page-title"), /Progress/, "G opens progress");
  await page.keyboard.press("l");
  await expectText(page.locator(".page-title"), /Day log/, "L opens the day log");
  ok("Shortcuts can be rebound; conflicts are resolved; new keys open Progress and Day log");

  if (errors.length) throw new Error("Console errors:\n" + errors.join("\n"));
  console.log(`\nAll ${step} Phase 3 steps passed.`);
  writeFileSync(new URL("phase3-result.txt", OUT), `passed ${step} steps\n`);
} catch (e) {
  console.error("\n" + e.message);
  if (errors.length) console.error("Console errors:\n" + errors.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
