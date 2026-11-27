// Projects tab (v0.12): a read-only kanban of the Obsidian project notes, grouped by their status property
// (project_status), in the same column and card order as the Bases board, with cover images. Interval never
// changes a project: cards open the note, show its tasks, or start a focus session about it.
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, FolderKanban, ImageOff, ListFilter, Play, RefreshCw, Search, X } from "lucide-react";
import { store, useApp } from "../state/store";
import * as A from "../state/actions";
import * as F from "../state/focus";
import * as repo from "../db/repo";
import { isTauri } from "../platform";
import { coverTarget, hexColor, projectColumns, type ExtProject } from "../domain/integration";
import type { ExtItemRow } from "../db/repo";
import { fmtDuration } from "../domain/format";
import { openInObsidian } from "./openInObsidian";
import { MenuItem } from "./ContextMenus";
import { usePlacement, useOutside } from "./bits";
import { linksForProject } from "../state/links";

const integration = () => import("../state/integration");

/** Cover images resolved to files the webview may show (desktop), keyed by project ref. */
function useCovers(projects: ExtItemRow<ExtProject>[], vault: string | null): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const key = projects.map((p) => `${p.ref}=${p.data.cover ?? ""}`).join("|");
  useEffect(() => {
    let dead = false;
    const targets = new Map<string, string>(); // ref → target
    for (const p of projects) {
      const t = coverTarget(p.data.cover);
      if (t) targets.set(p.ref, t);
    }
    const out = new Map<string, string>();
    const local: string[] = [];
    for (const [ref, t] of targets) (/^https?:\/\//i.test(t) ? out.set(ref, t) : local.push(t));
    if (!local.length || !vault || !isTauri()) return void setUrls(out);
    void (async () => {
      try {
        const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
        const found = await invoke<Record<string, string>>("vault_resolve_images", { vault, targets: [...new Set(local)] });
        for (const [ref, t] of targets) if (found[t]) out.set(ref, convertFileSrc(found[t]));
      } catch (e) {
        console.warn(e);
      }
      if (!dead) setUrls(out);
    })();
    return () => void (dead = true);
  }, [key, vault]); // eslint-disable-line react-hooks/exhaustive-deps
  return urls;
}

export function ProjectsView() {
  const projects = useApp((s) => s.extProjects);
  const tasks = useApp((s) => s.extTasks);
  const board = useApp((s) => s.projectBoard);
  const enabled = useApp((s) => s.settings.integration.enabled);
  const vault = useApp((s) => s.settings.integration.vaultPath);
  const syncing = useApp((s) => s.integration.state === "syncing");
  const rev = useApp((s) => s.integration.rev);
  const sessionsRev = useApp((s) => s.sessions);
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; ref: string } | null>(null);
  const [totals, setTotals] = useState<Map<string, { ms: number; sessions: number; last: number }>>(new Map());
  const covers = useCovers(projects, vault);

  useEffect(() => {
    const db = store.get().db;
    if (db) void repo.projectTotals(db).then(setTotals).catch(() => undefined);
  }, [rev, sessionsRev]);

  const openTasks = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) if (t.active) for (const p of t.data.projects) m.set(p, (m.get(p) ?? 0) + 1);
    return m;
  }, [tasks]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? projects.filter((p) => p.title.toLowerCase().includes(n) || (p.data.client ?? "").toLowerCase().includes(n)) : projects;
  }, [projects, q]);
  const columns = useMemo(() => projectColumns(shown, board?.columns ?? [], board?.cardOrder ?? {}), [shown, board]);

  if (!enabled)
    return (
      <section className="projects-view">
        <div className="pv-empty">
          <FolderKanban size={28} />
          <p>Connect your Obsidian vault in Settings › Obsidian to see your projects here.</p>
          <button className="btn btn-outline sm" onClick={() => A.setView("settings")}>
            Open settings
          </button>
        </div>
      </section>
    );

  return (
    <section className="projects-view">
      <header className="pv-head">
        <div>
          <div className="eyebrow">Obsidian</div>
          <h1 className="page-title">Projects</h1>
        </div>
        <div className="pv-tools">
          <label className="preset-search pv-search">
            <Search size={12} aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects" onKeyDown={(e) => (e.stopPropagation(), e.key === "Escape" && setQ(""))} />
            {q && (
              <button className="icon-btn sm" onClick={() => setQ("")} aria-label="Clear search">
                <X size={11} />
              </button>
            )}
          </label>
          <span className="muted small">{projects.length} projects · read-only, status lives in Obsidian</span>
          <button className="btn btn-ghost sm" disabled={syncing} onClick={() => void integration().then((i) => i.refreshIntegration())} title="Refresh from the vault">
            <RefreshCw size={13} className={syncing ? "spin" : ""} /> Refresh
          </button>
        </div>
      </header>
      <div className="pv-board" role="list" aria-label="Projects by status">
        {columns.map((col) => (
          <div key={col.key || "_none"} className="pv-col" role="listitem" aria-label={`${col.key || "No status"}: ${col.items.length}`}>
            <div className="pv-col-head">
              <span className="pv-col-name">{col.key || "No status"}</span>
              <span className="pv-col-count">{col.items.length}</span>
            </div>
            <div className="pv-cards">
              {col.items.map((p) => {
                const cover = covers.get(p.ref);
                const tot = totals.get(p.ref);
                const open = openTasks.get(p.ref) ?? 0;
                const color = hexColor(p.data.color);
                return (
                  <article
                    key={p.ref}
                    className={`pv-card ${cover ? "has-cover" : ""}`}
                    tabIndex={0}
                    onClick={() => openInObsidian(p.ref)}
                    onKeyDown={(e) => e.key === "Enter" && openInObsidian(p.ref)}
                    onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, ref: p.ref }))}
                    title={`${p.title}\n${p.ref}\nClick to open in Obsidian · right-click for more`}
                    style={color ? { ["--pc" as string]: color } : undefined}
                  >
                    {cover ? (
                      <img className="pv-cover" src={cover} alt="" loading="lazy" draggable={false} onError={(e) => ((e.currentTarget.style.display = "none"))} />
                    ) : p.data.cover ? (
                      <div className="pv-cover missing" title={`Cover not found: ${p.data.cover}`}>
                        <ImageOff size={14} />
                      </div>
                    ) : null}
                    <div className="pv-card-body">
                      <div className="pv-title">{p.title}</div>
                      <div className="pv-meta">
                        {p.data.client && <span>{p.data.client}</span>}
                        {open > 0 && <span>{open} open task{open > 1 ? "s" : ""}</span>}
                        {tot && tot.ms >= 60_000 && <span title={`${tot.sessions} session${tot.sessions > 1 ? "s" : ""} recorded`}>{fmtDuration(tot.ms, { compact: true })} tracked</span>}
                      </div>
                    </div>
                  </article>
                );
              })}
              {col.items.length === 0 && <div className="pv-col-empty">—</div>}
            </div>
          </div>
        ))}
        {columns.length === 0 && (
          <div className="pv-empty">
            <p>No projects found. Point Settings › Obsidian › Projects folder at your projects folder or your PROJECTS.base file.</p>
          </div>
        )}
      </div>
      {menu && <ProjectMenu x={menu.x} y={menu.y} refPath={menu.ref} onClose={() => setMenu(null)} />}
    </section>
  );
}

function ProjectMenu(p: { x: number; y: number; refPath: string; onClose: () => void }) {
  const { ref, style } = usePlacement(p.x, p.y);
  useOutside(ref, p.onClose);
  const run = (fn: () => void) => () => (p.onClose(), fn());
  return (
    <div className="popover menu popover-modal" ref={ref} style={style} role="menu" onContextMenu={(e) => e.preventDefault()}>
      <MenuItem icon={<ExternalLink size={13} />} label="Open in Obsidian" onClick={run(() => openInObsidian(p.refPath))} />
      <MenuItem icon={<ListFilter size={13} />} label="Show its tasks on Today" onClick={run(() => (A.openDay(Date.now()), store.set({ taskProjectFilter: p.refPath })))} />
      <MenuItem
        icon={<Play size={13} />}
        label="Start focus on this project"
        onClick={run(() => {
          const l = linksForProject(p.refPath);
          const s = store.get();
          void F.start(s.settings.focusTimerMode, { title: l.projectTitle, ...(l.categoryId ? { categoryId: l.categoryId } : {}), taskRef: null, taskTitle: null, projectRef: l.projectRef, projectTitle: l.projectTitle }).catch(A.reportError);
        })}
      />
      <div className="menu-foot">{p.refPath}</div>
    </div>
  );
}
