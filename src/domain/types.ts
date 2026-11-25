import { DEFAULT_FOCUS_PRESETS, type FocusPreset } from "./focus";

// Core domain types. All timestamps are UTC epoch milliseconds.
// `tz` records the IANA zone the user was in when the record was created,
// so history stays interpretable after travel or DST changes.

export type Id = string;

export type BlockStatus = "planned" | "in_progress" | "completed" | "skipped";
export type SessionMode = "manual" | "stopwatch" | "pomodoro" | "flowtime";

export interface Category {
  id: Id;
  name: string;
  color: string; // hex, e.g. #8298d7
  icon: string | null; // lucide icon name
  parentId: Id | null; // optional subcategory parent
  sortOrder: number;
  shortcut: string | null; // single key, e.g. "1" or "f"
  isBreak: boolean; // break categories are reported separately from recorded time
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Tag {
  id: Id;
  name: string;
  color: string | null;
  archivedAt: number | null;
  createdAt: number;
}

/** A planned time block: an intention on the calendar. Never counted as recorded time. */
export interface Block {
  id: Id;
  startAt: number;
  endAt: number;
  tz: string;
  categoryId: Id;
  title: string | null;
  notes: string | null;
  link: string | null; // e.g. obsidian://open?vault=...&file=...
  status: BlockStatus;
  recurrenceId: Id | null;
  tagIds: Id[];
  createdAt: number;
  updatedAt: number;
}

/** An actual recorded session: what really happened. endAt === null means it is running. */
export interface Session {
  id: Id;
  startAt: number;
  endAt: number | null;
  tz: string;
  categoryId: Id;
  blockId: Id | null;
  title: string | null;
  notes: string | null;
  mode: SessionMode;
  tagIds: Id[];
  createdAt: number;
  updatedAt: number;
}

export interface DailyNote {
  date: string; // YYYY-MM-DD in local calendar
  intention: string | null;
  reflection: string | null;
  plannedAt: number | null; // morning planning finished
  reviewedAt: number | null; // evening review finished
  updatedAt: number;
}

export type BudgetPeriod = "day" | "week" | "month" | "year" | "lifetime";

/** A time budget: a minimum target and/or a maximum limit for a category or tag over a period. */
export interface Budget {
  id: Id;
  targetType: "category" | "tag";
  targetId: Id;
  period: BudgetPeriod;
  minMinutes: number | null;
  maxMinutes: number | null;
  archivedAt: number | null;
  createdAt: number;
}

/** A personal achievement confirmed by hand, optionally tied to a skill (tag) or area (category). */
export interface PersonalAchievement {
  id: Id;
  title: string;
  note: string | null;
  targetType: "category" | "tag" | null;
  targetId: Id | null;
  achievedOn: string; // YYYY-MM-DD
  createdAt: number;
}

/** One focus or break phase run by the focus timer (history for focus statistics). */
export interface FocusRun {
  id: Id;
  cycleId: Id;
  kind: "pomodoro" | "flowtime" | "stopwatch";
  phase: "focus" | "short_break" | "long_break";
  round: number; // 1-based focus round within the cycle (breaks carry the round they follow)
  startedAt: number;
  endedAt: number | null; // null while running or paused
  plannedMs: number | null; // countdown length incl. extensions
  activeMs: number; // time spent, pauses excluded
  outcome: "completed" | "skipped" | "stopped" | null;
  endsCycle: boolean; // this focus round completed a Pomodoro cycle
  categoryId: Id | null;
  blockId: Id | null;
  createdAt: number;
  updatedAt: number;
}

export interface TemplateBlock {
  id: Id;
  startMinute: number; // local minute of day
  durationMinutes: number;
  categoryId: Id;
  title: string | null;
  tagIds: Id[];
}

/** A reusable day plan ("Freelance day"). Applying it creates normal planned blocks. */
export interface DayTemplate {
  id: Id;
  name: string;
  sortOrder: number;
  blocks: TemplateBlock[];
  createdAt: number;
}

export type ThemePref = "dark" | "light" | "system";
export type Density = "comfortable" | "compact";

export interface Settings {
  theme: ThemePref;
  accent: string;
  density: Density;
  snapMinutes: 5 | 10 | 15 | 30;
  dayStartHour: number; // first visible hour
  dayEndHour: number; // last visible hour (exclusive)
  hourHeight: number; // px per hour (zoom)
  weekStartsOn: 0 | 1; // 0 = Sunday, 1 = Monday
  showActualLane: boolean;
  rightPanelOpen: boolean;
  sidebarOpen: boolean;
  /** Left sidebar width in px; null = the theme's default. */
  sidebarWidth: number | null;
  defaultBlockMinutes: number;
  timeFormat: "24h" | "12h";
  // Focus (Phase 2)
  pomodoroFocus: number; // minutes
  pomodoroBreak: number;
  pomodoroLongBreak: number;
  pomodoroLongEvery: number;
  breakCategoryId: Id | null; // null = first break category
  breakReminderMinutes: number; // stopwatch: remind to take a break after this long; 0 = off
  notifications: boolean;
  sounds: boolean;
  closeToTray: boolean;
  // Daily ritual (Phase 2)
  workdayHours: number; // used by morning planning to show unallocated time
  reviewPrompts: boolean; // show morning/evening prompts in the day panel
  // Backups (Phase 2)
  backupDir: string | null; // null = <data folder>/backups
  backupKeepDays: number;
  // Progression (Phase 3)
  milestoneHours: number[]; // lifetime-hours ladder for skills and areas
  progressionHidden: string[]; // "tag:<id>" / "category:<id>" left out of Progress and achievements
  // Obsidian (Phase 3)
  obsidianDir: string | null; // folder inside the vault; Interval writes Days/ and Weeks/ under it
  obsidianAuto: boolean; // write yesterday's log and last week's summary automatically
  // Personalization (Phase 3)
  shortcuts: Record<string, string>; // action id -> key (overrides of the defaults)
  // Focus timer (v0.4)
  focusPresets: FocusPreset[]; // quick presets shown in the timer panel (built-ins + your own)
  focusTimerMode: "pomodoro" | "stopwatch" | "flowtime"; // mode selected in the panel
  focusPanelOpen: boolean; // docked panel expanded
  focusAutoBreak: boolean; // start breaks automatically when a focus round ends
  focusAutoFocus: boolean; // start the next focus round automatically when a break ends
  focusRecordBreaks: boolean; // record breaks as sessions in the break category
  focusNotify: "silent" | "system" | "popup";
  focusPopupTakesFocus: boolean; // the completion popup may take keyboard focus
  focusPopupOverFullscreen: boolean; // show the popup over fullscreen apps
  soundVolume: number; // master 0..1
  soundEvents: Record<SoundEvent, SoundSetting>;
  miniAuto: boolean; // show the floating timer when Interval is minimized and a timer is active
  miniOnTop: boolean;
  miniOpacity: number; // 0.4..1
  miniClickThrough: boolean;
  miniLayout: "standard" | "compact";
  miniHideFullscreen: boolean;
  miniPos: { x: number; y: number } | null; // physical pixels, virtual desktop coordinates
  minimizeToTray: boolean; // minimizing hides Interval to the tray
  globalShortcuts: Record<string, string>; // action -> accelerator, e.g. "Ctrl+Alt+Shift+P"; "" = off
}

export type SoundEvent = "focusStart" | "focusEnd" | "breakStart" | "breakEnd" | "cycleEnd";
export interface SoundSetting {
  on: boolean;
  volume: number; // 0..1, multiplied by the master volume
  file: string | null; // imported custom sound (path inside the data folder); null = bundled sound
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  accent: "#d5d3ca",
  density: "comfortable",
  snapMinutes: 15,
  dayStartHour: 0,
  dayEndHour: 24,
  hourHeight: 56,
  weekStartsOn: 1,
  showActualLane: true,
  rightPanelOpen: true,
  sidebarOpen: true,
  sidebarWidth: null,
  defaultBlockMinutes: 60,
  timeFormat: "24h",
  pomodoroFocus: 25,
  pomodoroBreak: 5,
  pomodoroLongBreak: 15,
  pomodoroLongEvery: 4,
  breakCategoryId: null,
  breakReminderMinutes: 90,
  notifications: true,
  sounds: true,
  closeToTray: false,
  workdayHours: 8,
  reviewPrompts: true,
  backupDir: null,
  backupKeepDays: 30,
  milestoneHours: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  progressionHidden: [],
  obsidianDir: null,
  obsidianAuto: false,
  shortcuts: {},
  focusPresets: DEFAULT_FOCUS_PRESETS,
  focusTimerMode: "pomodoro",
  focusPanelOpen: true,
  focusAutoBreak: true,
  focusAutoFocus: false,
  focusRecordBreaks: true,
  focusNotify: "popup",
  focusPopupTakesFocus: false,
  focusPopupOverFullscreen: false,
  soundVolume: 0.6,
  soundEvents: {
    focusStart: { on: true, volume: 0.7, file: null },
    focusEnd: { on: true, volume: 1, file: null },
    breakStart: { on: false, volume: 0.7, file: null },
    breakEnd: { on: true, volume: 1, file: null },
    cycleEnd: { on: true, volume: 1, file: null },
  },
  miniAuto: true,
  miniOnTop: true,
  miniOpacity: 0.94,
  miniClickThrough: false,
  miniLayout: "standard",
  miniHideFullscreen: true,
  miniPos: null,
  minimizeToTray: false,
  globalShortcuts: { toggle: "Ctrl+Alt+Shift+Space", mini: "Ctrl+Alt+Shift+M", clickThrough: "Ctrl+Alt+Shift+T" },
};

/** A half-open interval [start, end) in epoch ms. */
export interface Interval {
  start: number;
  end: number;
}
