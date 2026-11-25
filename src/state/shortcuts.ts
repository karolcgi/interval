// Rebindable single-key shortcuts. Defaults live here; the user's overrides are stored in
// settings.shortcuts (action id -> key combo). Ctrl shortcuts (undo, copy, palette…) and the arrow
// keys stay fixed because Windows users expect them.

export interface ShortcutAction {
  id: string;
  label: string;
  key: string; // default combo, e.g. "t", "f2", "ctrl+e"
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "today", label: "Jump to today", key: "t" },
  { id: "prev", label: "Previous day / week / month (also ←)", key: "j" },
  { id: "next", label: "Next day / week / month (also →)", key: "k" },
  { id: "dayView", label: "Day view", key: "d" },
  { id: "weekView", label: "Week view", key: "w" },
  { id: "monthView", label: "Month view", key: "m" },
  { id: "timer", label: "Start / stop timer (also Ctrl E)", key: "s" },
  { id: "focusMode", label: "Focus mode", key: "f" },
  { id: "focusToggle", label: "Focus timer: start / pause / resume", key: "shift+space" },
  { id: "focusSkip", label: "Focus timer: skip to the next phase", key: "n" },
  { id: "focusExtend", label: "Focus timer: add 5 minutes", key: "e" },
  { id: "miniTimer", label: "Show or hide the floating timer", key: "o" },
  { id: "confirm", label: "Confirm selected block as done", key: "c" },
  { id: "rename", label: "Rename selected block", key: "f2" },
  { id: "split", label: "Split selected block", key: "x" },
  { id: "sidebar", label: "Toggle sidebar", key: "[" },
  { id: "panel", label: "Toggle details panel", key: "]" },
  { id: "dayLog", label: "Open day log", key: "l" },
  { id: "progress", label: "Open progress", key: "p" },
  { id: "reviews", label: "Open reviews", key: "r" },
];

/** Normalised combo for a key event: "ctrl+alt+shift+key", modifiers in that order. */
export function comboOf(e: { key: string; ctrlKey: boolean; metaKey?: boolean; altKey: boolean; shiftKey: boolean }): string {
  const k = e.key === " " ? "space" : e.key.toLowerCase();
  if (["control", "alt", "shift", "meta"].includes(k)) return "";
  // Shift is implied by the character for symbols and capitals, so only record it for named keys.
  const shift = e.shiftKey && k.length > 1;
  return [e.ctrlKey || e.metaKey ? "ctrl" : "", e.altKey ? "alt" : "", shift ? "shift" : "", k].filter(Boolean).join("+");
}

export function bindings(overrides: Record<string, string>): Map<string, string> {
  const m = new Map<string, string>(); // combo -> action id
  for (const a of SHORTCUT_ACTIONS) {
    const key = overrides[a.id] ?? a.key;
    if (key) m.set(key, a.id);
  }
  return m;
}

export function keyOf(id: string, overrides: Record<string, string>): string {
  return overrides[id] ?? SHORTCUT_ACTIONS.find((a) => a.id === id)?.key ?? "";
}

/** Human label: "ctrl+e" -> "Ctrl E", "f2" -> "F2", "[" -> "[". */
export function prettyKey(combo: string): string {
  if (!combo) return "–";
  return combo
    .split("+")
    .map((p) => (p === "ctrl" ? "Ctrl" : p === "alt" ? "Alt" : p === "shift" ? "Shift" : p === "space" ? "Space" : p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

/** Keys the app reserves: they can't be assigned to an action. */
export const RESERVED = new Set(["escape", "delete", "backspace", "arrowleft", "arrowright", "tab", "enter", "ctrl+k", "ctrl+z", "ctrl+y", "ctrl+shift+z", "ctrl+d", "ctrl+c", "ctrl+v", "ctrl+e"]);
