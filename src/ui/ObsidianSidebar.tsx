// PROJECTS and TASKS sidebar sections (v0.11, integration Phase 2). Live from the Obsidian/TaskNotes cache;
// shown only when the integration is on. Everything here is read-only: rows drag onto PLAN (a local block that
// references the note) or open the note in Obsidian. Nothing changes a task or project.
import { useMemo, useState } from "react";
import { CalendarCheck, ChevronDown, ChevronRight, Circle, CircleCheck, ExternalLink, GripVertical, ListFilter, RefreshCw, Repeat, Search, X } from "lucide-react";
import { TnIcon } from "./TnIcon";
import { store, useApp } from "../state/store";
import * as A from "../state/actions";
import { SideSection } from "./SideSection";
import { beginItemDrag } from "./presetDrag";
import { MenuItem } from "./ContextMenus";
import { usePlacement, useOutside } from "./bits";
import { openInObsidian } from "./openInObsidian";
import { taskDragMinutes } from "../state/library";
import { addDays, dayKey } from "../domain/time";
import { dateOnly, groupByStatus, groupTasks, hexColor, matchesFilter, priorityOf, statusOf, type TaskFilter, type TaskGroupBy } from "../domain/integration";
import { SyncDot } from "./IntegrationSettings";

const integration = () => import("../state/integration");

export { openInObsidian };

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

const COLLAPSE_KEY = "interval.taskGroupsCollapsed";
function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function TasksSection() {
  const tasks = useApp((s) => s.extTasks);
  const projects = useApp((s) => s.extProjects);
  const meta = useApp((s) => s.extMeta);
  const cfg = useApp((s) => s.settings.integration.tasks);
  const projectFilter = useApp((s) => s.taskProjectFilter);
  const date = useApp((s) => s.date);
  const blocks = useApp((s) => s.blocks);
  const [q, setQ] = useState("");
  const [showPlanned, setShowPlanned] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [menu, setMenu] = useState<{ x: number; y: number; ref: string } | null>(null);
  const dragging = useApp((s) => (s.presetDrag?.item && s.presetDrag.item.kind === "task" ? s.presetDrag.item.ref : null));
  const filter: TaskFilter = cfg.defaultFilter === "project" ? "today" : cfg.defaultFilter;
  // v0.12: grouped by TaskNotes status by default, like TaskNotes itself.
  const groupBy: TaskGroupBy = (cfg.groupBy as TaskGroupBy | undefined) ?? (cfg.groupField ? "field" : "status");
  const today = dayKey(date); // follows the focused day, so "Today" means the day you're sketching

  const saveTasks = (patch: Partial<typeof cfg>) => {
    const c = store.get().settings.integration;
    void A.updateSettings({ integration: { ...c, tasks: { ...c.tasks, ...patch } } }).catch(A.reportError);
  };
  const toggleGroup = (k: string) => {
    const next = new Set(collapsed);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
    } catch {
      /* per-viewer nicety only */
    }
  };
  const projTitle = useMemo(() => {
    const m = new Map(projects.map((p) => [p.ref, p.title]));
    return (ref: string) => m.get(ref) ?? ref.split("/").pop()!.replace(/\.md$/i, "");
  }, [projects]);
  const projColor = useMemo(() => new Map(projects.map((p) => [p.ref, hexColor(p.data.color)])), [projects]);
  // v0.12: a task dragged onto PLAN for this day leaves the list (it's on the plan now). Delete the block and
  // it comes back. Read-only: nothing changes in TaskNotes.
  const planned = useMemo(() => {
    const end = addDays(date, 1);
    return new Set(blocks.filter((b) => b.sourceKind === "task" && b.sourceRef && b.startAt < end && b.endAt > date).map((b) => b.sourceRef!));
  }, [blocks, date]);

  const matching = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (!cfg.showCompleted && !t.active) return false;
      if (projectFilter) {
        if (!t.data.projects.includes(projectFilter)) return false;
      } else if (!needle && !matchesFilter(t.data, filter, today)) return false;
      return !needle || t.title.toLowerCase().includes(needle) || t.data.projectNames.some((n) => n.toLowerCase().includes(needle));
    });
  }, [tasks, q, filter, today, projectFilter, cfg.showCompleted]);
  const hiddenCount = matching.filter((t) => planned.has(t.ref)).length;
  const shown = useMemo(() => (showPlanned ? matching : matching.filter((t) => !planned.has(t.ref))), [matching, planned, showPlanned]);
  const groups = useMemo(() => {
    if (groupBy === "status") return groupByStatus(shown, meta).map((g) => ({ key: "s:" + g.key, label: g.label, status: g.status, items: g.items }));
    return groupTasks(shown, groupBy, projTitle).map((g) => ({ key: g.key, label: g.key || "No " + (groupBy === "field" ? cfg.groupField : groupBy), status: null, items: g.items }));
  }, [shown, groupBy, meta, projTitle, cfg.groupField]);

  return (
    <SideSection id="tasks" title="Tasks" actions={<SyncButton />}>
      <div className="preset-filter">
        <SearchBox value={q} onChange={setQ} label="Search tasks" />
        <select className="preset-cat-filter" value={groupBy} onChange={(e) => saveTasks({ groupBy: e.target.value as TaskGroupBy })} aria-label="Group tasks by" title="Group by">
          <option value="status">By status</option>
          <option value="project">By project</option>
          {cfg.groupField && <option value="field">By {cfg.groupField}</option>}
          <option value="none">No groups</option>
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
        {(hiddenCount > 0 || showPlanned) && (
          <button className={`chip xs ${showPlanned ? "on" : ""}`} onClick={() => setShowPlanned(!showPlanned)} aria-pressed={showPlanned} title={showPlanned ? "Hide tasks already on today's plan" : "Show the tasks already on today's plan"}>
            <CalendarCheck size={10} /> {hiddenCount}
          </button>
        )}
      </div>
      <div className="ext-list tasks" aria-label="TaskNotes tasks">
        {groups.map((g) => {
          const isCollapsed = groupBy !== "none" && collapsed.has(g.key);
          return (
            <div key={g.key || "_"} className="ext-group">
              {groupBy !== "none" && (
                <button className="ext-group-head tn" onClick={() => toggleGroup(g.key)} aria-expanded={!isCollapsed} style={g.status?.color ? { ["--sc" as string]: g.status.color } : undefined}>
                  {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                  {g.status && <TnIcon name={g.status.icon} color={g.status.color} size={12} className="ext-status-ico" />}
                  <span className="ext-group-label">{g.label}</span>
                  <span className="ext-group-count">{g.items.length}</span>
                </button>
              )}
              {!isCollapsed &&
                g.items.map((t) => {
                  const proj = t.data.projects[0];
                  const st = statusOf(meta, t.data.status);
                  const pr = priorityOf(meta, t.data.priority);
                  const color = st?.color ?? ((proj && projColor.get(proj)) || null);
                  const when = shortDate(t.data.scheduled, today) ?? shortDate(t.data.due, today);
                  const overdue = !!dateOnly(t.data.due) && dateOnly(t.data.due)! < today && t.active;
                  return (
                    <div
                      key={t.ref}
                      className={`ext-row task ${dragging === t.ref ? "dragging" : ""} ${t.active ? "" : "done"} ${planned.has(t.ref) ? "planned" : ""}`}
                      style={pr?.color ? { ["--pc" as string]: pr.color } : undefined}
                      onPointerDown={(e) => beginItemDrag(e, { kind: "task", ref: t.ref, label: t.title, color, minutes: taskDragMinutes(t.data) })}
                      onDoubleClick={() => openInObsidian(t.ref)}
                      onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, ref: t.ref }))}
                      title={`${t.title}${st ? `\n${st.label}` : ""}${pr ? ` · ${pr.label}` : ""}${t.data.projectNames.length ? `\n${t.data.projectNames.join(", ")}` : ""}${t.data.due ? `\nDue ${t.data.due}` : ""}${t.data.scheduled ? `\nScheduled ${t.data.scheduled}` : ""}\nDrag onto Today · double-click opens it in Obsidian`}
                    >
                      <span className="ext-prio" aria-hidden />
                      {!t.active ? (
                        <CircleCheck size={12} className="ext-check" aria-label="Completed" />
                      ) : st ? (
                        <TnIcon name={st.icon} color={st.color} size={12} className="ext-check" />
                      ) : (
                        <Circle size={11} className="ext-check" style={color ? { color } : undefined} aria-label="Open" />
                      )}
                      <span className="ext-name">{t.title}</span>
                      {t.data.recurring && <Repeat size={10} className="ext-meta" aria-label="Recurring" />}
                      {when && <span className={`ext-meta ${overdue ? "overdue" : ""}`}>{when}</span>}
                    </div>
                  );
                })}
            </div>
          );
        })}
        {shown.length === 0 && <div className="preset-empty muted small">{tasks.length ? (hiddenCount ? "Everything here is on today's plan." : "Nothing here.") : "No tasks yet. Check Settings › Obsidian."}</div>}
      </div>
      {menu && <ExtMenu x={menu.x} y={menu.y} path={menu.ref} onClose={() => setMenu(null)} />}
    </SideSection>
  );
}
