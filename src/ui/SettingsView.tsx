import { useEffect, useState } from "react";
import { Download, FolderOpen, Upload } from "lucide-react";
import { store, useApp } from "../state/store";
import * as A from "../state/actions";
import { exportCsv, exportJson, importCsv, importJson } from "../db/io";
import { comboOf, keyOf, prettyKey, RESERVED, SHORTCUT_ACTIONS } from "../state/shortcuts";
import { bootPrefs, isTauri, openTextFile, pickDirectory, revealDataFolder, saveTextFile } from "../platform";
import { dayKey } from "../domain/time";
import { Segmented } from "./bits";
import { switchDemo } from "../bootstrap";
import { FocusTimerSettings } from "./FocusSettings";

const ACCENTS = ["#d5d3ca", "#8298d7", "#8bbca0", "#ba9ad0", "#77b3bf", "#d49a72", "#e79b8b"];

export async function exportData(kind: "json" | "csv") {
  const db = store.get().db;
  if (!db) return;
  try {
    const stamp = dayKey(Date.now());
    const path =
      kind === "json"
        ? await saveTextFile(`interval-export-${stamp}.json`, JSON.stringify(await exportJson(db), null, 2), "json")
        : await saveTextFile(`interval-time-entries-${stamp}.csv`, await exportCsv(db), "csv");
    if (path) A.toast(`Exported to ${path}`);
  } catch (e) {
    A.reportError(e);
  }
}

const SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "calendar", label: "Calendar" },
  { id: "focus", label: "Focus timer" },
  { id: "alerts", label: "Alerts & sounds" },
  { id: "window", label: "Floating timer & tray" },
  { id: "obsidian", label: "Obsidian" },
  { id: "data", label: "Data & updates" },
  { id: "keyboard", label: "Keyboard" },
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number]["id"];
let lastTab: SettingsTab = "general";

export function SettingsView() {
  const anchor = useApp((x) => x.settingsAnchor);
  const [tab, setTabState] = useState<SettingsTab>(anchor === "focus-timer" ? "focus" : lastTab);
  const setTab = (t: SettingsTab) => {
    lastTab = t;
    setTabState(t);
  };
  useEffect(() => {
    if (anchor === "focus-timer") setTab("focus");
  }, [anchor]);
  const s = useApp((x) => x.settings);
  const storage = useApp((x) => x.storageLabel);
  const demo = useApp((x) => x.demo);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof s>) => void A.updateSettings(patch).catch(A.reportError);

  const doImport = async () => {
    const db = store.get().db;
    if (!db) return;
    const file = await openTextFile(["json", "csv"]);
    if (!file) return;
    setBusy(true);
    try {
      const res = file.name.toLowerCase().endsWith(".csv") ? await importCsv(db, file.text) : await importJson(db, JSON.parse(file.text));
      await A.reloadMeta();
      await A.refresh();
      A.clearHistory();
      A.toast(`Imported ${res.sessions} recorded and ${res.blocks} planned entries`);
    } catch (e) {
      A.reportError(e);
    } finally {
      setBusy(false);
    }
  };

  const changeDataDir = async () => {
    const dir = await pickDirectory();
    if (!dir) return;
    if (!confirmInline(`Use ${dir} as the data folder? Interval will restart and open (or create) the database there. Your current database file is not moved; copy it there first if you want to keep using it.`)) return;
    bootPrefs.dataDir = dir;
    location.reload();
  };

  return (
    <section className="page settings">
      <header className="page-head">
        <div>
          <div className="eyebrow">Preferences</div>
          <h1 className="page-title">Settings</h1>
        </div>
      </header>
      <nav className="settings-tabs" role="tablist" aria-label="Settings sections">
        {SETTINGS_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`settings-tab ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "general" && (
<>
<h2 className="section-title">Appearance</h2>
      <div className="settings-block">
        <Row label="Theme">
          <Segmented value={s.theme} onChange={(theme) => set({ theme })} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "System" }]} />
        </Row>
        <Row label="Accent">
          <div className="accent-row">
            {ACCENTS.map((a) => (
              <button key={a} className={`swatch ${s.accent === a ? "on" : ""}`} style={{ background: a }} onClick={() => set({ accent: a })} aria-label={`Accent ${a}`} />
            ))}
            <label className="swatch custom" title="Custom accent">
              <input type="color" value={s.accent} onChange={(e) => set({ accent: e.target.value })} />
            </label>
          </div>
        </Row>
        <Row label="Density">
          <Segmented value={s.density} onChange={(density) => set({ density })} options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]} />
        </Row>
      </div>

      </>
)}

      {tab === "calendar" && (
<>
<h2 className="section-title">Calendar</h2>
      <div className="settings-block">
        <Row label="Visible hours" hint="Hours outside this range are hidden on the timeline">
          <select className="select sm" value={s.dayStartHour} onChange={(e) => set({ dayStartHour: Math.min(Number(e.target.value), s.dayEndHour - 1) })} aria-label="First hour">
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          <span className="muted">to</span>
          <select className="select sm" value={s.dayEndHour} onChange={(e) => set({ dayEndHour: Math.max(Number(e.target.value), s.dayStartHour + 1) })} aria-label="Last hour">
            {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
              <option key={h} value={h}>
                {String(h % 24).padStart(2, "0")}:00{h === 24 ? " (midnight)" : ""}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Snap to">
          <Segmented value={s.snapMinutes} onChange={(snapMinutes) => set({ snapMinutes })} options={[5, 10, 15, 30].map((m) => ({ value: m as 5 | 10 | 15 | 30, label: `${m} min` }))} />
        </Row>
        <Row label="Default block length" hint="Used for double-click creation">
          <Segmented value={s.defaultBlockMinutes} onChange={(defaultBlockMinutes) => set({ defaultBlockMinutes })} options={[30, 60, 90, 120].map((m) => ({ value: m, label: m < 60 ? `${m}m` : `${m / 60}h` }))} />
        </Row>
        <Row label="Week starts on">
          <Segmented value={s.weekStartsOn} onChange={(weekStartsOn) => set({ weekStartsOn })} options={[{ value: 1 as const, label: "Monday" }, { value: 0 as const, label: "Sunday" }]} />
        </Row>
        <Row label="Time format">
          <Segmented value={s.timeFormat} onChange={(timeFormat) => set({ timeFormat })} options={[{ value: "24h", label: "24-hour" }, { value: "12h", label: "12-hour" }]} />
        </Row>
        <Row label="Show actual lane" hint="Recorded sessions beside the plan">
          <input type="checkbox" checked={s.showActualLane} onChange={(e) => set({ showActualLane: e.target.checked })} />
        </Row>
        <Row label="Template suggestions" hint="Show the weekly template as dimmed suggestions in Today and Calendar">
          <input type="checkbox" checked={s.templateOverlay} onChange={(e) => set({ templateOverlay: e.target.checked })} aria-label="Template suggestions" />
        </Row>
        <Row label="Suggestions on past days" hint="Off by default. Turn on to compare past days with your template.">
          <input type="checkbox" checked={s.templateOnPast} onChange={(e) => set({ templateOnPast: e.target.checked })} aria-label="Suggestions on past days" />
        </Row>
      </div>

      </>
)}

      {tab === "focus" && <FocusTimerSettings part="timer" />}
      {tab === "alerts" && <FocusTimerSettings part="alerts" />}
      {tab === "window" && <FocusTimerSettings part="window" />}

      {tab === "general" && (
<>
<h2 className="section-title">Daily ritual</h2>
      <div className="settings-block">
        <Row label="Suggest planning and review" hint="A quiet prompt in the day panel: plan in the morning, review in the evening. Always optional.">
          <input type="checkbox" checked={s.reviewPrompts} onChange={(e) => set({ reviewPrompts: e.target.checked })} aria-label="Suggest planning and review" />
        </Row>
        <Row label="Working day" hint="Morning planning shows how much of it is still unallocated">
          <NumField label="Working day hours" value={s.workdayHours} min={1} max={16} onChange={(workdayHours) => set({ workdayHours })} suffix="hours" />
        </Row>
      </div>

      </>
)}

      {tab === "data" && (
<>
<h2 className="section-title">Data</h2>
      <div className="settings-block">
        <Row label="Database" hint={isTauri() ? "Local SQLite file." : "Browser preview: stored in this browser’s IndexedDB. Use the desktop app for real records."}>
          <code className="path">{storage}</code>
          {isTauri() && (
            <button className="icon-btn" onClick={() => void revealDataFolder(storage.replace(/^.*?:/, ""))} title="Show in Explorer">
              <FolderOpen size={14} />
            </button>
          )}
        </Row>
        {isTauri() && (
          <Row label="Data folder" hint={bootPrefs.dataDir ? "Custom folder" : "Default app data folder"}>
            <button className="btn btn-outline sm" onClick={() => void changeDataDir()}>
              Change…
            </button>
            {bootPrefs.dataDir && (
              <button className="btn btn-ghost sm" onClick={() => ((bootPrefs.dataDir = null), location.reload())}>
                Use default
              </button>
            )}
          </Row>
        )}
        {isTauri() && (
          <Row label="Automatic backups" hint={`A copy of the database once a day, the newest ${s.backupKeepDays} kept. ${s.backupDir ? "Custom folder." : "Default: a backups folder beside the database."} Point it at a synced folder (Dropbox, OneDrive) for an off-machine copy.`}>
            <code className="path">{s.backupDir ?? "backups/ beside the database"}</code>
            <button className="btn btn-outline sm" onClick={() => void pickDirectory().then((backupDir) => backupDir && set({ backupDir }))}>
              Change…
            </button>
            {s.backupDir && (
              <button className="btn btn-ghost sm" onClick={() => set({ backupDir: null })}>
                Use default
              </button>
            )}
          </Row>
        )}
        {isTauri() && (
          <Row label="Keep backups" hint="Older copies in that folder are deleted">
            <NumField label="Backups to keep" value={s.backupKeepDays} min={1} max={365} onChange={(backupKeepDays) => set({ backupKeepDays })} suffix="days" />
            <button className="btn btn-outline sm" onClick={() => void A.backupNow(true)}>
              Back up now
            </button>
          </Row>
        )}
        <Row label="Export" hint="JSON is a complete backup. CSV is one row per planned or recorded entry.">
          <button className="btn btn-outline sm" onClick={() => void exportData("json")}>
            <Download size={13} /> JSON
          </button>
          <button className="btn btn-outline sm" onClick={() => void exportData("csv")}>
            <Download size={13} /> CSV
          </button>
        </Row>
        <Row label="Import" hint="Merges an Interval JSON or CSV export into this database. Existing entries with the same id are updated.">
          <button className="btn btn-outline sm" onClick={() => void doImport()} disabled={busy}>
            <Upload size={13} /> Import file…
          </button>
        </Row>
        <Row label="Demo data" hint="Opens a separate demo database with 14 months of realistic records. Your real data is never touched.">
          <Segmented value={demo ? "demo" : "real"} onChange={(v) => switchDemo(v === "demo")} options={[{ value: "real", label: "My data" }, { value: "demo", label: "Demo" }]} />
        </Row>
      </div>

      {isTauri() && (
        <>
          <h2 className="section-title">Updates</h2>
          <div className="settings-block">
            <Row label={`Version ${__APP_VERSION__}`} hint="Interval checks for signed updates at startup and every 6 hours. Updates never touch your data folder.">
              <button className="btn btn-outline sm" onClick={() => void import("../updater").then((m) => m.checkForUpdate(true))}>
                Check now
              </button>
            </Row>
          </div>
        </>
      )}

      </>
)}

      {tab === "general" && (
<>
<h2 className="section-title">Progress</h2>
      <div className="settings-block">
        <Row label="Milestone ladder" hint="Lifetime hours at which a skill or area levels up. Comma-separated.">
          <LadderField value={s.milestoneHours} onChange={(milestoneHours) => set({ milestoneHours })} />
        </Row>
      </div>

      </>
)}

      {tab === "obsidian" && (
<>
<h2 className="section-title">Obsidian</h2>
      <div className="settings-block">
        <Row
          label="Notes folder"
          hint={
            isTauri()
              ? "A folder inside your vault. Interval writes Days/YYYY-MM-DD.md, Weeks/YYYY-Www.md, Months/ and Years/ there, with hours in the frontmatter for Dataview. It only ever replaces notes it wrote itself."
              : "Desktop app only. In the browser preview, notes download as files."
          }
        >
          <code className="path">{s.obsidianDir ?? "not set"}</code>
          {isTauri() && (
            <button className="btn btn-outline sm" onClick={() => void pickDirectory().then((obsidianDir) => obsidianDir && set({ obsidianDir }))}>
              Choose…
            </button>
          )}
          {s.obsidianDir && (
            <button className="btn btn-ghost sm" onClick={() => set({ obsidianDir: null, obsidianAuto: false })}>
              Clear
            </button>
          )}
        </Row>
        <Row label="Write automatically" hint="At startup and after the evening review: each finished day's log, and last week's summary when a new week starts. Each note is written once, so your edits stay.">
          <input type="checkbox" checked={s.obsidianAuto} disabled={!s.obsidianDir} onChange={(e) => set({ obsidianAuto: e.target.checked })} aria-label="Write notes to Obsidian automatically" />
          {s.obsidianDir && s.obsidianAuto && (
            <button className="btn btn-ghost sm" onClick={() => void import("../state/obsidian").then((o) => o.autoExport()).then((n) => A.toast(n ? `Wrote ${n} note${n > 1 ? "s" : ""}` : "Everything is already written"), A.reportError)}>
              Write now
            </button>
          )}
        </Row>
      </div>

      </>
)}

      {tab === "keyboard" && (
<>
<h2 className="section-title">Keyboard</h2>
      <ShortcutEditor />
      <div className="settings-block shortcuts">
        {[
          ["Ctrl K", "Command palette & search"],
          ["← →", "Previous / next day (or week, month)"],
          ["Ctrl E", "Start / stop timer"],
          ["1 – 9", "Pick category (in picker) or recategorise selection"],
          ["Ctrl D", "Duplicate selected block"],
          ["Ctrl C / Ctrl V", "Copy block / paste onto focused day"],
          ["Del", "Delete selection"],
          ["Ctrl Z / Ctrl Y", "Undo / redo"],
          ["Alt + drag", "Copy a block while dragging"],
          ["Ctrl + scroll", "Zoom timeline"],
        ].map(([k, d]) => (
          <div key={k} className="shortcut-row">
            <kbd>{k}</kbd>
            <span>{d}</span>
          </div>
        ))}
      </div>
      </>
)}

      <p className="muted small pad-top">Interval {__APP_VERSION__} · local-first · no account, no network.</p>
    </section>
  );
}

function confirmInline(msg: string): boolean {
  // window.confirm is synchronous and native on Windows (WebView2), acceptable for rare destructive settings changes.
  return window.confirm(msg);
}

export function NumField(p: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string }) {
  const [v, setV] = useState(String(p.value));
  const commit = () => {
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n >= p.min && n <= p.max) p.onChange(n);
    else setV(String(p.value));
  };
  return (
    <label className="num-field">
      <input className="field num" type="number" inputMode="numeric" min={p.min} max={p.max} value={v} aria-label={p.label} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      {p.suffix && <span className="muted small">{p.suffix}</span>}
    </label>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <div>{label}</div>
        {hint && <div className="set-hint">{hint}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function LadderField(p: { value: number[]; onChange: (v: number[]) => void }) {
  const [v, setV] = useState(p.value.join(", "));
  const commit = () => {
    const nums = [...new Set(v.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0).map(Math.round))].sort((a, b) => a - b);
    if (nums.length) p.onChange(nums);
    setV((nums.length ? nums : p.value).join(", "));
  };
  return <input className="field ladder" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} aria-label="Milestone hours" />;
}

function ShortcutEditor() {
  const overrides = useApp((s) => s.settings.shortcuts);
  const categories = useApp((s) => s.categories);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setCapturing(null);
      const combo = comboOf(e);
      if (!combo) return;
      if (RESERVED.has(combo)) {
        setNote(`${prettyKey(combo)} is reserved.`);
        return;
      }
      const next = { ...overrides };
      // A key does one thing: whatever action had it loses it.
      for (const a of SHORTCUT_ACTIONS) if (a.id !== capturing && keyOf(a.id, next) === combo) next[a.id] = "";
      next[capturing] = combo;
      for (const a of SHORTCUT_ACTIONS) if (next[a.id] === a.key) delete next[a.id];
      const cat = categories.find((c) => !c.archivedAt && c.shortcut && c.shortcut.toLowerCase() === combo);
      setNote(cat ? `${prettyKey(combo)} is also ${cat.name}'s category key; the action wins when a block is selected.` : null);
      setCapturing(null);
      void A.updateSettings({ shortcuts: next });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, overrides, categories]);
  return (
    <div className="settings-block shortcuts editable">
      {SHORTCUT_ACTIONS.map((a) => {
        const key = keyOf(a.id, overrides);
        const changed = a.id in overrides;
        return (
          <div key={a.id} className="shortcut-row">
            <button className={`kbd-btn ${capturing === a.id ? "capturing" : ""}`} onClick={() => (setNote(null), setCapturing(capturing === a.id ? null : a.id))} aria-label={`Shortcut for ${a.label}`}>
              {capturing === a.id ? "Press a key…" : prettyKey(key)}
            </button>
            <span>{a.label}</span>
            {changed && (
              <button
                className="link-btn"
                onClick={() => {
                  const next = { ...overrides };
                  delete next[a.id];
                  void A.updateSettings({ shortcuts: next });
                }}
              >
                Reset to {prettyKey(a.key)}
              </button>
            )}
          </div>
        );
      })}
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}
