// Desktop smoke test: drives the real release build (Rust shell, IPC, capabilities, extra windows,
// bundled assets, audio) through tauri-driver + WebKitWebDriver on Linux.
//   npx tauri build --no-bundle && node e2e/desktop.mjs
// Needs: tauri-driver (cargo install tauri-driver), WebKitWebDriver (webkit2gtk-driver), Xvfb, and an
// audio sink (pulseaudio with a null sink is enough). Windows-only behaviour (WebView2, tray icon,
// fullscreen detection, focus stealing) can't be covered here.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const APP = new URL("../src-tauri/target/release/interval", import.meta.url).pathname;
const OUT = new URL("./artifacts/", import.meta.url);
mkdirSync(OUT, { recursive: true });
if (!existsSync(APP)) throw new Error(`Build first: ${APP} is missing`);

const home = mkdtempSync(join(tmpdir(), "interval-desktop-"));
const env = { ...process.env, HOME: home, XDG_DATA_HOME: join(home, "data"), XDG_CONFIG_HOME: join(home, "config") };
const driver = spawn("tauri-driver", ["--port", "4444"], { env, stdio: ["ignore", "inherit", "inherit"] });
await new Promise((r) => setTimeout(r, 1500));

const W = "http://127.0.0.1:4444";
let sid = null;
async function wd(method, path, body) {
  const res = await fetch(`${W}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (json.value && json.value.error) throw new Error(`${path}: ${json.value.error} ${json.value.message}`);
  return json.value;
}
const s = (path) => `/session/${sid}${path}`;
const js = (script, ...args) => wd("POST", s("/execute/sync"), { script, args });
const jsAsync = (script, ...args) => wd("POST", s("/execute/async"), { script, args });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, timeout = 15000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e.message;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}
async function click(css, text) {
  const ok = await js(
    `const [css, text] = arguments; const el = [...document.querySelectorAll(css)].find((e) => !text || e.textContent.includes(text)); if (!el) return false; el.scrollIntoView({block: "center"}); el.click(); return true;`,
    css,
    text ?? null,
  );
  if (!ok) throw new Error(`no element ${css} ${text ?? ""}`);
}
const invoke = (cmd, args = {}) => (process.env.DEBUG && console.log("invoke", cmd), jsAsync)(`const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then((v) => done({ ok: v }), (e) => done({ err: String(e) }));`, cmd, args);
async function screenshot(name) {
  const png = await wd("GET", s("/screenshot"));
  const { writeFileSync } = await import("node:fs");
  writeFileSync(new URL(`${name}.png`, OUT), Buffer.from(png, "base64"));
}
const windows = async () => (await invoke("plugin:window|get_all_windows")).ok ?? [];

let step = 0;
const ok = (m) => console.log(`  ✓ ${++step}. ${m}`);
try {
  sid = (await wd("POST", "/session", { capabilities: { alwaysMatch: { "tauri:options": { application: APP } } } })).sessionId;
  await waitFor(() => js("return !!document.querySelector('.focus-panel')"), "the focus panel", 30000);
  await js("window.__intervalSounds = []; return true");
  ok("Release build starts; Focus timer panel is docked in the sidebar");

  // Category picker in the real webview
  await click(".ftp-cat-btn");
  await waitFor(() => js("return !!document.querySelector('.ftp-cat-list')"), "category list");
  await click(".ftp-cat-list li", "Studying");
  await waitFor(() => js("return document.querySelector('.ftp-cat-name').textContent.includes('Studying')"), "Studying chosen");
  ok("Category picker opens and picks Studying");

  // A 1-minute round so the transition happens for real
  await js("document.querySelector('.ftp-presets')?.scrollIntoView(); return true");
  await click('button[aria-label="Focus timer settings"]');
  await waitFor(() => js("return !!document.querySelector('#focus-timer')"), "focus settings");
  await js(`const i = document.querySelector('input[aria-label="Focus minutes"]'); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '1'); i.dispatchEvent(new Event('input', {bubbles: true})); i.dispatchEvent(new Event('change', {bubbles: true})); i.blur(); return true;`);
  await waitFor(() => js("return document.querySelector('.ftp-clock')?.textContent.trim() === '01:00'"), "1 minute focus in the panel");
  await screenshot("desktop-settings");
  // Sound preview through Web Audio (Settings › Alerts & sounds tab)
  await click('.settings-tab', "Alerts & sounds");
  await click('button[aria-label="Preview Focus completed"]');
  await waitFor(() => js("return (window.__intervalSounds || []).includes('focusEnd')"), "sound preview to play");
  ok("Settings › Focus timer works; sound preview plays through Web Audio (bundled WAV decoded)");

  await click(".ftp-controls .btn-focus", "Start");
  await waitFor(() => js("return !!document.querySelector('.focus-panel.is-running')"), "timer running");
  await waitFor(() => js("return (window.__intervalSounds || []).includes('focusStart')"), "focus start sound");
  ok("Round started; focus-start sound played");

  // Floating mini timer: a real second window
  const r = await invoke("mini_show", { open: true });
  if (r.err) throw new Error(`mini_show: ${r.err}`);
  await waitFor(async () => (await windows()).includes("mini"), "mini window");
  const grow = await invoke("mini_expand", { expanded: true, height: 420 });
  if (grow.err) throw new Error(`mini_expand: ${grow.err}`);
  const shrink = await invoke("mini_expand", { expanded: false });
  if (shrink.err) throw new Error(`mini_expand back: ${shrink.err}`);
  ok("Floating mini timer window opens (async command, off the main thread) and resizes for its edit view");
  await screenshot("desktop-running");

  // Let the round end for real: popup window + sound
  await waitFor(() => js("return /Short break/.test(document.querySelector('.ftp-label')?.textContent || '')"), "break to start", 75000);
  await waitFor(() => js("return (window.__intervalSounds || []).includes('focusEnd')"), "focus end sound");
  await waitFor(async () => (await windows()).includes("popup"), "completion popup window", 8000);
  ok("Round ended → break started, focus-end sound played, completion popup window opened");

  // "What did you get done?" in the docked panel during the break: saved in the real database (migration v6)
  await js(`const i = document.querySelector('.focus-panel .annotate-input'); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Desktop note'); i.dispatchEvent(new Event('input', {bubbles: true})); return true;`);
  await js(`document.querySelector('.focus-panel .annotate-input').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); return true;`);
  await waitFor(() => js("return /Note saved/.test(document.querySelector('.toast')?.textContent || '')"), "note saved toast");
  ok("Diary note from the timer panel saved to SQLite");

  // The popup grows to fit its card (the "what did you get done?" box)
  await invoke("popup_fit", { height: 260 }).then((r) => { if (r.err) throw new Error(`popup_fit: ${r.err}`); });
  ok("Completion popup resizes to fit its card");

  // A second popup in the same session reuses the window instead of failing on the label
  const again = await invoke("popup_show");
  if (again.err || again.ok !== true) throw new Error(`popup_show again: ${JSON.stringify(again)}`);
  await invoke("popup_close");
  await waitFor(async () => !(await windows()).includes("popup"), "popup closed");
  await invoke("mini_show", { open: false });
  await waitFor(async () => !(await windows()).includes("mini"), "mini closed");
  ok("Popup can be shown again and closed; mini timer closes");

  // Abandon from the panel: nothing recorded, back to idle
  await waitFor(() => js("return !!document.querySelector('.focus-panel.is-running')"), "break running");
  await click('button[aria-label="Abandon"]');
  await click('.abandon-confirm .btn-danger');
  await waitFor(() => js("return !document.querySelector('.focus-panel.is-running')"), "timer idle after abandon");
  ok("Abandon discards the running break in the real app");

  const errs = await js("return window.__errors || []");
  if (errs.length) throw new Error(errs.join("\n"));
  console.log(`\nAll ${step} desktop steps passed.`);
} catch (e) {
  console.error(e.message);
  await screenshot("desktop-failure").catch(() => {});
  process.exitCode = 1;
} finally {
  if (sid) await wd("DELETE", `/session/${sid}`).catch(() => {});
  driver.kill();
}
