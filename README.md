# Interval

A local-first Windows desktop app for **time blocking, time tracking and long-term time analytics**.
Not a task manager: tasks and projects stay in Obsidian. Interval answers four questions:

1. How do I intend to spend my time today? (the **Plan** lane)
2. How am I actually spending it? (the **Actual** lane and the timer)
3. How has my time been distributed over longer periods? (Statistics)
4. Am I consistently investing in what matters? (budgets, heatmap, daily review)

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

## Phase 2 status

| Area | State |
|---|---|
| Name every block, category picked separately; colour always follows the category | ✅ |
| Recurring blocks (daily, weekdays, weekly on chosen days, every N weeks, monthly), edit this or this-and-following, stop repeating | ✅ |
| Day templates: save a day, apply to any day (undoable), replace, rename | ✅ |
| Pomodoro (presets + custom), Flowtime (break suggested from focus length), focus mode (F), break reminders, system notifications | ✅ |
| Tray timer: status in the tray tooltip and menu, start/stop/Pomodoro/Flowtime from the tray, optional close to tray | ✅ |
| Time budgets: minimum targets and maximum limits per category or tag, daily/weekly/monthly/yearly/lifetime, history | ✅ |
| Morning planning and evening review | ✅ |
| Day log: automatic Markdown timeline of recorded time, browsable by day, copy or save as .md | ✅ |
| Analytics: 12-month heatmap, planned vs recorded, cumulative hours | ✅ |
| Automatic daily backups to a folder you choose, configurable retention, Back up now | ✅ |

## Phase 3 status

| Area | State |
|---|---|
| Progress: lifetime hours per skill (tag) and area (category), levels on a configurable milestone ladder, hours to next milestone | ✅ |
| Weekly consistency streaks (weeks, so rest days never break them), last-12-weeks strip | ✅ |
| Achievements: hour milestones, 4/8/12/26/52-week streaks, intentional-hours milestones (capped at a working day per day), deep work sessions, balanced weeks | ✅ |
| Personal achievements you confirm by hand, optionally tied to a skill | ✅ |
| Records: longest session, longest weekly streak, best week per top skill (no daily high scores) | ✅ |
| Reviews: weekly and monthly summaries compared with the previous period or the same period a year ago | ✅ |
| Year in review: totals, months, every day of the year, skills gained, milestones | ✅ |
| Obsidian: day logs and summaries written into a vault folder with Dataview frontmatter; never overwrites notes it didn't write | ✅ |
| Rebindable keyboard shortcuts | ✅ |
| Block properties open beside the day panel instead of replacing it | ✅ |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#roadmap-notes).

---

## Focus timer (v0.4) status

| Area | State |
|---|---|
| Docked Focus timer panel under Activities: Pomodoro / Stopwatch / Flowtime, big clock, phase, progress bar, cycle dots, 25/50/90 presets, start/pause/resume/stop/reset, skip, +5/+10 | ✅ |
| One timer engine shared by every window, persisted timestamps; survives minimize, sleep, restart and crashes without double-counting | ✅ |
| Auto-start breaks and auto-start focus (independent), short/long breaks, cycles | ✅ |
| Calendar: start offers the current or next planned block (category + tags inherited), unlink/relink, several rounds per block, runs past the block end | ✅ |
| Floating mini timer window (standard + compact), always on top, opacity, click-through, remembered position, auto on minimize, hides over fullscreen apps, double-click restores Interval | ✅ |
| Tray: live tooltip, start/pause/resume, stop, skip break, floating timer, click-through, restore, exit; minimize/close to tray | ✅ |
| Completion: silent / sound + Windows notification / sound + small popup that never steals focus (Start break, +5 focus, Finish…) | ✅ |
| Original sounds for focus start/end, break start/end and cycle end; master + per-sound volume, preview, custom files | ✅ |
| System-wide shortcuts (start/pause, floating timer, click-through) | ✅ |
| Statistics › Focus timer: focused time, sessions, average, cycles, break time, by category/tag, by day/week/month/year | ✅ |

## v0.5 status

| Area | State |
|---|---|
| Abandon: discard the running session (or break) so nothing is recorded, with a confirm step; from the panel or the floating timer | ✅ |
| Floating timer edit view: name the session, pick a category, pick the length (15/25/50/90 or custom), start; keep-on-top toggle; open Interval | ✅ |
| Closing the main window keeps Interval in the tray (on by default); the floating timer stays up; tray › Exit Interval quits | ✅ |
| Settings split into tabs (General, Calendar, Focus timer, Alerts & sounds, Floating timer & tray, Obsidian, Data & updates, Keyboard) | ✅ |
| 28 category colours (16 new) | ✅ |
| Emoji icons: per category (shown in place of the colour dot), and in front of block/session names (inspector, floating timer) | ✅ |
| Left sidebar resizable by dragging its edge (180–440 px), remembered; double-click resets | ✅ |

## v0.6 status (creative diary, first part)

| Area | State |
|---|---|
| Diary notes: Note, Learning, Idea, Accomplishment, Milestone; stored with the session (and its block) they belong to; included in JSON export/import | ✅ |
| "What did you get done?" on the completion popup and in the timer panel during the break (optional, Settings › Focus timer) | ✅ |
| Details panel › Diary: add, retype, edit and delete notes on any recorded session or planned block | ✅ |
| Quick Capture, daily journal Markdown, journal workspace, Obsidian daily-note sync, notes in reviews | parked (Karol, 2026-11-25) |

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

**Preview builds** (to test a branch before releasing): run the Release workflow on that branch with *preview* ticked.
It publishes a GitHub pre-release `v<version>-preview.<run>`. Installed copies never auto-update to a preview, and the
final `v<version>` is newer than any of its previews, so it still arrives as a normal update.

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
npm test               # 82 unit + integration tests (domain logic and real SQLite)
npx playwright install chromium   # once
npm run e2e            # Phase 1 acceptance + Phase 2 + Phase 3 workflows, driven through the UI
npm run typecheck
```

---

## Where your data lives

| | Path |
|---|---|
| Database | `%APPDATA%\app.interval.desktop\interval.db` (change it in Settings › Data folder) |
| Daily backups | `<data folder>\backups\interval-YYYY-MM-DD.db` by default, or the folder set in Settings › Data (last 30 kept by default) |
| Demo database | `<data folder>\interval-demo.db` (never mixed with your records) |

The database is plain SQLite: open it with any SQLite tool. Export from Settings › Data:

- **JSON**: complete and lossless (categories, tags, plans, sessions, notes, settings, recurring rules, templates, budgets). Re-importable.
- **CSV**: one row per planned block and per recorded session, with local times and UTC offsets.

To move to a new machine: copy `interval.db` (or import a JSON export).

---

## Using it

- **Plan**: click an empty slot in the left (Plan) lane for a default-length block, or drag to set its length.
  Type a name straight away, press Enter, then press a category's number key (or type to filter and Enter).
  No name? Just press Enter first; the block shows its category name. Alt + number picks the category
  straight from the name field. If a block is selected, the first click only clears the selection.
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

- **Repeat**: select a block, Details › Repeat. Change an occurrence, then "Apply changes to following" to move the
  rest of the series. Deleting one occurrence never brings it back.
- **Templates**: the template button in the calendar header saves the current day or applies a saved one.
- **Focus**: the ▾ next to Start offers Pomodoro presets and Flowtime. **F** toggles focus mode. Breaks are recorded
  in your break category, so they show up honestly in statistics.
- **Budgets**: sidebar › Time budgets. "At least 7 h Studying a week", "at most 1 h of Admin a day". Progress counts recorded time;
  planned time still ahead shows whether you're on track.
- **Day log**: sidebar › Day log. An automatic diary of what you actually recorded (time, name, category), one line
  per activity. Browse any past day, copy it as Markdown, or save it as `YYYY-MM-DD.md` (Obsidian's daily-note name);
  a whole week or month saves as one file. The details panel shows the selected day's log too.
- **Daily ritual**: the details panel suggests planning in the morning and a review in the evening (turn it off in Settings).

- **Progress**: sidebar › Progress (or **P**). Every tag is a skill and every category an area. Hide the ones that
  aren't skills (client names, say) with the eye icon. Add personal achievements at the bottom.
- **Reviews**: sidebar › Reviews (or **R**). Last week by default; switch to Month or Year in review, and compare with the
  previous period or a year ago. Copy as Markdown or save to Obsidian.
- **Obsidian**: Settings › Obsidian › Notes folder, pick a folder inside your vault (e.g. `Vault/Interval`). Interval writes
  `Days/2026-11-25.md`, `Weeks/2026-W48.md`, `Months/2026-11.md`, `Years/2026.md`, each with hours in the frontmatter
  (`total_hours`, `hours_<category>`) for Dataview. Turn on *Write automatically* to get each finished day and each
  finished week without clicking anything. A file that Interval didn't write is never overwritten.

Keyboard reference and rebinding: Settings › Keyboard, or Ctrl K.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): stack, data model, time & overlap policies, code map, decisions
- [docs/DESIGN.md](docs/DESIGN.md): design system and interaction principles
