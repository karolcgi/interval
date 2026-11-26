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
    recurrence.ts  RRULE subset: parse/format, occurrences, presets
    focus.ts       Pomodoro/Flowtime state machine (pure)
    budgets.ts     budget periods, progress, history
    analytics.ts   heatmap days, active-day runs
    daylog.ts      day log entries + Markdown (with optional frontmatter)
    progression.ts ledger of per-day hours per tag/category, milestones, weekly streaks, achievements
    summary.ts     week/month/year summaries, comparisons, Markdown with Dataview frontmatter
    format.ts csv.ts
  db/
    driver.ts sqljs-driver.ts tauri-driver.ts
    migrations.ts  append-only schema migrations
    repo.ts        row mapping + statement builders
    io.ts          JSON/CSV export & import
    fixtures.ts    demo data generator (demo database only)
  state/
    store.ts       app state + hooks
    actions.ts     every user action; undo/redo; timer; sleep detection; backups
    planning.ts    recurrence materialisation, this-and-following edits, day templates
    focus.ts       focus engine: tickFocus(now), phase transitions, break sessions
    lifetime.ts    all-time sessions + derived ledger/achievements (hooks)
    obsidian.ts    vault export (manual + automatic)
    shortcuts.ts   rebindable shortcut registry
  ui/              React components (Timeline.tsx is the core interaction surface)
  bootstrap.ts     picks driver, migrates, seeds, loads
  platform.ts      file dialogs, external links, boot prefs (Tauri vs browser)
src-tauri/         Rust shell: db.rs (SQLite), lib.rs (plugins, tray, commands)
e2e/acceptance.mjs Phase 1 acceptance workflow in a real browser
e2e/phase2.mjs     Phase 2 workflow: recurrence, templates, Pomodoro, Flowtime, budgets, planning/review
e2e/phase3.mjs     Phase 3 workflow on demo data: progress, achievements, reviews, year in review, shortcuts
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
- `e2e/phase2.mjs`: recurrence (incl. deleted-stays-deleted across reload), templates with undo, Pomodoro and Flowtime
  under a fake clock, budgets, morning planning and evening review.
- `e2e/phase3.mjs`: progress and achievements on demo data, personal achievement, hiding a skill, weekly review vs
  last week / a year ago with Markdown frontmatter, month and year in review, shortcut rebinding with conflicts.

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

## Phase 2 design notes

- **Migration v2** adds `recurrence_rules.materialized_until`, `templates.sort_order`, `daily_notes.planned_at/reviewed_at`
  and an index on `blocks.recurrence_id`. Migrations stay append-only.
- **Recurrence**: a rule is an RRULE subset (`FREQ=DAILY|WEEKLY|MONTHLY`, `INTERVAL`, `BYDAY`, `UNTIL`). Occurrences are
  materialised forward (at least 14 days past today, or to the end of the visible range) as normal blocks carrying
  `recurrence_id`, so every calendar operation, undo and statistic works unchanged. `materialized_until` records how far
  a rule has been expanded, so a deleted occurrence is never regenerated. "This and following" ends the old rule the day
  before and starts a new rule from the edited block; past occurrences are never touched.
- **Templates** store blocks as minutes-from-midnight; applying one is a single undoable batch.
- **Focus engine**: `tickFocus(now)` runs every second and is idempotent. It derives everything from stored phase start/end
  times, so it catches up correctly after sleep and closes a phase at its exact planned end, not when the tick happens.
  Focus state is persisted in settings (`timer.focus`), so a crash or restart resumes the cycle. Break phases are real
  sessions in the break category.
- **Budgets** are never stored as progress: `budgetProgress` recomputes from sessions via `computeStats`. Tag budgets
  count each session once. Break time counts only toward a budget that targets the break category.
- **Tray**: the webview sends a coarse state (only when the displayed minute changes) via `set_tray_state`; the tray menu
  emits `tray-action` events back. Close-to-tray is a Rust-side flag set from settings.
- **Backups**: `db_backup_daily(keep, dir?, force?)` uses SQLite's online backup API into
  `<dir>/<name>-YYYY-MM-DD.db`, once per day, pruning to the newest `keep`. Runs at startup; "Back up now" forces it.

## Phase 3 design notes

- **Nothing about progress is stored.** `buildLedger` resolves overlaps across all sessions once, splits them by local
  day and accumulates per tag, per category (a subcategory's time also counts for every ancestor) and for all
  non-break time. Milestones, levels, streaks, records and achievements are pure functions of that ledger, so editing
  or deleting old sessions re-derives everything consistently. The `milestones` table from v1 stays unused.
- **Healthy by construction**: streaks are weekly (1h+ in a week; the running week never breaks a streak), intentional
  hours count at most `workdayHours` per day, there are no daily maximum records, and "balanced weeks" reward 3+ active
  days with no day past the working day.
- **Migration v3** adds `achievements` (personal achievements confirmed by hand). Included in JSON export/import.
- **Obsidian**: Rust command `write_vault_file(dir, rel, contents)` creates folders, rejects `..`/absolute paths and
  refuses to replace any file without the `generator: interval` marker. Automatic export keeps a cursor in the
  `obsidian.auto` setting so each day/week is written once (user edits to generated notes survive).
- **Shortcuts**: `settings.shortcuts` holds overrides only (`action -> combo`); a combo maps to one action. Ctrl
  shortcuts, arrows, Esc and Delete are reserved.
- **Right area**: `RightPanel` renders `[properties][day overview]`; the shell's third grid column is `auto`, so the
  timeline gives up room when a block is selected instead of being overlaid.

## Focus timer design notes (v0.4)

- **One engine, many views.** `src/state/focus.ts` is the only timer. It runs in the main window; the floating mini
  timer (`?window=mini`), the completion popup (`?window=popup`) and the tray render a `TimerSnapshot`
  (`domain/focus.ts › snapshotOf`) and send commands back (`timerBus.ts`: Tauri events, or a BroadcastChannel in the
  browser). Commands carry the snapshot's `rev`; a stale command (two windows clicking at once) is dropped.
- **Time is timestamps, not ticks.** A phase stores `segStart`, `activeMs` and `phaseMs`; the deadline is derived. Pausing
  closes the segment, so paused time is never recorded. `tick()` catches up on any number of missed transitions at their
  exact deadlines (deterministic, no duplicates). If the app was asleep or closed longer than 5 min (heartbeat in
  `timer.heartbeat`), a focus phase is paused at the last moment we were alive, and a break ends without auto-starting focus.
- **Atomic transitions.** Each transition is one DB batch: session rows, block status, the `focus_runs` row and the
  persisted timer state. Engine operations are serialized (`serial()`), so tray, shortcut, popup and tick can't interleave.
- **Recording.** Focus time is a normal session (mode `pomodoro`/`flowtime`/`stopwatch`), so the overlap policy, stats,
  budgets and progression apply unchanged. Breaks become sessions in the break category only when "Record breaks" is on;
  `focus_runs` (migration v4) keeps one row per phase either way for focus history (completed/skipped/stopped, cycles).
  `extendCompleted` (popup "+5 min focus") withdraws an auto-started break and continues the same run and session.
- **Shell (`src-tauri/src/shell.rs`).** Caches the last snapshot, emits `timer-wake` at the next deadline / every 20 s /
  after system sleep (WebView timers are throttled when minimized), updates the tray tooltip each second, owns the
  mini/popup windows (created hidden, shown with `SW_SHOWNOACTIVATE` so they never take focus), saves the mini position,
  and on Windows checks whether the foreground window covers its monitor (fullscreen) to hide the mini timer and hold the popup.
  All windows share one WebView2 environment, so every window must use the same `additionalBrowserArgs`.
- **Windows are never built on the main thread.** On Windows, building a WebView2 window from a synchronous command or
  a menu/window-event handler deadlocks (wry#583). `mini_show`/`popup_show` are async commands and shell-side opens go
  through `spawn_window`. A still-open popup is reloaded rather than destroyed and rebuilt under the same label.
- **Sounds play through Web Audio** (fetch + `decodeAudioData`), not `<audio>`, so they don't depend on the webview's
  media pipeline on the app protocol. The context is resumed on the first click/key.
- **Desktop test**: `npm run e2e:desktop` drives the release binary with tauri-driver/WebKitWebDriver (Linux, Xvfb).
- **Sounds** are synthesized by `scripts/make-sounds.mjs` (original, see `public/sounds/LICENSE.txt`). Custom files are
  copied into `<data dir>/sounds` by `import_sound` and read back only from there.

## v0.5 notes

- **Abandon** (`focus.ts › abandon`) deletes the current phase's sessions (all segments since `phaseStart`, across
  pauses), the `focus_runs` row and the running session, and puts a linked block back to planned. Earlier rounds stay.
- **Mini timer commands**: `target` (title/category), `length` (sets `phaseMs` of the running countdown, or the
  Pomodoro focus length when idle), `start` (kind/category/title), `onTop`. The edit view resizes its window through
  `mini_expand`, which keeps the bottom edge in place and clamps to the work area.
- **Category emoji**: migration v5 adds `categories.emoji`. `CatDot` renders the emoji instead of the dot when set.
  Title emoji are plain text at the start of the title (`EmojiPicker.tsx › withLeadingEmoji`), so no schema change.
  The picker is a curated offline set with keyword search.
- **Close to tray** defaults to on (Rust `CLOSE_TO_TRAY` and the setting default agree).

## v0.6 notes (creative diary, first part)

- **Notes** live in `journal_entries` (migration v6): `at`, `kind` (note/learning/idea/accomplishment/milestone),
  `text`, optional `session_id`/`block_id`, `source` (annotation/manual; `capture` reserved for Quick Capture).
  No foreign keys: a note outlives a deleted session. `state/journal.ts` adds/edits/deletes and bumps `journalRev`.
- **Annotation** is a timer command (`{type:"annotate"}`) so the popup window can send it, but it is handled
  before the stale-rev check and never changes the timer. The popup window fits its card via `popup_fit`.
- **Parked** (designs kept in `/mnt/project-files/diary-parked/`): journal Markdown + template, Obsidian daily-note
  managed section (HTML-comment markers, interval_* properties, conflict detection, backups), Quick Capture window.

## v0.7 notes (presets and weekly template)

- **Storage** (migration v7): `activity_presets` (tags as JSON), `week_template_blocks` (weekday 0 = Monday,
  `start_minute`, `duration_minutes`, category, title, notes, tags, `preset_id`), `template_dismissals (day, template_block_id)`,
  and `blocks.preset_id` / `blocks.template_block_id`. No foreign keys: copies are independent and nothing cascades.
- **Three layers**: suggestions are computed at render time (`domain/weekTemplate.ts › suggestionsForDay`) and never
  written, so statistics, budgets and progress (which read only `blocks` and `sessions`) can't count them. A confirmed
  suggestion is a normal planned block whose `template_block_id` hides that suggestion on its date, wherever the block moves.
  Past days get no suggestions unless `templateOnPast`.
- **Template editor** reuses `Timeline` with `mode="template"`: template blocks are drawn as Blocks on a fixed reference
  week (Mon 1 – Sun 7 Jan 2024) and converted back with `fromRefInterval`. Edits are `commit` changes of type `tblock`,
  so undo/redo is shared with the calendar. Selection is separate (`tplSelection`).
- **Preset drag** is pointer-driven (`ui/presetDrag.ts`): the desktop webview keeps native drag-and-drop for files.
  Timelines and preset lists register drop targets; the timeline renders the preview with the normal snap.
- **Navigation**: `TopBar` (Today = calendar in day mode, Calendar = week/month). Sidebar sections collapse via
  `settings.sidebarCollapsed`.

## v0.8 notes (icons, colours, quick notes)

- Icons are Lucide names stored as text (`categories.icon`, `activity_presets.icon`, `blocks.icon`, `week_template_blocks.icon`, `recurrence_rules.icon`). `src/ui/icons.tsx` is the curated, statically imported set (keeps the bundle small); an unknown name renders as the colour dot. Migration v8 maps the v0.5 `categories.emoji` to icons via `domain/iconMap.ts` and leaves the `emoji` column unused.
- Own colour (`color`, null = the category's) lives on presets and is **copied** onto blocks, template blocks and recurrence rules, like every other preset field. `lookOf(item, category)` in `ui/bits.tsx` resolves colour and icon for drawing. Recorded sessions keep the category colour (actual time is always by category).
- Quick notes from the floating timer are a `note` timer command; the main window saves a `journal_entries` row with `source = 'capture'`, linked to the running session. `buildDayLog` takes the day's journal entries and lists capture notes by time (`dayLogItems`).

## v0.9 notes (template overlay, mini timer scale)

- **Template = overlay only.** `library.daySuggestions` calls `suggestionsForDay` with no blocks and no dismissals, so every
  template block of the weekday shows, whatever is planned; confirm / apply / dismiss / restore are gone from the UI and
  `library.ts`. `template_dismissals` and `blocks.template_block_id` stay in the schema (old data is harmless). In
  `Timeline`, ghosts render first in the Plan lane with a fixed full-width layout, outside `layoutColumns`, with
  `pointer-events: none`, so real blocks sit on top.
- **Template blocks have no category** (`category_id = ''`, column kept NOT NULL). Migration v9 copies each block's category
  colour, icon and name (where the block had none of its own) and then clears `category_id`. Drawing in the template creates a
  block with the next `TEMPLATE_COLORS` colour and opens rename; dropped presets and pasted blocks bring their look and name.
- **Day log notes**: `buildDayLog` lists every journal entry of the day (capture and end-of-round annotations), with kind and
  source; the Markdown line is `- HH:MM *Kind:* text`.
- **Mini timer at 125%**: `html[data-window="mini"] #root { zoom: 1.25 }` scales everything; `shell.rs › mini_size` is
  360×173 (compact 235×50) and the expanded edit view is at least 360 wide. The edit view's fit measures
  `getBoundingClientRect()` (visual pixels, zoom included).
- **Right panel width** is `settings.rightPanelWidth` → `--panel-w` on `.shell` (each panel in `.panel-area`), set by
  `PanelResizer` in `RightPanel.tsx`.
- "Today's time" and "Planned vs actual" are `ui/DayTimeSummary.tsx`, rendered at the bottom of the left sidebar for the
  focused day.

## Roadmap notes

Next (not started; needs Karol's guidance): read-only TaskNotes integration from the Obsidian vault.
Spec "possible future enhancements": activity detection, calendar sync, ActivityWatch import.
