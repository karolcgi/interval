// PROJECTS and TASKS sidebar sections (v0.11, integration Phase 2). Live from the Obsidian/TaskNotes cache;
// shown only when the integration is on. Everything here is read-only: rows drag onto PLAN (a local block that
// references the note) or open the note in Obsidian. Nothing changes a task or project.
import { useMemo, useState } from "react";
import { Circle, CircleCheck, ExternalLink, GripVertical, ListFilter, RefreshCw, Search, X } from "lucide-react";
import { store, useApp } from "../state/store";
import * as A from "../state/actions";
import { SideSection } from "./SideSection";
import { beginItemDrag } from "./presetDrag";
import { MenuItem } from "./ContextMenus";
import { usePlacement, useOutside } from "./bits";
import { openExternal } from "../platform";
import { taskDragMinutes } from "../state/library";
import { dayKey } from "../domain/time";
import { dateOnly, groupTasks, hexColor, matchesFilter, obsidianUri, vaultNameOf, type TaskFilter, type TaskGroupBy } from "../domain/integration";
import { SyncDot } from "./IntegrationSettings";

const integration = () => import("../state/integration");

export function openInObsidian(path: string) {
  const vault = vaultNameOf(store.get().settings.integration);
  if (!vault) return A.toast("Set the vault in Settings › Obsidian first");
  void openExternal(obsidianUri(vault, path)).catch(A.reportError);
}

const STATE_TITLE = { off: "Off", connected: "Connected", offline: "Offline — showing cached data", syncing: "Synchronizing…", error: "Synchronization error — see Settings › Obsidian" } as const;

function SyncButton() {
  const st = useApp((s) => s.integration.state);
  const last = useApp((s) => s.integration.lastSync);
  const title = `${STATE_TITLE[st]}${last ? `\nLast synced ${new Date(last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}\nClick to refresh`;
  return (
    <button className="icon-btn sm sync-btn" title={title} aria-label={`Obsidian: ${STATE_TITLE[st]}. Refresh`} onClick={() => void integration().then((i) => i.refreshIntegration())}>
      {st === "syncing" ? <RefreshCw size={11} className="spin" /> : <SyncDot />}
    </button>
  );
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="preset-search">
      <Search size={12} aria-hidden />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} aria-label={label} onKeyDown={(e) => (e.stopPropagation(), e.key === "Escape" && onChange(""))} />
      {value && (
        <button className="icon-btn sm" onClick={() => onChange("")} aria-label="Clear search">
          <X size={11} />
        </button>
      )}
    </label>
  );
}

function ExtMenu(p: { x: number; y: number; path: string; extra?: React.ReactNode; onClose: () => void }) {
  const { ref, style } = usePlacement(p.x, p.y);
  useOutside(ref, p.onClose);
  return (
    <div className="popover menu popover-modal" ref={ref} style={style} role="menu" onContextMenu={(e) => e.preventDefault()}>
      <MenuItem
        icon={<ExternalLink size={13} />}
        label="Open in Obsidian"
        onClick={() => {
          p.onClose();
          openInObsidian(p.path);
        }}
      />
      {p.extra}
      <div className="menu-foot">{p.path}</div>
    </div>
  );
}

// ------------------------------------------------------------------ projects

export function ProjectsSection() {
  const projects = useApp((s) => s.extProjects);
  const projectFilter = useApp((s) => s.taskProjectFilter);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; ref: string } | null>(null);
  const dragging = useApp((s) => (s.presetDrag?.item && s.presetDrag.item.kind === "project" ? s.presetDrag.item.ref : null));

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return projects.filter((p) => (all || p.active) && (!needle || p.title.toLowerCase().includes(needle) || (p.data.client ?? "").toLowerCase().includes(needle)));
  }, [projects, q, all]);

  return (
    <SideSection id="projects" title="Projects" actions={<SyncButton />}>
      <div className="preset-filter">
        <SearchBox value={q} onChange={setQ} label="Search projects" />
        <button className={`chip xs ${all ? "on" : ""}`} onClick={() => setAll(!all)} aria-pressed={all} title={all ? "Showing all projects" : "Showing active projects"}>
          {all ? "All" : "Active"}
        </button>
      </div>
      <ul className="ext-list" aria-label="Obsidian projects">
        {shown.map((p) => {
          const color = hexColor(p.data.color) ?? "var(--text-4)";
          const sel = projectFilter === p.ref;
          return (
            <li
              key={p.ref}
              className={`ext-row ${dragging === p.ref ? "dragging" : ""} ${sel ? "selected" : ""} ${p.active ? "" : "inactive"}`}
              onPointerDown={(e) =>
                beginItemDrag(e, { kind: "project", ref: p.ref, label: p.title, color: hexColor(p.data.color), minutes: 0 }, () => store.set({ taskProjectFilter: sel ? null : p.ref }))
              }
              onDoubleClick={() => openInObsidian(p.ref)}
              onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, ref: p.ref }))}
              title={`${p.title}${p.data.client ? ` · ${p.data.client}` : ""}${p.status ? ` · ${p.status}` : ""}\nDrag onto Today · click to see its tasks · double-click opens it in Obsidian`}
            >
              <GripVertical size={12} className="preset-grip" aria-hidden />
              <span className="ext-swatch" style={{ background: color }} />
              <span className="ext-name">{p.title}</span>
              {!p.active && p.status && <span className="ext-meta">{p.status}</span>}
            </li>
          );
        })}
        {shown.length === 0 && <li className="preset-empty muted small">{projects.length ? "No projects match." : "No projects yet. Check Settings › Obsidian."}</li>}
      </ul>
      {menu && (
        <ExtMenu
          x={menu.x}
          y={menu.y}
          path={menu.ref}
          onClose={() => setMenu(null)}
          extra={<MenuItem icon={<ListFilter size={13} />} label="Show its tasks" onClick={() => (store.set({ taskProjectFilter: menu.ref }), setMenu(null))} />}
        />
      )}
    </SideSection>
  );
}

// ------------------------------------------------------------------ tasks

const FILTERS: Array<{ id: TaskFilter; label: string }> = [
  { id: "today", label: "Today" },
  { id: "overdue", label: "Overdue" },
  { id: "upcoming", label: "Upcoming" },
  { id: "unscheduled", label: "Unscheduled" },
  { id: "all", label: "All" },
];

function shortDate(d: string | null, today: string): string | null {
  const day = dateOnly(d);
  if (!day) return null;
  if (day === today) return d && d.length > 10 ? d.slice(11, 16) : "Today";
  const [y, m, dd] = day.split("-").map(Number);
  return new Date(y, m - 1, dd).toLocaleDateString([], { day: "numeric", month: "short" });
}

export function TasksSection() {
  const tasks = useApp((s) => s.extTasks);
  const projects = useApp((s) => s.extProjects);
  const cfg = useApp((s) => s.settings.integration.tasks);
  const projectFilter = useApp((s) => s.taskProjectFilter);
  const date = useApp((s) => s.date);
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; ref: string } | null>(null);
  const dragging = useApp((s) => (s.presetDrag?.item && s.presetDrag.item.kind === "task" ? s.presetDrag.item.ref : null));
  const filter: TaskFilter = cfg.defaultFilter === "project" ? "today" : cfg.defaultFilter;
  const groupBy: TaskGroupBy = (cfg.groupBy as TaskGroupBy | undefined) ?? (cfg.groupField ? "field" : "none");
  const today = dayKey(date); // follows the focused day, so "Today" means the day you're sketching

  const saveTasks = (patch: Partial<typeof cfg>) => {
    const c = store.get().settings.integration;
    void A.updateSettings({ integration: { ...c, tasks: { ...c.tasks, ...patch } } }).catch(A.reportError);
  };
  const projTitle = useMemo(() => {
    const m = new Map(projects.map((p) => [p.ref, p.title]));
    return (ref: string) => m.get(ref) ?? ref.split("/").pop()!.replace(/\.md$/i, "");
  }, [projects]);
  const projColor = useMemo(() => new Map(projects.map((p) => [p.ref, hexColor(p.data.color)])), [projects]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!cfg.showCompleted && !t.active) return false;
      if (projectFilter) {
        if (!t.data.projects.includes(projectFilter)) return false;
      } else if (!needle && !matchesFilter(t.data, filter, today)) return false;
      return !needle || t.title.toLowerCase().includes(needle) || t.data.projectNames.some((n) => n.toLowerCase().includes(needle));
    });
  }, [tasks, q, filter, today, projectFilter, cfg.showCompleted]);
  const groups = useMemo(() => groupTasks(shown, groupBy, projTitle), [shown, groupBy, projTitle]);

  return (
    <SideSection id="tasks" title="Tasks" actions={<SyncButton />}>
      <div className="preset-filter">
        <SearchBox value={q} onChange={setQ} label="Search tasks" />
        <select className="preset-cat-filter" value={groupBy} onChange={(e) => saveTasks({ groupBy: e.target.value as TaskGroupBy })} aria-label="Group tasks by" title="Group by">
          <option value="none">No groups</option>
          {cfg.groupField && <option value="field">By {cfg.groupField}</option>}
          <option value="project">By project</option>
          <option value="status">By status</option>
        </select>
      </div>
      <div className="ext-filters" role="tablist" aria-label="Task filter">
        {projectFilter ? (
          <button className="chip xs on" onClick={() => store.set({ taskProjectFilter: null })} title="Show all tasks again">
            {projTitle(projectFilter)} <X size={10} />
          </button>
        ) : (
          FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} className={`chip xs ${filter === f.id ? "on" : ""}`} onClick={() => saveTasks({ defaultFilter: f.id })}>
              {f.label}
            </button>
          ))
        )}
        <button className={`chip xs ${cfg.showCompleted ? "on" : ""}`} onClick={() => saveTasks({ showCompleted: !cfg.showCompleted })} aria-pressed={cfg.showCompleted} title="Show completed tasks">
          <CircleCheck size={10} />
        </button>
      </div>
      <div className="ext-list" aria-label="TaskNotes tasks">
        {groups.map((g) => (
          <div key={g.key || "_"} className="ext-group">
            {groupBy !== "none" && <div className="ext-group-head">{g.key || "No " + (groupBy === "field" ? cfg.groupField : groupBy)}</div>}
            {g.items.map((t) => {
              const proj = t.data.projects[0];
              const color = (proj && projColor.get(proj)) || null;
              const when = shortDate(t.data.scheduled, today) ?? shortDate(t.data.due, today);
              const overdue = !!dateOnly(t.data.due) && dateOnly(t.data.due)! < today && t.active;
              return (
                <div
                  key={t.ref}
                  className={`ext-row task ${dragging === t.ref ? "dragging" : ""} ${t.active ? "" : "done"}`}
                  onPointerDown={(e) => beginItemDrag(e, { kind: "task", ref: t.ref, label: t.title, color, minutes: taskDragMinutes(t.data) })}
                  onDoubleClick={() => openInObsidian(t.ref)}
                  onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, ref: t.ref }))}
                  title={`${t.title}${t.data.projectNames.length ? `\n${t.data.projectNames.join(", ")}` : ""}${t.data.due ? `\nDue ${t.data.due}` : ""}${t.data.scheduled ? `\nScheduled ${t.data.scheduled}` : ""}\nDrag onto Today · double-click opens it in Obsidian`}
                >
                  <GripVertical size={12} className="preset-grip" aria-hidden />
                  {t.active ? <Circle size={11} className="ext-check" style={color ? { color } : undefined} aria-label="Open" /> : <CircleCheck size={11} className="ext-check" aria-label="Completed" />}
                  <span className="ext-name">{t.title}</span>
                  {when && <span className={`ext-meta ${overdue ? "overdue" : ""}`}>{when}</span>}
                </div>
              );
            })}
          </div>
        ))}
        {shown.length === 0 && <div className="preset-empty muted small">{tasks.length ? "Nothing here." : "No tasks yet. Check Settings › Obsidian."}</div>}
      </div>
      {menu && <ExtMenu x={menu.x} y={menu.y} path={menu.ref} onClose={() => setMenu(null)} />}
    </SideSection>
  );
}
