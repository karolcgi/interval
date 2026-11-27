// Settings › Obsidian › Integration (v0.10, Phase 1): connection, mappings, status and a preview of what was imported.
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useApp } from "../state/store";
import * as A from "../state/actions";
import { isTauri, openExternal, pickDirectory } from "../platform";
import {
  obsidianUri,
  vaultNameOf,
  type ExtProject,
  type ExtTask,
  type IntegrationConfig,
  type ProjectMapping,
  type TaskMapping,
} from "../domain/integration";
import type { ExtItemRow } from "../db/repo";
import { Row } from "./SettingsView";
import type { ConnectionReport } from "../state/integration";

const integration = () => import("../state/integration");

function formatDistanceShort(t: number, now = Date.now()): string {
  const m = Math.round((now - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString();
}

/** A text field that saves on blur / Enter (no save button, no dialog). */
function TextSetting({ value, onSave, placeholder, label, list, width = 220, type = "text" }: { value: string; onSave: (v: string) => void; placeholder?: string; label: string; list?: string; width?: number; type?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onSave(v.trim());
  return (
    <input
      className="field sm"
      style={{ width }}
      type={type}
      value={v}
      placeholder={placeholder}
      aria-label={label}
      list={list}
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

const STATE_LABEL = { off: "Off", connected: "Connected", offline: "Offline — cached data", syncing: "Synchronizing…", error: "Synchronization error" } as const;

export function SyncDot() {
  const st = useApp((x) => x.integration.state);
  return <span className={`sync-dot ${st}`} aria-hidden />;
}

export function IntegrationSettings() {
  const c = useApp((x) => x.settings.integration);
  const status = useApp((x) => x.integration);
  const [token, setToken] = useState("");
  const [tokenSaved, setTokenSaved] = useState<boolean | null>(null);
  const [report, setReport] = useState<ConnectionReport | null>(null);
  const [testing, setTesting] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [preview, setPreview] = useState<{ tasks: ExtItemRow<ExtTask>[]; projects: ExtItemRow<ExtProject>[] } | null>(null);

  const save = (patch: Partial<IntegrationConfig>) => void A.updateSettings({ integration: { ...c, ...patch } }).catch(A.reportError);
  const saveP = (patch: Partial<ProjectMapping>) => save({ projects: { ...c.projects, ...patch } });
  const saveT = (patch: Partial<TaskMapping>) => save({ tasks: { ...c.tasks, ...patch } });

  useEffect(() => {
    void integration().then((i) => i.hasToken()).then(setTokenSaved);
  }, []);
  useEffect(() => {
    if (c.enabled) void integration().then((i) => i.cachedItems()).then(setPreview);
  }, [status.rev, c.enabled]);

  const saveToken = async () => {
    try {
      const i = await integration();
      await i.saveToken(token);
      setToken("");
      setTokenSaved(await i.hasToken());
      A.toast(token.trim() ? "Token saved in the system credential store" : "Token removed");
    } catch (e) {
      A.reportError(e);
    }
  };
  const test = async () => {
    setTesting(true);
    try {
      setReport(await (await integration()).testConnection());
    } finally {
      setTesting(false);
    }
  };
  const refresh = () => void integration().then((i) => i.refreshIntegration());
  const vault = vaultNameOf(c);

  return (
    <>
      <h2 className="section-title">Obsidian &amp; TaskNotes</h2>
      <div className="settings-block">
        <Row label="Connect to my vault" hint="Shows your Obsidian projects and TaskNotes tasks in Interval. Read-only: Interval never changes your notes or tasks. Everything keeps working without it.">
          <input type="checkbox" checked={c.enabled} onChange={(e) => save({ enabled: e.target.checked })} aria-label="Enable Obsidian integration" />
          {c.enabled && (
            <span className="sync-status">
              <SyncDot /> {STATE_LABEL[status.state]}
              {status.lastSync && <span className="muted"> · synced {formatDistanceShort(status.lastSync)}</span>}
            </span>
          )}
        </Row>
        {c.enabled && (
          <>
            <Row label="Vault folder" hint={isTauri() ? "The Karol_OS folder on this computer. Projects are read from it." : "Desktop app only."}>
              <code className="path">{c.vaultPath ?? "not set"}</code>
              {isTauri() && (
                <button className="btn btn-outline sm" onClick={() => void pickDirectory().then((vaultPath) => vaultPath && save({ vaultPath }))}>
                  Choose…
                </button>
              )}
              <TextSetting label="Vault name" value={c.vaultName} placeholder={vault || "Vault name"} width={140} onSave={(vaultName) => save({ vaultName })} />
            </Row>
            <Row label="TaskNotes API" hint="TaskNotes › Settings › HTTP API. Turn it on there, then paste the address and the token. Only addresses on this computer are allowed.">
              <TextSetting label="TaskNotes API address" value={c.apiUrl} placeholder="http://localhost:8080" width={180} onSave={(apiUrl) => save({ apiUrl: apiUrl || "http://localhost:8080" })} />
              <input
                className="field sm"
                style={{ width: 180 }}
                type="password"
                autoComplete="off"
                value={token}
                placeholder={tokenSaved ? "Token saved ••••••" : "Paste token"}
                aria-label="TaskNotes token"
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void saveToken()}
              />
              {token && (
                <button className="btn btn-outline sm" onClick={() => void saveToken()}>
                  Save token
                </button>
              )}
              {!token && tokenSaved && (
                <button className="btn btn-ghost sm" onClick={() => void saveToken()}>
                  Remove
                </button>
              )}
            </Row>
            <Row label="Connection" hint={status.error ?? "Test checks TaskNotes, your token and the projects folder without changing anything."}>
              <button className="btn btn-outline sm" disabled={testing} onClick={() => void test()}>
                {testing ? "Testing…" : "Test connection"}
              </button>
              <button className="btn btn-ghost sm" disabled={status.state === "syncing"} onClick={refresh} title="Refresh now">
                <RefreshCw size={13} /> Refresh
              </button>
            </Row>
            {report && <ReportView r={report} />}

            <button className="set-disclosure" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
              {advanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Mappings
              <span className="muted"> · how Interval reads your project notes and tasks</span>
            </button>
            {advanced && (
              <>
                <datalist id="int-project-fields">
                  {(report?.projectFields ?? []).map((f) => <option key={f} value={f} />)}
                </datalist>
                <datalist id="int-task-fields">
                  {["projects", "contexts", "tags", "priority", "status", ...(report?.fields ?? [])].map((f) => <option key={f} value={f} />)}
                </datalist>
                <h3 className="set-sub">Projects</h3>
                <Row label="Projects folder" hint="Inside the vault, subfolders included. Leave empty for the whole vault.">
                  <TextSetting label="Projects folder" value={c.projects.folder} placeholder="Projects" onSave={(folder) => saveP({ folder })} />
                </Row>
                <Row label="A note is a project when" hint="Every note in the folder, or only notes with a tag or property.">
                  <select className="select sm" value={c.projects.rule} onChange={(e) => saveP({ rule: e.target.value as ProjectMapping["rule"] })} aria-label="Project rule">
                    <option value="folder">it's in the folder</option>
                    <option value="tag">it has the tag</option>
                    <option value="property">a property matches</option>
                  </select>
                  {c.projects.rule === "tag" && <TextSetting label="Project tag" value={c.projects.ruleTag} placeholder="project" width={140} onSave={(ruleTag) => saveP({ ruleTag })} />}
                  {c.projects.rule === "property" && (
                    <>
                      <TextSetting label="Property" value={c.projects.ruleProperty} placeholder="type" width={120} list="int-project-fields" onSave={(ruleProperty) => saveP({ ruleProperty })} />
                      <span className="muted">=</span>
                      <TextSetting label="Value" value={c.projects.ruleValue} placeholder="any value" width={120} onSave={(ruleValue) => saveP({ ruleValue })} />
                    </>
                  )}
                </Row>
                <Row label="Properties" hint="Property names in your project notes. Title empty = the file name.">
                  <div className="map-grid">
                    {(
                      [
                        ["titleProp", "Title", "file name"],
                        ["statusProp", "Status", "status"],
                        ["coverProp", "Cover image", "cover"],
                        ["categoryProp", "Category", "category"],
                        ["clientProp", "Client", "client"],
                        ["colorProp", "Colour", "color"],
                      ] as const
                    ).map(([k, label, ph]) => (
                      <label key={k} className="map-cell">
                        <span>{label}</span>
                        <TextSetting label={label} value={c.projects[k]} placeholder={ph} width={130} list="int-project-fields" onSave={(v) => saveP({ [k]: v })} />
                      </label>
                    ))}
                  </div>
                </Row>
                <Row label="Active status values" hint="Projects with one of these statuses are shown by default (comma-separated). Others stay in history and statistics.">
                  <TextSetting label="Active status values" value={c.projects.activeValues.join(", ")} placeholder="Active" onSave={(v) => saveP({ activeValues: v.split(",").map((x) => x.trim()).filter(Boolean) })} />
                </Row>

                <h3 className="set-sub">Tasks</h3>
                <Row label="Task properties" hint="Project link field, the property to group by (e.g. your task type: Inbox, Deep Work, Study…) and the one used for colour.">
                  <div className="map-grid">
                    <label className="map-cell">
                      <span>Project link</span>
                      <TextSetting label="Project link field" value={c.tasks.projectField} placeholder="projects" width={130} list="int-task-fields" onSave={(projectField) => saveT({ projectField: projectField || "projects" })} />
                    </label>
                    <label className="map-cell">
                      <span>Group by</span>
                      <TextSetting label="Group by" value={c.tasks.groupField} placeholder="none" width={130} list="int-task-fields" onSave={(groupField) => saveT({ groupField })} />
                    </label>
                    <label className="map-cell">
                      <span>Category</span>
                      <TextSetting label="Category field" value={c.tasks.categoryField} placeholder="none" width={130} list="int-task-fields" onSave={(categoryField) => saveT({ categoryField })} />
                    </label>
                  </div>
                </Row>
                <Row label="Completed statuses" hint="Used only when TaskNotes doesn't say itself whether a status means done (comma-separated).">
                  <TextSetting label="Completed statuses" value={c.tasks.completedStatuses.join(", ")} placeholder="done" onSave={(v) => saveT({ completedStatuses: v.split(",").map((x) => x.trim()).filter(Boolean) })} />
                </Row>
              </>
            )}

            {preview && (
              <ImportedPreview
                tasks={preview.tasks}
                projects={preview.projects}
                onOpen={(path) => vault && void openExternal(obsidianUri(vault, path))}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}

function ReportView({ r }: { r: ConnectionReport }) {
  return (
    <div className={`conn-report ${r.ok ? "ok" : "bad"}`} role="status">
      {r.ok ? (
        <div>
          Connected to TaskNotes{r.version ? ` ${r.version}` : ""}
          {r.vault ? ` in ${r.vault}` : ""}: {r.tasks ?? 0} tasks.
          {r.projectNotes != null && ` ${r.projectNotes} project notes found.`}
        </div>
      ) : (
        <div>Couldn't connect.</div>
      )}
      {r.problems.map((p) => (
        <div key={p} className="muted">
          {p}
        </div>
      ))}
    </div>
  );
}

/** What's in the cache right now, so the mappings can be checked before Phase 2 puts it in the sidebar. */
function ImportedPreview({ tasks, projects, onOpen }: { tasks: ExtItemRow<ExtTask>[]; projects: ExtItemRow<ExtProject>[]; onOpen: (path: string) => void }) {
  const [showAll, setShowAll] = useState(false);
  const activeProjects = projects.filter((p) => p.active);
  const shownProjects = showAll ? projects : activeProjects;
  const activeTasks = tasks.filter((t) => t.active);
  return (
    <div className="int-preview">
      <div className="int-col">
        <div className="int-head">
          Projects <span className="muted">{activeProjects.length} active · {projects.length} total</span>
          <button className="btn btn-ghost sm" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Active only" : "Show all"}
          </button>
        </div>
        {shownProjects.slice(0, 40).map((p) => (
          <button key={p.ref} className="int-row" title={`${p.ref} — open in Obsidian`} onClick={() => onOpen(p.ref)}>
            <span className="int-dot" style={p.data.color ? { background: p.data.color } : undefined} />
            <span className="int-title">{p.title}</span>
            <span className="muted">{[p.data.client, p.status].filter(Boolean).join(" · ")}</span>
          </button>
        ))}
        {shownProjects.length === 0 && <div className="muted int-empty">No projects imported yet.</div>}
      </div>
      <div className="int-col">
        <div className="int-head">
          Tasks <span className="muted">{activeTasks.length} active</span>
        </div>
        {activeTasks.slice(0, 40).map((t) => (
          <button key={t.ref} className="int-row" title={`${t.ref} — open in Obsidian`} onClick={() => onOpen(t.ref)}>
            <span className="int-title">{t.title}</span>
            <span className="muted">{[t.data.group, t.data.projectNames[0], t.data.scheduled?.slice(0, 10) ?? t.data.due?.slice(0, 10)].filter(Boolean).join(" · ")}</span>
          </button>
        ))}
        {activeTasks.length === 0 && <div className="muted int-empty">No tasks imported yet.</div>}
      </div>
    </div>
  );
}
