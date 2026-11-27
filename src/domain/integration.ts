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
