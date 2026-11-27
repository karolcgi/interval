import { useSyncExternalStore } from "react";
import type { DbDriver } from "../db/driver";
import type { ActivityPreset, Block, Budget, PersonalAchievement, Category, DailyNote, DayTemplate, Id, Session, Settings, Tag, WeekTemplateBlock } from "../domain/types";
import type { RecurrenceRule } from "../domain/recurrence";
import type { FocusState } from "../domain/focus";
import { DEFAULT_SETTINGS } from "../domain/types";
import { startOfDay } from "../domain/time";

export type View = "calendar" | "presets" | "template" | "stats" | "budgets" | "progress" | "reviews" | "log" | "categories" | "settings";
export type CalendarMode = "day" | "week" | "month";
export type Selection = { kind: "block" | "session"; id: Id } | null;

export interface PausedTimer {
  categoryId: Id;
  blockId: Id | null;
  tagIds: Id[];
  title: string | null;
  pausedAt: number;
  accumulatedMs: number;
}

export interface SleepGap {
  sessionId: Id;
  from: number;
  to: number;
}

/** A preset being dragged from the library (pointer-driven, so it works inside the desktop webview). */
export interface PresetDrag {
  presetId: Id;
  x: number;
  y: number;
}

export interface Toast {
  id: number;
  message: string;
  undo?: boolean;
}

export interface AppState {
  ready: boolean;
  fatal: string | null;
  db: DbDriver | null;
  demo: boolean;
  storageLabel: string;
  categories: Category[];
  tags: Tag[];
  rules: RecurrenceRule[];
  templates: DayTemplate[];
  budgets: Budget[];
  achievements: PersonalAchievement[];
  settings: Settings;
  view: View;
  calendarMode: CalendarMode;
  date: number; // local midnight of the focused day
  blocks: Block[]; // loaded for the visible range
  sessions: Session[];
  today: { blocks: Block[]; sessions: Session[] };
  running: Session | null;
  paused: PausedTimer | null;
  focus: FocusState | null; // Pomodoro / Flowtime cycle, persisted as setting timer.focus
  runAccumulatedMs: number; // time from earlier segments of a paused/resumed run
  lastAlive: number | null; // last moment the timer engine ran (sleep / closed-app detection)
  selection: Selection;
  renaming: Selection; // item whose name is being edited inline on the timeline
  undoDepth: number;
  redoDepth: number;
  sleepGap: SleepGap | null;
  toast: Toast | null;
  dailyNote: DailyNote | null;
  clipboard: Block[];
  paletteOpen: boolean;
  focusMode: boolean;
  ritual: { kind: "plan" | "review"; day: number } | null; // morning planning / evening review overlay
  update: { version: string; notes: string | null; progress: number | null } | null;
  completionPopup: number | null; // browser preview: show the completion card in the app
  globalShortcutErrors: string[]; // system-wide shortcuts another app already owns
  settingsAnchor: string | null; // section to scroll to when Settings opens
  journalRev: number; // bumped when diary notes change, so views reload them
  // Presets & weekly template (v0.7)
  presets: ActivityPreset[];
  weekTemplate: WeekTemplateBlock[];
  dismissed: Set<string>; // "YYYY-MM-DD|templateBlockId" for the loaded range
  presetDrag: PresetDrag | null;
  tplSelection: Id | null; // selected block in the Template editor
  tplRenaming: Id | null;
  focusOffer: { blockId: Id; focusPresetId: string } | null; // "use this preset's focus timer?"
  presetEditing: Id | "new" | null; // preset open in the editor panel
  /** Obsidian & TaskNotes integration status (v0.10). */
  integration: IntegrationStatus;
}

export type SyncState = "off" | "connected" | "offline" | "syncing" | "error";

export interface IntegrationStatus {
  state: SyncState;
  lastSync: number | null; // last fully successful refresh
  error: string | null; // last error, shown in Settings
  tasks: number; // active cached tasks
  projects: number; // cached projects
  version: string | null; // TaskNotes version, when the API reports it
  rev: number; // bumped after each refresh so views reload the cache
}

const initial: AppState = {
  ready: false,
  fatal: null,
  db: null,
  demo: false,
  storageLabel: "",
  categories: [],
  tags: [],
  rules: [],
  templates: [],
  budgets: [],
  achievements: [],
  settings: DEFAULT_SETTINGS,
  view: "calendar",
  calendarMode: "day",
  date: startOfDay(Date.now()),
  blocks: [],
  sessions: [],
  today: { blocks: [], sessions: [] },
  running: null,
  paused: null,
  focus: null,
  runAccumulatedMs: 0,
  lastAlive: null,
  selection: null,
  renaming: null,
  undoDepth: 0,
  redoDepth: 0,
  sleepGap: null,
  toast: null,
  dailyNote: null,
  clipboard: [],
  paletteOpen: false,
  focusMode: false,
  ritual: null,
  update: null,
  completionPopup: null,
  globalShortcutErrors: [],
  journalRev: 0,
  settingsAnchor: null,
  presets: [],
  weekTemplate: [],
  dismissed: new Set(),
  presetDrag: null,
  tplSelection: null,
  tplRenaming: null,
  focusOffer: null,
  presetEditing: null,
  integration: { state: "off", lastSync: null, error: null, tasks: 0, projects: 0, version: null, rev: 0 },
};

type Listener = () => void;
let state: AppState = initial;
const listeners = new Set<Listener>();

export const store = {
  get: () => state,
  set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
    const p = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...p };
    listeners.forEach((l) => l());
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  reset() {
    state = initial;
  },
};

export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}

export function useNow(intervalMs = 1000): number {
  return useSyncExternalStore(
    (cb) => {
      const t = setInterval(cb, intervalMs);
      return () => clearInterval(t);
    },
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
  );
}
