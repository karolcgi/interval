// Creative diary notes: labels and icons shared by the completion card, the details panel and exports.
import type { EntryKind } from "./types";

export const KIND_LABEL: Record<EntryKind, string> = { note: "Note", learning: "Learning", idea: "Idea", accomplishment: "Accomplishment", milestone: "Milestone" };
/** Lucide icon names (v0.8; were emoji). Rendered with <Icon>. */
export const KIND_ICON: Record<EntryKind, string> = { note: "notebook-pen", learning: "graduation-cap", idea: "lightbulb", accomplishment: "circle-check", milestone: "flag" };
