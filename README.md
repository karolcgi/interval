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

## Run it on Windows 11

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

### Build the installer

```powershell
npm run app:build
```

Output:

- `src-tauri\target\release\bundle\nsis\Interval_0.1.0_x64-setup.exe` (recommended, per-user install, no admin)
- `src-tauri\target\release\bundle\msi\Interval_0.1.0_x64_en-US.msi`

Run the setup file. Interval appears in the Start menu. The installer is unsigned, so SmartScreen will warn
the first time ("More info" › "Run anyway"). Code signing can be added later.

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

- **Plan**: drag on the left (Plan) lane. Press a category's number key, or type to filter and Enter.
  Type `stu, Houdini VEX` to pick Studying and title it in one go. Double-click creates a default-length block.
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
