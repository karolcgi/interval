# Interval

A local-first Windows desktop app for **time blocking, time tracking and long-term time analytics**.
Not a task manager: tasks and projects stay in Obsidian. Interval answers four questions:

1. How do I intend to spend my time today? (the **Plan** lane)
2. How am I actually spending it? (the **Actual** lane and the timer)
3. How has my time been distributed over longer periods? (Statistics)
4. Am I consistently investing in what matters? (Phase 2/3: budgets, progression)

No account, no network, no cloud. Your data is one SQLite file you own.

---

## Phase 1 status

| Area | State |
|---|---|
| Local SQLite database, migrations, daily rolling backups | ✅ |
| App shell: sidebar (nav, mini calendar, categories, today total), workspace, collapsible details panel | ✅ |
| Today / Day / Week / Month views, prev/next, date picker, Today button | ✅ |
| Drag to create, move (across days in Week), resize either edge, Alt-drag to copy | ✅ |
| Duplicate, split, merge, copy/paste between days, skip, delete, right-click menu | ✅ |
| Undo / redo for all calendar edits | ✅ |
| Snapping 5/10/15/30, zoom (buttons or Ctrl + wheel), configurable visible hours | ✅ |
| Editable categories (colour, order, parent, shortcut key, break flag, archive) and tags | ✅ |
| Planned vs actual: block states, one-click start, manual confirm, separate Actual lane | ✅ |
| Stopwatch timer: start from a block or unscheduled, pause/resume, change category/tags while running, crash-safe, sleep detection | ✅ |
| Statistics: 11 date ranges + custom, category & tag filters, grouping, stacked bars, distribution, hour/weekday charts, drill-down, previous-period comparison | ✅ |
| Dark/light/system themes, accent colour, compact density | ✅ |
| Export JSON (full) and CSV (time entries); import both | ✅ |
| Command palette with history search (Ctrl K) | ✅ |
| Demo data in a separate database | ✅ |

Phase 2 (budgets, Pomodoro/Flowtime, recurrence, templates, daily review, heatmaps, tray timer controls)
and Phase 3 (progression, achievements, Obsidian Markdown export) are planned. Their tables already exist in
the schema. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#roadmap-notes).

---

## Install (normal use)

1. Open the repository's **Releases** page on GitHub and download `Interval_<version>_x64-setup.exe`.
2. Run it once. It installs per-user (no admin). SmartScreen may warn because the installer isn't code-signed:
   "More info" › "Run anyway".

**Updates are automatic from then on.** Interval checks GitHub at startup and every 6 hours. When a new version
exists, an "Update available" card appears in the sidebar; "Install and restart" downloads it, verifies its
signature and replaces the program files. Your data folder is never touched, and a running timer survives the
restart because it lives in the database. Settings › Updates › Check now forces a check.

## Releasing a new version

```powershell
npm run release -- 0.2.0
```

This bumps the version, commits, tags `v0.2.0` and pushes. GitHub Actions (`.github/workflows/release.yml`) runs the
tests, builds the Windows installer, signs the update and publishes a release with `latest.json`. Installed copies
offer the update within a few hours (or immediately via Check now). No local Windows build is needed.

Without tag-push rights (e.g. a coding agent): bump `version` in `package.json`, push to `main`, then run the
**Release** workflow manually (Actions › Release › Run workflow, or `gh workflow run release.yml`). It tags
`v<version>` itself.

**Update signing key.** Updates are signed with a private key stored as the repository secrets
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The matching public key is in
`src-tauri/tauri.conf.json`. Keep a backup of the key file and password in a password manager. If the key is lost,
already-installed copies can't verify new updates and you'd have to reinstall once manually from a release built with
a new key. Never commit the key.

## Build it yourself on Windows 11 (optional)

### One-time setup

1. **Node.js 20+** (LTS): https://nodejs.org
2. **Rust** via rustup: https://rustup.rs (choose the default MSVC toolchain)
3. **Microsoft C++ Build Tools**: https://visualstudio.microsoft.com/visual-cpp-build-tools/
   (workload "Desktop development with C++")
4. WebView2 is already part of Windows 11.

Full prerequisites: https://v2.tauri.app/start/prerequisites/

### Develop

```powershell
cd interval
npm install
npm run app:dev        # opens the desktop app with hot reload
```

`npm run dev` alone serves the UI in a browser at http://localhost:1420. In a browser it stores data in
IndexedDB, which is handy for UI work, but use the desktop app for real records.

### Build the installer locally

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content path\to\interval-updater.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password>"
npm run app:build
```

Output: `src-tauri\target\release\bundle\nsis\Interval_<version>_x64-setup.exe`. (Signing variables are needed
because the build also produces the signed update package. Normally CI does this.)

### Tests

```powershell
npm test               # 48 unit + integration tests (domain logic and real SQLite)
npx playwright install chromium   # once
npm run e2e            # the full Phase 1 acceptance workflow, driven through the UI
npm run typecheck
```

---

## Where your data lives

| | Path |
|---|---|
| Database | `%APPDATA%\app.interval.desktop\interval.db` (change it in Settings › Data folder) |
| Daily backups | `<data folder>\backups\interval-YYYY-MM-DD.db` (last 14 kept) |
| Demo database | `<data folder>\interval-demo.db` (never mixed with your records) |

The database is plain SQLite: open it with any SQLite tool. Export from Settings › Data:

- **JSON**: complete and lossless (categories, tags, plans, sessions, notes, settings). Re-importable.
- **CSV**: one row per planned block and per recorded session, with local times and UTC offsets.

To move to a new machine: copy `interval.db` (or import a JSON export).

---

## Using it

- **Plan**: drag on the left (Plan) lane. Type a name, press Enter, then press a category's number key
  (or type to filter and Enter). No name? Just press Enter first; the block shows its category name.
  Alt + number picks the category straight from the name field. Double-click empty space creates a default-length block.
- **Rename**: double-click a block, press **F2**, or right-click › Rename. Enter saves, Esc cancels.
- **Colour** always comes from the category. Change a category's colour and every block and session follows.
- **Track**: hover a block and press ▶, or select it and press **S**. Stop with **S** or the floating timer.
  The original plan is preserved; the recorded session appears in the Actual lane.
- **Confirm without a timer**: hover a past block and press ✓ (or **C**). This records the planned time as actual.
- **Log after the fact**: drag in the Actual lane.
- **Edit**: drag to move, drag edges to resize, Alt-drag to copy, right-click for everything else.
  Details (title, tags, link, notes, times) are in the right panel. Links like `obsidian://open?vault=…`
  open Obsidian directly.
- **Review**: Statistics. Click a bar or a category to see the underlying entries; click an entry to jump to it.

Keyboard reference: Settings › Keyboard, or Ctrl K.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): stack, data model, time & overlap policies, code map, decisions
- [docs/DESIGN.md](docs/DESIGN.md): design system and interaction principles
