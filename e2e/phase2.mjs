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
