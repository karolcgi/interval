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
  updatedAt: number;
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
  defaultBlockMinutes: number;
  timeFormat: "24h" | "12h";
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
  defaultBlockMinutes: 60,
  timeFormat: "24h",
};

/** A half-open interval [start, end) in epoch ms. */
export interface Interval {
  start: number;
  end: number;
}
