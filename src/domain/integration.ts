// Obsidian & TaskNotes integration: configuration and pure normalisation (no I/O; unit-tested).
//
// Ownership: Obsidian owns tasks (via TaskNotes) and project notes. Interval keeps a read-only cache of them
// (`ext_items`) keyed by vault path, with the last known title, so history stays readable after a rename,
// completion or deletion. Nothing here ever writes to the vault or to TaskNotes.

export interface IntegrationConfig {
  enabled: boolean;
  /** Absolute path of the vault folder on this computer (Karol_OS). */
  vaultPath: string | null;
  /** Vault name for obsidian:// links; blank = the vault folder's name. */
  vaultName: string;
  /** TaskNotes HTTP API, e.g. http://localhost:8080. Loopback only. */
  apiUrl: string;
  projects: ProjectMapping;
  tasks: TaskMapping;
}

export type ProjectRule = "folder" | "tag" | "property";

export interface ProjectMapping {
  folder: string; // vault-relative, "" = whole vault
  rule: ProjectRule; // which notes in the folder count as projects
  ruleTag: string; // rule = "tag": notes carrying this tag (with or without #)
  ruleProperty: string; // rule = "property": this property …
  ruleValue: string; // … equals this value (blank = property present)
  titleProp: string; // blank = file name
  statusProp: string;
  activeValues: string[]; // statuses shown by default (case-insensitive)
  coverProp: string;
  categoryProp: string;
  clientProp: string;
  colorProp: string;
}

export interface TaskMapping {
  projectField: string; // task property linking to project notes
  groupField: string; // default grouping property (e.g. a TaskNotes user field)
  categoryField: string; // property used for the colour / category
  completedStatuses: string[]; // fallback when TaskNotes doesn't say whether a status is completed
  showCompleted: boolean;
  defaultFilter: TaskFilter;
  /** Sidebar grouping (v0.11); "field" = groupField. Unset = by groupField when one is configured. */
  groupBy?: "none" | "field" | "project" | "status";
  /** v0.12: offer "Mark task completed" after a session (explicit click only). Unset = on. */
  writeBack?: boolean;
}

export type TaskFilter = "today" | "overdue" | "upcoming" | "unscheduled" | "project" | "all";

export const DEFAULT_INTEGRATION: IntegrationConfig = {
  enabled: false,
  vaultPath: null,
  vaultName: "",
  apiUrl: "http://localhost:8080",
  projects: {
    folder: "Projects",
    rule: "folder",
    ruleTag: "project",
    ruleProperty: "type",
    ruleValue: "project",
    titleProp: "",
    statusProp: "status",
    activeValues: ["Active"],
    coverProp: "cover",
    categoryProp: "category",
    clientProp: "client",
    colorProp: "color",
  },
  tasks: {
    projectField: "projects",
    groupField: "",
    categoryField: "",
    completedStatuses: ["done", "completed"],
    showCompleted: false,
    defaultFilter: "today",
  },
};

/** Fills in keys added after the config was saved (nested objects included). */
export function withDefaults(c: Partial<IntegrationConfig> | null | undefined): IntegrationConfig {
  const d = DEFAULT_INTEGRATION;
  return {
    ...d,
    ...(c ?? {}),
    projects: { ...d.projects, ...(c?.projects ?? {}) },
    tasks: { ...d.tasks, ...(c?.tasks ?? {}) },
  };
}

export function vaultNameOf(c: IntegrationConfig): string {
  if (c.vaultName.trim()) return c.vaultName.trim();
  const parts = (c.vaultPath ?? "").split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** obsidian://open link for a vault-relative note path. */
export function obsidianUri(vault: string, path: string): string {
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(path.replace(/\.md$/i, ""))}`;
}

// ------------------------------------------------------------------ cached items

export interface ExtProject {
  ref: string; // vault-relative path
  title: string;
  status: string | null;
  active: boolean;
  cover: string | null;
  category: string | null;
  client: string | null;
  color: string | null;
  tags: string[];
}

export interface ExtTask {
  ref: string; // vault-relative path (TaskNotes' id)
  uid: string | null; // stable id when TaskNotes provides one (v5)
  title: string;
  status: string | null;
  completed: boolean;
  archived: boolean;
  priority: string | null;
  due: string | null; // YYYY-MM-DD or ISO datetime, as TaskNotes stores it
  scheduled: string | null;
  recurring: boolean;
  completeInstances: string[];
  projects: string[]; // resolved project paths (or raw link text when unresolved)
  projectNames: string[]; // link text as written, for display
  group: string | null;
  category: string | null;
  tags: string[];
  contexts: string[];
}

// ------------------------------------------------------------------ helpers

function str(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return str(v[0]);
  return null;
}

function list(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(str).filter((x): x is string => !!x);
  const s = str(v);
  return s ? [s] : [];
}

/** Case-insensitive property lookup (Obsidian property names are case-insensitive). */
function prop(obj: Record<string, unknown> | null | undefined, key: string): unknown {
  if (!obj || !key) return undefined;
  if (key in obj) return obj[key];
  const k = key.toLowerCase();
  for (const [name, v] of Object.entries(obj)) if (name.toLowerCase() === k) return v;
  return undefined;
}

export function baseName(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.md$/i, "");
}

/** `[[Projects/Roger AMEX|Roger]]` → { target: "Projects/Roger AMEX", label: "Roger" }. Plain text passes through. */
export function parseLink(raw: string): { target: string; label: string } {
  let s = raw.trim();
  const md = /^\[([^\]]*)\]\(([^)]+)\)$/.exec(s); // [label](path.md)
  if (md) {
    const target = decodeURIComponent(md[2]).replace(/\.md$/i, "");
    return { target, label: md[1] || baseName(target) };
  }
  if (s.startsWith("[[") && s.endsWith("]]")) s = s.slice(2, -2);
  const [targetPart, label] = s.split("|");
  const target = targetPart.split("#")[0].trim().replace(/\.md$/i, "");
  return { target, label: (label ?? "").trim() || baseName(target) };
}

/**
 * Resolves a link to a project path the way Obsidian does for the common cases: an exact path match first,
 * then a unique file-name match. Ambiguous or unknown links return null.
 */
export function resolveProject(link: string, projectPaths: string[]): string | null {
  const { target } = parseLink(link);
  if (!target) return null;
  const t = target.toLowerCase();
  const exact = projectPaths.find((p) => p.replace(/\.md$/i, "").toLowerCase() === t);
  if (exact) return exact;
  const byName = projectPaths.filter((p) => baseName(p).toLowerCase() === baseName(target).toLowerCase());
  if (byName.length === 1) return byName[0];
  const bySuffix = projectPaths.filter((p) => p.replace(/\.md$/i, "").toLowerCase().endsWith("/" + t));
  return bySuffix.length === 1 ? bySuffix[0] : null;
}

// ------------------------------------------------------------------ projects

export interface ScannedNote {
  path: string;
  mtime: number;
  frontmatter: Record<string, unknown> | null;
  unchanged?: boolean;
  error?: string | null;
}

function tagsOf(fm: Record<string, unknown> | null): string[] {
  return list(prop(fm, "tags")).flatMap((t) => t.split(/[\s,]+/)).map((t) => t.replace(/^#/, "").toLowerCase()).filter(Boolean);
}

/** Whether a note in the projects folder is a project under the configured rule. */
export function isProjectNote(note: ScannedNote, m: ProjectMapping): boolean {
  const fm = note.frontmatter;
  if (m.rule === "folder") return true;
  if (m.rule === "tag") {
    const want = m.ruleTag.replace(/^#/, "").toLowerCase();
    return !!want && tagsOf(fm).some((t) => t === want || t.startsWith(want + "/"));
  }
  const v = prop(fm, m.ruleProperty);
  if (v === undefined || v === null) return false;
  if (!m.ruleValue.trim()) return true;
  return list(v).some((x) => parseLink(x).target.toLowerCase() === m.ruleValue.trim().toLowerCase());
}

export function normalizeProject(note: ScannedNote, m: ProjectMapping): ExtProject {
  const fm = note.frontmatter;
  const status = str(prop(fm, m.statusProp));
  const active = !!status && m.activeValues.some((a) => a.trim().toLowerCase() === status.toLowerCase());
  const link = (v: unknown) => {
    const s = str(v);
    if (!s) return null;
    return s.startsWith("[[") ? parseLink(s).label : s;
  };
  return {
    ref: note.path,
    title: str(prop(fm, m.titleProp)) ?? baseName(note.path),
    status,
    active,
    cover: m.coverProp ? str(prop(fm, m.coverProp)) : null,
    category: m.categoryProp ? link(prop(fm, m.categoryProp)) : null,
    client: m.clientProp ? link(prop(fm, m.clientProp)) : null,
    color: m.colorProp ? str(prop(fm, m.colorProp)) : null,
    tags: tagsOf(fm),
  };
}

// ------------------------------------------------------------------ tasks

/** The task list out of a TaskNotes response (`{success, data: {tasks}}`, or a bare array). */
export function tasksOf(body: unknown): Record<string, unknown>[] | null {
  const b = body as Record<string, unknown> | null;
  const data = (b && typeof b === "object" && "data" in b ? b.data : b) as Record<string, unknown> | unknown[] | null;
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && Array.isArray((data as Record<string, unknown>).tasks)) return (data as { tasks: Record<string, unknown>[] }).tasks;
  return null;
}

function field(raw: Record<string, unknown>, key: string): unknown {
  if (!key) return undefined;
  const direct = prop(raw, key);
  if (direct !== undefined) return direct;
  for (const bag of ["customProperties", "userFields", "frontmatter"]) {
    const v = prop(raw[bag] as Record<string, unknown> | undefined, key.replace(/^user:/, ""));
    if (v !== undefined) return v;
  }
  return undefined;
}

export function normalizeTask(raw: Record<string, unknown>, m: TaskMapping, projectPaths: string[]): ExtTask | null {
  const ref = str(raw.path) ?? str(raw.id);
  if (!ref) return null;
  const uidRaw = str(raw.uid) ?? str(raw.uuid) ?? (str(raw.id) && str(raw.id) !== ref && !String(raw.id).endsWith(".md") ? str(raw.id) : null);
  const status = str(raw.status);
  const statusCompleted = (raw as { isCompleted?: unknown }).isCompleted;
  const completed =
    typeof statusCompleted === "boolean"
      ? statusCompleted
      : !!status && m.completedStatuses.some((c) => c.trim().toLowerCase() === status.toLowerCase());
  const projectNames = list(field(raw, m.projectField || "projects"));
  return {
    ref,
    uid: uidRaw,
    title: str(raw.title) ?? baseName(ref),
    status,
    completed,
    archived: raw.archived === true || list(raw.tags).some((t) => t.toLowerCase() === "archived"),
    priority: str(raw.priority),
    due: str(raw.due),
    scheduled: str(raw.scheduled),
    recurring: !!str(raw.recurrence),
    completeInstances: list(raw.complete_instances ?? raw.completeInstances),
    projects: projectNames.map((p) => resolveProject(p, projectPaths) ?? parseLink(p).target),
    projectNames: projectNames.map((p) => parseLink(p).label),
    group: m.groupField ? str(field(raw, m.groupField)) : null,
    category: m.categoryField ? str(field(raw, m.categoryField)) : null,
    tags: list(raw.tags).map((t) => t.replace(/^#/, "")),
    contexts: list(raw.contexts),
  };
}

/** The local day (YYYY-MM-DD) of a TaskNotes date or datetime. */
export function dateOnly(v: string | null): string | null {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1] : null;
}

/** Sidebar filter (used from Phase 2; kept here so it's tested with the normalisation). */
export function matchesFilter(t: ExtTask, f: TaskFilter, today: string, projectRef?: string): boolean {
  const when = dateOnly(t.scheduled) ?? dateOnly(t.due);
  const due = dateOnly(t.due);
  switch (f) {
    case "today":
      return (!!when && when <= today && !t.completed) || dateOnly(t.scheduled) === today || due === today;
    case "overdue":
      return !t.completed && ((!!due && due < today) || (!due && !!when && when < today));
    case "upcoming":
      return !!when && when > today;
    case "unscheduled":
      return !t.scheduled && !t.due;
    case "project":
      return !!projectRef && t.projects.includes(projectRef);
    default:
      return true;
  }
}

// ------------------------------------------------------------------ TaskNotes queries

/** FilterQuery for active (not completed, not archived) tasks, sorted by due date. */
export function activeTasksQuery() {
  return {
    type: "group",
    id: "root",
    conjunction: "and",
    children: [
      { type: "condition", id: "c1", property: "archived", operator: "is-not-checked", value: null },
      { type: "condition", id: "c2", property: "status.isCompleted", operator: "is-not-checked", value: null },
    ],
    sortKey: "due",
    sortDirection: "asc",
  };
}

/** FilterQuery for tasks completed on or after `since` (YYYY-MM-DD), so a just-completed task shows as done. */
export function recentlyCompletedQuery(since: string) {
  return {
    type: "group",
    id: "root",
    conjunction: "and",
    children: [
      { type: "condition", id: "c1", property: "status.isCompleted", operator: "is-checked", value: null },
      { type: "condition", id: "c2", property: "completedDate", operator: "is-on-or-after", value: since },
    ],
    sortKey: "due",
    sortDirection: "asc",
  };
}

/** Keeps what the cache should hold from an unfiltered list (fallback for TaskNotes versions without /query). */
export function keepFromFullList(t: ExtTask, raw: Record<string, unknown>, since: string): boolean {
  if (t.archived) return false;
  if (!t.completed) return true;
  const done = dateOnly(str(raw.completedDate));
  return !!done && done >= since;
}

// ------------------------------------------------------------------ PLAN blocks from tasks / projects (v0.11)

interface CatLike {
  id: string;
  name: string;
  isBreak: boolean;
  archivedAt: number | null;
  parentId: string | null;
}

/**
 * The activity a dropped task or project gets: the first hint (task category/group, project category/client)
 * that names an activity (exact, then one containing the other), else the first non-break activity.
 * A PLAN block is a sketch, so this only decides its default colour; it can be changed like any block.
 */
export function pickCategory(hints: Array<string | null | undefined>, categories: CatLike[]): string | null {
  const live = categories.filter((c) => !c.archivedAt && !c.isBreak);
  for (const h of hints) {
    const t = h?.trim().toLowerCase();
    if (!t) continue;
    const exact = live.find((c) => c.name.toLowerCase() === t);
    if (exact) return exact.id;
    const near = live.find((c) => c.name.toLowerCase().includes(t) || t.includes(c.name.toLowerCase()));
    if (near) return near.id;
  }
  return (live.find((c) => !c.parentId) ?? live[0])?.id ?? null;
}

/** Valid CSS hex colour from a note property, else null. */
export function hexColor(v: string | null | undefined): string | null {
  const s = v?.trim() ?? "";
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s)) return s;
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s}`;
  return null;
}

/** Visual size for a dropped task: its TaskNotes time estimate when sensible (5 min – 8 h), else the default. */
export function taskMinutes(raw: unknown, fallback: number): number {
  const est = Number((raw as { timeEstimate?: unknown } | null)?.timeEstimate);
  return Number.isFinite(est) && est >= 5 && est <= 480 ? Math.round(est) : fallback;
}

/** The title a PLAN block shows: local rename, else the live source title, else the last known one. */
export function blockLabel(b: { title: string | null; sourceRef?: string | null; sourceTitle?: string | null }, live: string | null | undefined, fallback: string): string {
  return b.title || (b.sourceRef ? (live ?? b.sourceTitle) : null) || fallback;
}

export type TaskGroupBy = "none" | "field" | "project" | "status";

/** Groups tasks for the sidebar, keeping the incoming order inside each group. Empty values go last. */
export function groupTasks<T extends { data: ExtTask }>(tasks: T[], by: TaskGroupBy, projectTitle: (ref: string) => string): Array<{ key: string; items: T[] }> {
  if (by === "none") return [{ key: "", items: tasks }];
  const m = new Map<string, T[]>();
  for (const t of tasks) {
    const k = by === "field" ? (t.data.group ?? "") : by === "status" ? (t.data.status ?? "") : t.data.projects[0] ? projectTitle(t.data.projects[0]) : "";
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(t);
  }
  return [...m.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b))).map(([key, items]) => ({ key, items }));
}

// ------------------------------------------------------------------ TaskNotes statuses & priorities (v0.12)

/** A TaskNotes status as `/api/filter-options` reports it (value is what's written to the note). */
export interface TnStatus {
  value: string;
  label: string;
  color: string | null;
  icon: string | null; // Lucide name without the "lucide-" prefix
  isCompleted: boolean;
  order: number;
}
export interface TnPriority {
  value: string;
  label: string;
  color: string | null;
  weight: number;
}
export interface TnMeta {
  statuses: TnStatus[];
  priorities: TnPriority[];
}

/** Statuses and priorities out of a `/api/filter-options` response. Unknown shapes give empty lists. */
export function metaOf(body: unknown): TnMeta {
  const b = body as Record<string, unknown> | null;
  const data = (b && typeof b === "object" && "data" in b ? b.data : b) as Record<string, unknown> | null;
  const arr = (k: string) => (data && Array.isArray(data[k]) ? (data[k] as Record<string, unknown>[]) : []);
  const statuses = arr("statuses")
    .map((s, i) => ({
      value: str(s.value) ?? "",
      label: str(s.label) ?? str(s.value) ?? "",
      color: hexColor(str(s.color)),
      icon: str(s.icon)?.replace(/^lucide-/, "") ?? null,
      isCompleted: s.isCompleted === true || s.completed === true,
      order: Number.isFinite(Number(s.order)) ? Number(s.order) : i,
    }))
    .filter((s) => s.value)
    .sort((a, b) => a.order - b.order);
  const priorities = arr("priorities")
    .map((p, i) => ({ value: str(p.value) ?? "", label: str(p.label) ?? str(p.value) ?? "", color: hexColor(str(p.color)), weight: Number.isFinite(Number(p.weight)) ? Number(p.weight) : i }))
    .filter((p) => p.value);
  return { statuses, priorities };
}

export function statusOf(meta: TnMeta | null | undefined, value: string | null | undefined): TnStatus | null {
  if (!meta || !value) return null;
  const v = value.toLowerCase();
  return meta.statuses.find((s) => s.value.toLowerCase() === v) ?? null;
}

export function priorityOf(meta: TnMeta | null | undefined, value: string | null | undefined): TnPriority | null {
  if (!meta || !value) return null;
  const v = value.toLowerCase();
  return meta.priorities.find((p) => p.value.toLowerCase() === v) ?? null;
}

/**
 * Groups tasks by TaskNotes status, in TaskNotes' own order (the order of its status list), with the status
 * label as the heading. Statuses TaskNotes doesn't know go after, alphabetically; tasks without one last.
 */
export function groupByStatus<T extends { data: ExtTask }>(tasks: T[], meta: TnMeta | null | undefined): Array<{ key: string; label: string; status: TnStatus | null; items: T[] }> {
  const m = new Map<string, T[]>();
  for (const t of tasks) {
    const k = (t.data.status ?? "").toLowerCase();
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(t);
  }
  const rank = (k: string) => {
    if (!k) return 1e9;
    const i = meta?.statuses.findIndex((s) => s.value.toLowerCase() === k) ?? -1;
    return i >= 0 ? i : 1e6;
  };
  return [...m.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([key, items]) => {
      const status = statusOf(meta, key);
      return { key, label: status?.label ?? (items[0].data.status || "No status"), status, items };
    });
}

/** The status value to write when explicitly completing a task: TaskNotes' first completed status. */
export function completedStatusValue(meta: TnMeta | null | undefined, fallback: string[]): string {
  return meta?.statuses.find((s) => s.isCompleted)?.value ?? fallback[0] ?? "done";
}

// ------------------------------------------------------------------ projects folder / .base (v0.12)

export interface ProjectSource {
  /** Folder to scan, vault-relative ("" = whole vault). */
  folder: string;
  /** Vault-relative path of an Obsidian Bases file whose filters decide what's a project, else null. */
  base: string | null;
}

/**
 * Normalises what was typed in "Projects folder": a vault-relative folder, a full path on this computer (inside
 * the vault), or a `.base` file. Backslashes become slashes; a path outside the vault is returned as given so
 * the scan can report it.
 */
export function projectSource(input: string, vaultPath: string | null): ProjectSource {
  let p = input.trim().replace(/^["']|["']$/g, "").replace(/\\/g, "/");
  const vault = (vaultPath ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (vault && p.toLowerCase().startsWith(vault.toLowerCase() + "/")) p = p.slice(vault.length + 1);
  else if (vault && p.toLowerCase() === vault.toLowerCase()) p = "";
  p = p.replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
  if (/\.base$/i.test(p)) return { folder: "", base: p };
  if (/\.md$/i.test(p)) p = p.split("/").slice(0, -1).join("/"); // a note was pasted: use its folder
  return { folder: p, base: null };
}

/** True when the text looks like an absolute path (Windows drive, UNC or POSIX). */
export function isAbsolutePath(p: string): boolean {
  return /^[a-z]:[\\/]/i.test(p.trim()) || /^[\\/]{2}/.test(p.trim()) || p.trim().startsWith("/");
}

// ------------------------------------------------------------------ Obsidian Bases filters (v0.12)
//
// A small, safe evaluator for the filter expressions Bases files commonly use, e.g.
//   and: [ 'type.contains("project")', '!file.folder.contains("98_ARCHIVE")', 'file.hasTag("project")' ]
// Supported: and / or / not groups; `!`; property (`x`, `note.x`) and file fields (`file.name`, `file.path`,
// `file.folder`, `file.ext`, `file.tags`); methods contains, containsAny, containsAll, startsWith, endsWith,
// isEmpty, hasTag, inFolder, hasProperty; comparisons == and != against a string, number or boolean.
// Anything else is reported as unsupported and treated as matching, so a partly understood base shows more
// notes, never fewer.

export interface BaseInfo {
  filters: unknown;
  groupBy: string | null; // property name the first kanban/grouped view groups by (without "note.")
  columns: string[]; // column order of that grouping, when the base stores one
  cardOrder: Record<string, string[]>; // per column, vault-relative note paths in the order of the board
  imageProperty: string | null;
  unsupported: string[];
}

function stripNote(p: string): string {
  return p.replace(/^note\./, "").replace(/^formula\./, "");
}

/** Reads the parts of a parsed `.base` file Interval uses. */
export function baseInfo(yaml: unknown): BaseInfo {
  const y = (yaml ?? {}) as Record<string, unknown>;
  const views = Array.isArray(y.views) ? (y.views as Record<string, unknown>[]) : [];
  const v = views.find((x) => typeof x.groupByProperty === "string") ?? views.find((x) => x.groupBy) ?? views[0] ?? {};
  const gRaw = typeof v.groupByProperty === "string" ? v.groupByProperty : typeof (v.groupBy as { property?: unknown })?.property === "string" ? String((v.groupBy as { property: string }).property) : null;
  const columnOrders = (v.columnOrders ?? {}) as Record<string, unknown>;
  const cardOrders = (v.cardOrders ?? {}) as Record<string, unknown>;
  const cols = gRaw && Array.isArray(columnOrders[gRaw]) ? (columnOrders[gRaw] as unknown[]).map(String) : [];
  const cardOrder: Record<string, string[]> = {};
  const co = gRaw ? (cardOrders[gRaw] as Record<string, unknown> | undefined) : undefined;
  if (co && typeof co === "object") for (const [k, list] of Object.entries(co)) if (Array.isArray(list)) cardOrder[k] = list.map(String);
  const filters = { and: [y.filters, v.filters].filter((f) => f != null) };
  const unsupported: string[] = [];
  collectUnsupported(filters, unsupported);
  return {
    filters,
    groupBy: gRaw ? stripNote(gRaw) : null,
    columns: cols,
    cardOrder,
    imageProperty: typeof v.imageProperty === "string" ? stripNote(v.imageProperty) : null,
    unsupported,
  };
}

export interface NoteFacts {
  path: string; // vault-relative
  frontmatter: Record<string, unknown> | null;
}

type Val = unknown;

function fileField(n: NoteFacts, f: string): Val {
  const path = n.path;
  const name = path.split("/").pop() ?? path;
  switch (f) {
    case "name":
      return name;
    case "basename":
      return name.replace(/\.[^.]+$/, "");
    case "path":
      return path;
    case "folder":
      return path.split("/").slice(0, -1).join("/");
    case "ext":
      return (/\.([^.]+)$/.exec(name)?.[1] ?? "").toLowerCase();
    case "tags":
      return tagsOf(n.frontmatter);
    default:
      return undefined;
  }
}

function lhsValue(n: NoteFacts, lhs: string): { ok: boolean; v: Val } {
  const m = /^file\.(\w+)$/.exec(lhs);
  if (m) {
    const v = fileField(n, m[1]);
    return { ok: v !== undefined, v };
  }
  if (/^(note\.)?[\p{L}\p{N}_\- ]+$/u.test(lhs) || /^note\["[^"]+"\]$/.test(lhs)) {
    const key = lhs.startsWith('note["') ? lhs.slice(6, -2) : stripNote(lhs);
    return { ok: true, v: prop(n.frontmatter, key) };
  }
  return { ok: false, v: undefined };
}

function parseArgs(s: string): Val[] | null {
  const out: Val[] = [];
  const re = /\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(-?\d+(?:\.\d+)?)|(true|false))\s*(,|$)/y;
  let i = 0;
  if (!s.trim()) return out;
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) return null;
    out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2] !== undefined ? m[2].replace(/\\(.)/g, "$1") : m[3] !== undefined ? Number(m[3]) : m[4] === "true");
    i = re.lastIndex;
    if (!m[5]) break;
  }
  return out;
}

const lc = (v: Val) => (typeof v === "string" ? v.toLowerCase() : v);
/** Obsidian link text compares by its target: "[[Roger AMEX]]" equals "Roger AMEX". */
function linkText(s: string): string {
  return s.startsWith("[[") ? parseLink(s).target : s;
}

function callMethod(v: Val, method: string, args: Val[], n: NoteFacts): boolean | null {
  const a0 = args[0];
  switch (method) {
    case "contains":
      if (Array.isArray(v)) return v.some((x) => lc(linkText(String(x))) === lc(String(a0)) || String(x).toLowerCase() === String(a0).toLowerCase());
      return v != null && String(v).toLowerCase().includes(String(a0).toLowerCase());
    case "containsAny":
      return args.some((x) => callMethod(v, "contains", [x], n));
    case "containsAll":
      return args.every((x) => callMethod(v, "contains", [x], n));
    case "startsWith":
      return v != null && String(v).toLowerCase().startsWith(String(a0).toLowerCase());
    case "endsWith":
      return v != null && String(v).toLowerCase().endsWith(String(a0).toLowerCase());
    case "isEmpty":
      return v == null || v === "" || (Array.isArray(v) && v.length === 0);
    default:
      return null;
  }
}

/** Evaluates one expression string; null = not understood. */
export function evalExpr(expr: string, n: NoteFacts): boolean | null {
  let e = expr.trim();
  let neg = false;
  while (e.startsWith("!")) (neg = !neg), (e = e.slice(1).trim());
  if (e.startsWith("(") && e.endsWith(")")) e = e.slice(1, -1).trim();
  const r = evalPositive(e, n);
  return r === null ? null : neg ? !r : r;
}

function evalPositive(e: string, n: NoteFacts): boolean | null {
  // file.hasTag("a", "b"), file.inFolder("x"), file.hasProperty("x")
  let m = /^file\.(hasTag|inFolder|hasProperty|hasLink)\((.*)\)$/.exec(e);
  if (m) {
    const args = parseArgs(m[2]);
    if (!args) return null;
    if (m[1] === "hasTag") {
      const tags = tagsOf(n.frontmatter);
      return args.some((a) => {
        const t = String(a).replace(/^#/, "").toLowerCase();
        return tags.some((x) => x === t || x.startsWith(t + "/"));
      });
    }
    if (m[1] === "inFolder") {
      const folder = String(fileField(n, "folder")).toLowerCase();
      const want = String(args[0]).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
      return !want || folder === want || folder.startsWith(want + "/");
    }
    if (m[1] === "hasProperty") return prop(n.frontmatter, String(args[0])) !== undefined;
    return null;
  }
  // <lhs>.<method>(args)
  m = /^(.+?)\.(contains|containsAny|containsAll|startsWith|endsWith|isEmpty)\((.*)\)$/.exec(e);
  if (m) {
    const l = lhsValue(n, m[1].trim());
    const args = parseArgs(m[3]);
    if (!l.ok || !args) return null;
    return callMethod(l.v, m[2], args, n);
  }
  // <lhs> == / != <literal>
  m = /^(.+?)\s*(==|!=)\s*(.+)$/.exec(e);
  if (m) {
    const l = lhsValue(n, m[1].trim());
    const args = parseArgs(m[3]);
    if (!l.ok || !args || args.length !== 1) return null;
    const want = args[0];
    const vals = Array.isArray(l.v) ? l.v : [l.v];
    const eq = vals.some((x) => (typeof want === "string" ? x != null && linkText(String(x)).toLowerCase() === want.toLowerCase() : x === want || String(x) === String(want)));
    return m[2] === "==" ? eq : !eq;
  }
  // a bare property: truthy when set
  const l = lhsValue(n, e);
  if (l.ok && !e.startsWith("file.")) return l.v != null && l.v !== false && l.v !== "";
  return null;
}

function collectUnsupported(f: unknown, out: string[]) {
  if (typeof f === "string") {
    if (evalExpr(f, { path: "x.md", frontmatter: {} }) === null) out.push(f);
    return;
  }
  if (Array.isArray(f)) return f.forEach((x) => collectUnsupported(x, out));
  if (f && typeof f === "object") for (const v of Object.values(f)) collectUnsupported(v, out);
}

/** Whether a note passes a Bases filter tree. Unsupported expressions count as passing. */
export function matchesBase(f: unknown, n: NoteFacts): boolean {
  if (f == null) return true;
  if (typeof f === "string") return evalExpr(f, n) ?? true;
  if (Array.isArray(f)) return f.every((x) => matchesBase(x, n));
  if (typeof f === "object") {
    const o = f as Record<string, unknown>;
    if (Array.isArray(o.and)) return o.and.every((x) => matchesBase(x, n));
    if (Array.isArray(o.or)) return o.or.length === 0 || o.or.some((x) => matchesBase(x, n));
    if (Array.isArray(o.not)) return !o.not.some((x) => matchesBase(x, n));
  }
  return true;
}

// ------------------------------------------------------------------ projects board (v0.12)

export interface BoardColumn<T> {
  key: string; // status value as written in the notes ("" = no status)
  items: T[];
}

/**
 * Columns for the Projects board: the base's column order first (when the projects come from a .base),
 * then any other status found, then "no status". Inside a column: the base's card order, then by title.
 */
export function projectColumns<T extends { ref: string; title: string; status: string | null }>(projects: T[], columns: string[], cardOrder: Record<string, string[]> = {}): BoardColumn<T>[] {
  const byKey = new Map<string, T[]>();
  const canon = new Map<string, string>(); // lower-case → first spelling
  for (const c of columns) canon.set(c.toLowerCase(), c);
  for (const p of projects) {
    const raw = p.status?.trim() ?? "";
    const k = raw ? (canon.get(raw.toLowerCase()) ?? raw) : "";
    if (raw && !canon.has(raw.toLowerCase())) canon.set(raw.toLowerCase(), raw);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(p);
  }
  const keys = [...columns, ...[...byKey.keys()].filter((k) => k && !columns.includes(k)).sort((a, b) => a.localeCompare(b))];
  if (byKey.has("")) keys.push("");
  return keys.map((key) => {
    const items = byKey.get(key) ?? [];
    const order = cardOrder[key] ?? [];
    const pos = (ref: string) => {
      const i = order.findIndex((o) => o === ref || ref.endsWith("/" + o) || o.endsWith("/" + ref));
      return i < 0 ? 1e9 : i;
    };
    return { key, items: [...items].sort((a, b) => pos(a.ref) - pos(b.ref) || a.title.localeCompare(b.title)) };
  });
}

// ------------------------------------------------------------------ vault folder check (v0.12)

/**
 * The vault folder is one level too high when it holds a sub-folder that is itself a vault and either matches
 * the vault TaskNotes reports, or is the only sub-vault with TaskNotes installed. Returns that folder's name.
 */
export function nestedVaultHint(probe: { tasknotes: boolean; children: Array<{ name: string; tasknotes: boolean }> }, reportedVault: string | null): string | null {
  const byName = reportedVault ? probe.children.find((c) => c.name.toLowerCase() === reportedVault.toLowerCase()) : undefined;
  if (byName) return byName.name;
  if (!probe.tasknotes) {
    const withTn = probe.children.filter((c) => c.tasknotes);
    if (withTn.length === 1) return withTn[0].name;
  }
  return null;
}

/** Joins a folder and a child name with the folder's own separator. */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.replace(/[\\/]+$/, "") + sep + name;
}

/** Cover link from a frontmatter value: "[[img.webp|200]]" → "img.webp"; ![](x.png) → "x.png"; URLs pass through. */
export function coverTarget(v: string | null | undefined): string | null {
  const s = v?.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  const md = /^!?\[[^\]]*\]\(([^)]+)\)$/.exec(s);
  if (md) return decodeURIComponent(md[1].trim());
  const wl = /^!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/.exec(s);
  if (wl) return wl[1].trim();
  return s;
}
