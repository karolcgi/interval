// Day log: what actually happened on a day, as a plain Markdown timeline built from recorded sessions.
// Pure; the UI renders the same entries and copies/saves the Markdown (e.g. into an Obsidian vault).

import type { Block, Category, Id, Session, Tag } from "./types";
import { addDays, dayKey } from "./time";
import { computeStats } from "./stats";
import { fmtDuration, fmtTime } from "./format";

export interface DayLogEntry {
  start: number;
  end: number; // clipped to the day; `now` for a running session
  running: boolean;
  title: string; // session title, else its block's title, else the category name
  categoryId: Id;
  categoryName: string;
  color: string;
  isBreak: boolean;
  tags: string[];
  notes: string | null;
  sessionIds: Id[];
}

export interface DayLog {
  day: number;
  entries: DayLogEntry[];
  totalMs: number; // excluding breaks; overlaps counted once
  breakMs: number;
  byCategory: Array<{ categoryId: Id; name: string; color: string; ms: number }>; // excluding breaks, largest first
}

const GAP_MERGE_MS = 60_000;

/**
 * Sessions overlapping `day`, clipped to it, oldest first. Back-to-back sessions (gap ≤ 1 min) with the same
 * title and category are merged into one line, so a paused-and-resumed session reads as one activity.
 */
export function buildDayLog(day: number, sessions: Session[], blocks: Block[], categories: Category[], tags: Tag[], now: number): DayLog {
  const dayEnd = addDays(day, 1);
  const cat = new Map(categories.map((c) => [c.id, c]));
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const blockTitle = new Map(blocks.map((b) => [b.id, b.title]));
  const entries: DayLogEntry[] = [];
  const sorted = sessions
    .map((s) => ({ s, end: s.endAt ?? now }))
    .filter(({ s, end }) => s.startAt < dayEnd && end > day && end > s.startAt)
    .sort((a, b) => a.s.startAt - b.s.startAt);
  for (const { s, end } of sorted) {
    const c = cat.get(s.categoryId);
    const categoryName = c?.name ?? "Uncategorised";
    const title = s.title?.trim() || (s.blockId ? blockTitle.get(s.blockId)?.trim() : "") || categoryName;
    const e: DayLogEntry = {
      start: Math.max(s.startAt, day),
      end: Math.min(end, dayEnd),
      running: s.endAt === null,
      title,
      categoryId: s.categoryId,
      categoryName,
      color: c?.color ?? "#888888",
      isBreak: !!c?.isBreak,
      tags: s.tagIds.map((id) => tagName.get(id)).filter((n): n is string => !!n),
      notes: s.notes?.trim() || null,
      sessionIds: [s.id],
    };
    const prev = entries[entries.length - 1];
    if (prev && prev.title === e.title && prev.categoryId === e.categoryId && e.start - prev.end <= GAP_MERGE_MS && e.start >= prev.start) {
      prev.end = Math.max(prev.end, e.end);
      prev.running = prev.running || e.running;
      prev.tags = [...new Set([...prev.tags, ...e.tags])];
      prev.notes = [prev.notes, e.notes].filter(Boolean).join(" ") || null;
      prev.sessionIds.push(s.id);
    } else entries.push(e);
  }
  // Totals use the statistics engine, so overlapping sessions count once (same numbers as everywhere else).
  const st = computeStats({ sessions, blocks: [], categories, range: { start: day, end: dayEnd }, now });
  const totalMs = st.recordedMs;
  const breakMs = st.breakMs;
  const byCategory = st.byCategory
    .filter((r) => r.recordedMs > 0 && !cat.get(r.categoryId)?.isBreak)
    .map((r) => ({ categoryId: r.categoryId, name: cat.get(r.categoryId)?.name ?? "Uncategorised", color: cat.get(r.categoryId)?.color ?? "#888888", ms: r.recordedMs }))
    .sort((a, b) => b.ms - a.ms);
  return { day, entries, totalMs, breakMs, byCategory };
}

/** Escape characters that would turn a title into Markdown formatting or a link. */
function mdText(s: string): string {
  return s.replace(/([\\`*_[\]<>|])/g, "\\$1").replace(/\s+/g, " ");
}

const wd = new Intl.DateTimeFormat("en-GB", { weekday: "long" });
const mo = new Intl.DateTimeFormat("en-GB", { month: "long" });
/** "Wednesday 25 November 2026": fixed English so logs read the same on every machine. */
const longDate = { format: (t: number) => `${wd.format(t)} ${new Date(t).getDate()} ${mo.format(t)} ${new Date(t).getFullYear()}` };

/**
 * The Markdown day log, e.g.
 *
 *   # Wednesday 25 November 2026
 *
 *   - 09:00–10:30 **Houdini VEX** · Studying · 1h 30m
 *   - 10:30–10:45 Break · Breaks · 15m
 *
 *   **Total 6h 05m** · Freelance work 4h · Studying 2h 05m · Breaks 15m
 */
export function dayLogMarkdown(log: DayLog, opts: { timeFormat?: "24h" | "12h"; heading?: boolean; frontmatter?: boolean } = {}): string {
  const tf = opts.timeFormat ?? "24h";
  const lines: string[] = [];
  if (opts.frontmatter) {
    const h = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;
    const slug = (n: string) => n.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "x";
    lines.push(
      "---",
      "type: interval-day",
      `date: ${dayKey(log.day)}`,
      `total_hours: ${h(log.totalMs)}`,
      ...log.byCategory.map((c) => `hours_${slug(c.name)}: ${h(c.ms)}`),
      ...(log.breakMs > 0 ? [`break_hours: ${h(log.breakMs)}`] : []),
      "generator: interval",
      "---",
      "",
    );
  }
  if (opts.heading !== false) lines.push(`# ${longDate.format(log.day)}`, "");
  if (!log.entries.length) {
    lines.push("Nothing recorded.");
    return lines.join("\n") + "\n";
  }
  for (const e of log.entries) {
    const time = `${fmtTime(e.start, tf)}–${e.running ? "now" : fmtTime(e.end, tf)}`;
    const name = e.isBreak && e.title === e.categoryName ? mdText(e.title) : `**${mdText(e.title)}**`;
    const parts = [name];
    if (e.title !== e.categoryName) parts.push(mdText(e.categoryName));
    if (e.tags.length) parts.push(e.tags.map((t) => `#${t.replace(/\s+/g, "-")}`).join(" "));
    parts.push(fmtDuration(e.end - e.start, { compact: true }));
    lines.push(`- ${time} ${parts.join(" · ")}`);
    if (e.notes) lines.push(`  - ${mdText(e.notes)}`);
  }
  lines.push("");
  const totals = [`**Total ${fmtDuration(log.totalMs, { compact: true })}**`, ...log.byCategory.map((c) => `${mdText(c.name)} ${fmtDuration(c.ms, { compact: true })}`)];
  if (log.breakMs > 0) totals.push(`Breaks ${fmtDuration(log.breakMs, { compact: true })}`);
  lines.push(totals.join(" · "));
  return lines.join("\n") + "\n";
}

/** Several days in one file (oldest first), each under a `##` heading. Days with nothing recorded are skipped. */
export function rangeLogMarkdown(logs: DayLog[], opts: { timeFormat?: "24h" | "12h" } = {}): string {
  const days = logs.filter((l) => l.entries.length);
  if (!days.length) return "Nothing recorded.\n";
  return days.map((l) => `## ${longDate.format(l.day)}\n\n${dayLogMarkdown(l, { ...opts, heading: false })}`).join("\n");
}

/** File name that matches Obsidian's default daily-note format. */
export function dayLogFileName(day: number): string {
  return `${dayKey(day)}.md`;
}
