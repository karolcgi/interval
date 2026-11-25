import { useState } from "react";
import { Download, FolderOpen, Upload } from "lucide-react";
import { store, useApp } from "../state/store";
import * as A from "../state/actions";
import { exportCsv, exportJson, importCsv, importJson } from "../db/io";
import { bootPrefs, isTauri, openTextFile, pickDirectory, revealDataFolder, saveTextFile } from "../platform";
import { dayKey } from "../domain/time";
import { Segmented } from "./bits";
import { switchDemo } from "../bootstrap";

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

export function SettingsView() {
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
      </div>

      <h2 className="section-title">Data</h2>
      <div className="settings-block">
        <Row label="Database" hint={isTauri() ? "Local SQLite file. A rolling daily backup (last 14 days) is written to a backups folder beside it." : "Browser preview: stored in this browser’s IndexedDB. Use the desktop app for real records."}>
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

      <h2 className="section-title">Keyboard</h2>
      <div className="settings-block shortcuts">
        {[
          ["Ctrl K", "Command palette & search"],
          ["T", "Jump to today"],
          ["← → or J K", "Previous / next day (or week, month)"],
          ["D  W  M", "Day / week / month view"],
          ["S  or Ctrl E", "Start / stop timer (selected block, or unscheduled)"],
          ["1 – 9", "Pick category (in picker) or recategorise selection"],
          ["C", "Confirm selected block as done"],
          ["X", "Split selected block"],
          ["Ctrl D", "Duplicate selected block"],
          ["Ctrl C / Ctrl V", "Copy block / paste onto focused day"],
          ["Del", "Delete selection"],
          ["Ctrl Z / Ctrl Y", "Undo / redo"],
          ["[  ]", "Toggle sidebar / details panel"],
          ["Alt + drag", "Copy a block while dragging"],
          ["Ctrl + scroll", "Zoom timeline"],
        ].map(([k, d]) => (
          <div key={k} className="shortcut-row">
            <kbd>{k}</kbd>
            <span>{d}</span>
          </div>
        ))}
      </div>
      <p className="muted small pad-top">Interval 0.1.0 · local-first · no account, no network.</p>
    </section>
  );
}

function confirmInline(msg: string): boolean {
  // window.confirm is synchronous and native on Windows (WebView2), acceptable for rare destructive settings changes.
  return window.confirm(msg);
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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
