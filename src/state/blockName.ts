// How a PLAN block is named everywhere outside the timeline (v0.11): its own title, else — for a block dragged
// from Obsidian — the live task/project title (or the last known one), else the category name.
import { store } from "./store";
import type { Block } from "../domain/types";

export function sourceTitleOf(b: Pick<Block, "sourceKind" | "sourceRef" | "sourceTitle">): string | null {
  if (!b.sourceRef) return null;
  const s = store.get();
  const live = (b.sourceKind === "project" ? s.extProjects : s.extTasks).find((x) => x.ref === b.sourceRef);
  return live?.title ?? b.sourceTitle ?? null;
}

/** Title for a session started from the block: its local name or its Obsidian title (null = the category's). */
export function blockTitle(b: Pick<Block, "title" | "sourceKind" | "sourceRef" | "sourceTitle"> | null | undefined): string | null {
  if (!b) return null;
  return b.title ?? sourceTitleOf(b);
}

export function blockName(b: Block, categoryName?: string | null): string {
  return blockTitle(b) || categoryName || "Untitled";
}
