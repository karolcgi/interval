// Creative diary notes: labels and icons shared by the completion card, the details panel and exports.
import type { EntryKind } from "./types";

export const KIND_LABEL: Record<EntryKind, string> = { note: "Note", learning: "Learning", idea: "Idea", accomplishment: "Accomplishment", milestone: "Milestone" };
export const KIND_ICON: Record<EntryKind, string> = { note: "📝", learning: "📚", idea: "💡", accomplishment: "✅", milestone: "🏆" };
