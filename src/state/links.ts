// v0.12 (integration Phase 3): which Obsidian task / project a session is about. Suggestions only: choosing a
// task suggests its project and an activity; everything stays optional and can be overridden.
import { store } from "./store";
import { pickCategory, statusOf } from "../domain/integration";
import type { Id } from "../domain/types";

export interface Links {
  taskRef: string | null;
  taskTitle: string | null;
  projectRef: string | null;
  projectTitle: string | null;
}

export const NO_LINKS: Links = { taskRef: null, taskTitle: null, projectRef: null, projectTitle: null };

export function projectTitleOf(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const p = store.get().extProjects.find((x) => x.ref === ref);
  return p?.title ?? ref.split("/").pop()!.replace(/\.md$/i, "");
}

/** The activity a task/project hints at (its category, group, TaskNotes status, project category/client), only when one matches. */
export function suggestedCategory(hints: Array<string | null | undefined>): Id | null {
  const cats = store.get().categories;
  const clean = hints.filter((h): h is string => !!h?.trim());
  if (!clean.length) return null;
  const fallback = pickCategory([], cats);
  const hit = pickCategory(clean, cats);
  if (hit !== fallback) return hit;
  // The fallback itself may be a real match: check it by name.
  const fb = cats.find((c) => c.id === fallback);
  return fb && clean.some((h) => fb.name.toLowerCase().includes(h.toLowerCase()) || h.toLowerCase().includes(fb.name.toLowerCase())) ? fallback : null;
}

export function linksForTask(ref: string): Links & { categoryId: Id | null } {
  const s = store.get();
  const t = s.extTasks.find((x) => x.ref === ref);
  const projectRef = t?.data.projects[0] ?? null;
  const p = projectRef ? s.extProjects.find((x) => x.ref === projectRef) : null;
  const st = statusOf(s.extMeta, t?.data.status);
  return {
    taskRef: ref,
    taskTitle: t?.title ?? ref.split("/").pop()!.replace(/\.md$/i, ""),
    projectRef,
    projectTitle: p?.title ?? t?.data.projectNames[0] ?? null,
    categoryId: suggestedCategory([t?.data.category, t?.data.group, st?.label, t?.data.status, p?.data.category, p?.data.client]),
  };
}

export function linksForProject(ref: string): Links & { categoryId: Id | null } {
  const p = store.get().extProjects.find((x) => x.ref === ref);
  return { taskRef: null, taskTitle: null, projectRef: ref, projectTitle: projectTitleOf(ref), categoryId: suggestedCategory([p?.data.category, p?.data.client]) };
}
