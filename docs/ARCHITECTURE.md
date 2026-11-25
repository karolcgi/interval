# Interval architecture

This document is for the next developer or coding agent. Read it before changing data handling.

## 1. Stack and why

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri 2** (Rust + WebView2) | ~10 MB installer, fast cold start, native tray/dialogs, no bundled Chromium. Electron would cost ~150 MB and more RAM for no benefit here. |
| UI | **React 19 + TypeScript**, plain CSS with design tokens | Mature, fast enough for a single-user calendar. No UI kit: the visual identity is custom and kits fight it. |
| State | Tiny external store (`src/state/store.ts`) + `useSyncExternalStore` | Zero dependencies, explicit data flow. |
| Storage | **SQLite** owned by Rust (`rusqlite`, bundled SQLite, WAL) | Reliable, inspectable, a single file the user owns. |
| Tests | Vitest (domain + real SQLite via sql.js), Playwright (end-to-end) | The same SQL runs in tests and in the app. |

Runtime dependencies are deliberately few: `react`, `react-dom`, `lucide-react` (icons), `@fontsource-variable/inter`
(bundled font, works offline), `sql.js` (browser preview/tests only), and the Tauri dialog/opener plugins.
Charts are hand-written SVG.

### Storage driver abstraction

`src/db/driver.ts` defines `DbDriver { select, batch }`. Two implementations:

- `TauriDriver` → Rust commands in `src-tauri/src/db.rs` (`db_open`, `db_select`, `db_batch`, `db_backup_daily`, …).
  Rust holds one connection behind a mutex; `db_batch` runs every statement in one transaction.
- `SqlJsDriver` → SQLite compiled to WASM. Used by unit tests (in memory) and by the browser preview (IndexedDB).

All SQL uses positional `?` parameters and plain SQLite syntax, so it is portable between the two.

**Rule: every write is a batch.** A user action produces a list of statements that is applied atomically.

## 2. Code map

```
src/
  domain/          pure logic, no I/O, fully unit-tested
    types.ts       entities + default settings
    time.ts        local-day math, DST-safe day/week/month helpers, named ranges
    overlap.ts     overlap resolution policy (see §4)
    stats.ts       statistics engine (all analytics derive from raw sessions)
    calendar.ts    snapping, drag→interval, move, resize, split, merge, column layout
    format.ts csv.ts
  db/
    driver.ts sqljs-driver.ts tauri-driver.ts
    migrations.ts  append-only schema migrations
    repo.ts        row mapping + statement builders
    io.ts          JSON/CSV export & import
    fixtures.ts    demo data generator (demo database only)
  state/
    store.ts       app state + hooks
    actions.ts     every user action; undo/redo; timer; sleep detection
  ui/              React components (Timeline.tsx is the core interaction surface)
  bootstrap.ts     picks driver, migrates, seeds, loads
  platform.ts      file dialogs, external links, boot prefs (Tauri vs browser)
src-tauri/         Rust shell: db.rs (SQLite), lib.rs (plugins, tray, commands)
e2e/acceptance.mjs Phase 1 acceptance workflow in a real browser
```

## 3. Data model

All timestamps are **UTC epoch milliseconds** (`INTEGER`). Every block and session also stores `tz`, the IANA zone
at creation time, so history remains interpretable after travel.

| Table | Purpose | Notes |
|---|---|---|
| `categories` | Purpose of time (Studying) | `parent_id` for subcategories, `sort_order`, `shortcut`, `is_break`, `archived_at` (never hard-deleted once used) |
| `tags` | Subject of time (Houdini) | Unique by name, case-insensitive |
| `blocks` | **Planned** time blocks | `status ∈ planned, in_progress, completed, skipped`, optional `title` (the block's name; UI falls back to the category name), `notes/link`, `recurrence_id`. **No colour column**: colour is always the category's. |
| `block_tags` | Block ↔ tag | |
| `sessions` | **Actual** recorded time | `end_at NULL` = running; `block_id` optional link to the plan; `mode ∈ manual, stopwatch, pomodoro, flowtime` |
| `session_tags` | Session ↔ tag | |
| `daily_notes` | Intention + reflection per local date | |
| `settings` | Key → JSON value | UI prefs and timer state (`timer.paused`, `timer.heartbeat`, `timer.accumulated`) |
| `budgets`, `recurrence_rules`, `templates`, `template_blocks`, `milestones` | Phase 2/3 | Created now so the model is stable |
| `schema_migrations` | Applied migration versions | |

Invariants enforced **by the database**:

- At most one running session: `UNIQUE INDEX … ON sessions((end_at IS NULL)) WHERE end_at IS NULL`.
- `blocks.end_at > start_at`, `sessions.end_at >= start_at`.
- Foreign keys on; deleting a block sets `sessions.block_id` to NULL (recorded time is never deleted with a plan).

Migrations (`src/db/migrations.ts`) are append-only; each runs in one transaction with its bookkeeping row.

## 4. Time policies

**Plan vs actual.** Blocks are intentions; sessions are reality. Only sessions count as recorded time.
Future, planned and skipped blocks never count as completed activity. Starting a block creates a session linked
to it and marks the block `in_progress`; stopping marks it `completed` and leaves the block's own times untouched
(the 90-minute plan and the 70-minute reality coexist). "Confirm" on a past block creates a `manual` session equal
to the plan.

**Day boundaries and DST.** Durations are absolute (UTC difference), so a session over the spring-forward night
counts real elapsed time. Day, week and month boundaries are *local* midnights computed through the JS Date local API
(`addDays` builds `new Date(y, m, d + n)`, never `t + 24h`). Sessions crossing midnight are split per local day
(`splitByDay`). The timeline positions items by wall-clock minute. On the 25-hour day, 02:00–03:00 occurs twice and
both instances map to the same rows; durations stay correct. Statistics use the zone the app runs in now.

**Overlapping actual sessions.** Wall-clock time is spent once. Overlaps are resolved before aggregation:
the overlapping portion goes to the session that **started most recently** (you switched to it); ties are broken by
`created_at`, then id. The resulting segments never overlap, so totals can never exceed real elapsed time.
Filters (category/tag) are applied *after* resolution. Planned blocks use the same resolution for planned totals.
The UI still shows overlapping items side by side so the user can fix them.

**Tags.** A session with several tags counts its full duration toward each tag, but only once toward the total and
its category. Tag totals are therefore not additive and are never summed in the UI.

**Breaks.** Categories flagged `is_break` are reported separately ("Breaks") and excluded from "Recorded".

**Running session.** Counts up to `now`. The running session is a row in the database from the moment it starts, so
a crash or forced quit loses nothing. A heartbeat is written every 30 s. If the gap between heartbeats exceeds
5 minutes (sleep) or the app starts with a stale heartbeat (closed for > 10 min while running), the user chooses:
keep the time, remove the gap (the session is split around it), or stop at the last heartbeat.

**Pause.** Pausing closes the current session; resuming starts a new linked session. Sessions are always true
intervals, which keeps statistics simple and honest.

## 5. Undo / redo

`actions.commit(label, changes)` records `{before, after}` row snapshots for blocks and sessions, applies `after`
in one batch and pushes the entry. Undo applies `before`. Ordering inside a batch respects foreign keys and the
single-running-session index. Timer start/stop/pause are intentionally *not* undoable (they reflect real time).
Category/tag/settings edits are not part of the calendar history.

## 6. Demo data

`Settings › Demo data` switches to a separate database (`interval-demo.db`, or IndexedDB key `interval-demo`)
filled by `fixtures.ts` with ~14 months of realistic plans and sessions. The real database is never opened in demo
mode. The `?demo=1` / `?db=<key>` URL parameters exist for browser preview and tests.

## 7. Testing

- `src/domain/domain.test.ts`: DST, midnight splitting, ranges, overlap policy, stats (planned vs actual, tags,
  filters, breaks, running sessions), calendar operations.
- `src/db/db.test.ts`: migrations, persistence across reopen, DB-level constraints, undo/redo of create/move/resize/
  split/merge/duplicate/paste/delete, category archive, timer from block (70 of 90 minutes), crash recovery,
  pause/resume + sleep-gap exclusion, JSON/CSV round trips, fixtures.
- `e2e/acceptance.mjs`: spec §21 end to end with a controlled clock, including reload one week later.

Tests run in `Europe/Warsaw` (set in `src/test/setup.ts`) so DST logic is always exercised.

## 8. Decisions and tradeoffs

- **Rust-owned SQLite instead of `tauri-plugin-sql`.** The plugin uses a connection pool, which makes multi-statement
  transactions unreliable. Owning one connection gives true atomic batches, WAL and online backups in ~200 lines.
- **Statistics computed in TypeScript, not SQL.** Overlap resolution, midnight splitting and DST make SQL aggregation
  error-prone. A decade of heavy use is ~50k sessions, which aggregates in milliseconds. If it ever gets slow, add a
  cache keyed by (range, filter, max(updated_at)); never stored counters.
- **Hard deletes + snapshot undo** instead of soft deletes. Simpler queries; undo restores exact rows.
- **Week view actual lane is narrow and unlabeled.** The day view is where reality is inspected; the week view is for
  planning.
- **Single window, no close-to-tray yet.** Closing quits; a running timer survives because it lives in the database.
  A tray icon with a tooltip exists; tray timer controls are Phase 2.
- **Browser preview uses IndexedDB.** Convenient for UI work, but not a supported place for real records.
- **Installer not Authenticode-signed.** Updates are cryptographically signed (Tauri updater key), but Windows code signing needs a paid certificate; SmartScreen warns once on first install. Add `bundle.windows.certificateThumbprint` or Azure Trusted Signing later.

## 9. Distribution and updates

- `.github/workflows/release.yml` runs on `v*` tags: tests on Ubuntu, then `tauri-action` on `windows-latest` builds the
  NSIS installer, signs the updater artifact with `TAURI_SIGNING_PRIVATE_KEY`, and publishes a GitHub release with
  `latest.json`.
- `tauri-plugin-updater` polls `https://github.com/<owner>/interval/releases/latest/download/latest.json`
  (endpoint in `src-tauri/tauri.conf.json`), verifies the minisign signature against the embedded public key and runs
  the installer in passive mode; `tauri-plugin-process` relaunches. UI: `src/updater.ts`, sidebar card, Settings › Updates.
- The app version comes from `package.json` (`"version": "../package.json"` in tauri.conf). `npm run release -- x.y.z`
  bumps it, tags and pushes.
- The data folder is derived from the bundle identifier `app.interval.desktop`. **Never change the identifier**, or
  updated installs will look for data in a new folder.
- The release repository must be readable without authentication for update checks to work.

## 10. Assumptions

- Week starts Monday by default (Poland); configurable.
- Default visible hours are the full day; zoom and auto-scroll keep the relevant part in view.
- The app runs in one time zone at a time; records keep their creation zone for reference.
- Archiving a category hides it from pickers but keeps all history and statistics.

## Roadmap notes

Phase 2 entry points:

- **Budgets**: table `budgets` exists. Compute progress with `computeStats` filtered by the target.
- **Pomodoro/Flowtime**: `sessions.mode` exists. Implement as timer variants in `actions.ts`; the floating timer
  already shows the active session.
- **Recurrence/templates**: tables exist. Materialise occurrences as normal blocks with `recurrence_id` so all
  calendar operations keep working.
- **Tray timer**: `set_tray_tooltip` exists in `lib.rs`; add menu items that call back into the webview with events.
- **Heatmaps**: `StatsResult.byDay` already has per-day totals.

Phase 3: Markdown export can reuse `computeStats` and `format.ts`; write files with the `write_text_file` command.
