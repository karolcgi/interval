// Period summaries (week, month, year) with comparison to another period, as data and as Markdown.
// Used by the Summaries view, Year in review, and the Obsidian export.

import type { Block, Category, Id, Interval, Session, Tag } from "./types";
import { computeStats, type Bucket } from "./stats";
import { addDays, addMonths, dayKey, startOfMonth, startOfWeek, startOfYear, HOUR } from "./time";
import { fmtDuration } from "./format";
import type { Achievement } from "./progression";

export type SummaryPeriod = "week" | "month" | "year";
export type CompareTo = "previous" | "last_year";

export function periodOf(kind: SummaryPeriod, t: number, weekStartsOn: 0 | 1, offset = 0): Interval {
  if (kind === "week") {
    const s = addDays(startOfWeek(t, weekStartsOn), 7 * offset);
    return { start: s, end: addDays(s, 7) };
  }
  if (kind === "month") {
    const s = addMonths(startOfMonth(t), offset);
    return { start: s, end: addMonths(s, 1) };
  }
  const y = new Date(startOfYear(t)).getFullYear() + offset;
  return { start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime() };
}

/** The period to compare with: the one before, or the same period a year earlier. */
export function comparisonOf(kind: SummaryPeriod, range: Interval, compare: CompareTo, weekStartsOn: 0 | 1): Interval {
  if (compare === "previous") return periodOf(kind, range.start, weekStartsOn, -1);
  if (kind === "week") {
    // Same ISO-ish week a year earlier: shift 52 weeks so weekdays line up.
    const s = addDays(range.start, -364);
    return { start: s, end: addDays(s, 7) };
  }
  if (kind === "month") return { start: addMonths(range.start, -12), end: addMonths(range.end, -12) };
  return periodOf("year", range.start, weekStartsOn, -1);
}

/** ISO 8601 week number and week-year, e.g. { year: 2026, week: 48 }. */
export function isoWeek(t: number): { year: number; week: number } {
  const d = new Date(t);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  const thursday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const week = 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return { year: thursday.getFullYear(), week };
}

export interface Row {
  id: Id;
  name: string;
  color?: string;
  ms: number;
  prevMs: number;
}

export interface PeriodSummary {
  kind: SummaryPeriod;
  range: Interval;
  compareRange: Interval;
  recordedMs: number;
  prevRecordedMs: number;
  plannedMs: number;
  breakMs: number;
  focusedMs: number;
  sessions: number;
  activeDays: number;
  prevActiveDays: number;
  categories: Row[]; // non-break, largest first; includes rows that only existed in the comparison period
  tags: Row[];
  buckets: Array<{ start: number; ms: number }>; // days for week/month, months for year
  achievements: Achievement[]; // earned inside the period
}

export function periodSummary(p: {
  kind: SummaryPeriod;
  range: Interval;
  compareRange: Interval;
  sessions: Session[];
  blocks: Block[];
  categories: Category[];
  tags: Tag[];
  now: number;
  weekStartsOn: 0 | 1;
  achievements?: Achievement[];
}): PeriodSummary {
  const bucket: Bucket = p.kind === "year" ? "month" : "day";
  const cur = computeStats({ sessions: p.sessions, blocks: p.blocks, categories: p.categories, range: p.range, now: p.now, bucket, weekStartsOn: p.weekStartsOn });
  const prev = computeStats({ sessions: p.sessions, blocks: p.blocks, categories: p.categories, range: p.compareRange, now: p.now, weekStartsOn: p.weekStartsOn });
  const cat = new Map(p.categories.map((c) => [c.id, c]));
  const tagName = new Map(p.tags.map((t) => [t.id, t.name]));

  const catRows = new Map<Id, Row>();
  for (const r of cur.byCategory) {
    const c = cat.get(r.categoryId);
    if (c?.isBreak || r.recordedMs <= 0) continue;
    catRows.set(r.categoryId, { id: r.categoryId, name: c?.name ?? "Uncategorised", color: c?.color, ms: r.recordedMs, prevMs: 0 });
  }
  for (const r of prev.byCategory) {
    const c = cat.get(r.categoryId);
    if (c?.isBreak || r.recordedMs <= 0) continue;
    const row = catRows.get(r.categoryId) ?? { id: r.categoryId, name: c?.name ?? "Uncategorised", color: c?.color, ms: 0, prevMs: 0 };
    row.prevMs = r.recordedMs;
    catRows.set(r.categoryId, row);
  }
  const tagRows = new Map<Id, Row>();
  for (const r of cur.byTag) if (r.recordedMs > 0) tagRows.set(r.tagId, { id: r.tagId, name: tagName.get(r.tagId) ?? "?", ms: r.recordedMs, prevMs: 0 });
  for (const r of prev.byTag) {
    if (r.recordedMs <= 0) continue;
    const row = tagRows.get(r.tagId) ?? { id: r.tagId, name: tagName.get(r.tagId) ?? "?", ms: 0, prevMs: 0 };
    row.prevMs = r.recordedMs;
    tagRows.set(r.tagId, row);
  }
  const sortRows = (rows: Row[]) => rows.sort((a, b) => b.ms - a.ms || b.prevMs - a.prevMs);
  const a = dayKey(p.range.start);
  const b = dayKey(p.range.end - 1);
  return {
    kind: p.kind,
    range: p.range,
    compareRange: p.compareRange,
    recordedMs: cur.recordedMs,
    prevRecordedMs: prev.recordedMs,
    plannedMs: cur.plannedMs,
    breakMs: cur.breakMs,
    focusedMs: cur.focusedMs,
    sessions: cur.sessionCount,
    activeDays: cur.activeDays,
    prevActiveDays: prev.activeDays,
    categories: sortRows([...catRows.values()]),
    tags: sortRows([...tagRows.values()]),
    buckets: cur.buckets.map((x) => ({ start: x.start, ms: x.totalMs })),
    achievements: (p.achievements ?? []).filter((x) => x.day && x.day >= a && x.day <= b).sort((x, y) => (x.day! < y.day! ? -1 : 1)),
  };
}

// -------------------------------------------------------------------- markdown

const h1 = (ms: number) => Math.round((ms / HOUR) * 10) / 10;
const md = (s: string) => s.replace(/([\\`*_[\]<>|])/g, "\\$1");
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || "x";

const enMonth = new Intl.DateTimeFormat("en-GB", { month: "long" });
const enShort = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

export function periodTitle(kind: SummaryPeriod, range: Interval): string {
  if (kind === "year") return `${new Date(range.start).getFullYear()} in review`;
  if (kind === "month") return `${enMonth.format(range.start)} ${new Date(range.start).getFullYear()}`;
  const w = isoWeek(range.start);
  return `Week ${w.week}, ${w.year} (${enShort.format(range.start)} – ${enShort.format(range.end - 1)})`;
}

/** File name used for the Obsidian export. */
export function periodFileName(kind: SummaryPeriod, range: Interval): string {
  if (kind === "year") return `${new Date(range.start).getFullYear()}.md`;
  if (kind === "month") return `${dayKey(range.start).slice(0, 7)}.md`;
  const w = isoWeek(range.start);
  return `${w.year}-W${String(w.week).padStart(2, "0")}.md`;
}

function delta(ms: number, prev: number): string {
  if (prev <= 0) return ms > 0 ? "new" : "";
  const d = ms - prev;
  if (Math.abs(d) < 60_000) return "same";
  return `${d > 0 ? "+" : "−"}${fmtDuration(Math.abs(d), { compact: true })}`;
}

/**
 * Markdown summary with YAML frontmatter (hours per category, Dataview-friendly), e.g.
 *
 *   ---
 *   type: interval-week
 *   period: 2026-W48
 *   start: 2026-11-23
 *   end: 2026-11-29
 *   total_hours: 31.5
 *   hours_freelance_work: 22
 *   generator: interval
 *   ---
 */
export function summaryMarkdown(s: PeriodSummary, opts: { compareLabel?: string; extra?: string } = {}): string {
  const period = s.kind === "week" ? periodFileName("week", s.range).replace(/\.md$/, "") : s.kind === "month" ? dayKey(s.range.start).slice(0, 7) : String(new Date(s.range.start).getFullYear());
  const fm = [
    "---",
    `type: interval-${s.kind}`,
    `period: ${period}`,
    `start: ${dayKey(s.range.start)}`,
    `end: ${dayKey(s.range.end - 1)}`,
    `total_hours: ${h1(s.recordedMs)}`,
    `planned_hours: ${h1(s.plannedMs)}`,
    `focused_hours: ${h1(s.focusedMs)}`,
    `active_days: ${s.activeDays}`,
    ...s.categories.filter((r) => r.ms > 0).map((r) => `hours_${slug(r.name)}: ${h1(r.ms)}`),
    "generator: interval",
    "---",
  ];
  const cmp = opts.compareLabel ?? "previous period";
  const lines = [...fm, "", `# ${periodTitle(s.kind, s.range)}`, ""];
  const totalDelta = delta(s.recordedMs, s.prevRecordedMs);
  lines.push(
    `**${fmtDuration(s.recordedMs, { compact: true })} recorded** across ${s.activeDays} active day${s.activeDays === 1 ? "" : "s"}` +
      (s.plannedMs > 0 ? ` · ${fmtDuration(s.plannedMs, { compact: true })} planned` : "") +
      (s.breakMs > 0 ? ` · breaks ${fmtDuration(s.breakMs, { compact: true })}` : "") +
      (totalDelta && totalDelta !== "new" ? ` · ${totalDelta} vs ${cmp}` : ""),
    "",
  );
  if (s.categories.length) {
    lines.push("## Categories", "", `| Category | Hours | vs ${cmp} |`, "|---|---:|---:|");
    for (const r of s.categories) lines.push(`| ${md(r.name)} | ${fmtDuration(r.ms, { compact: true })} | ${delta(r.ms, r.prevMs)} |`);
    lines.push("");
  }
  const tags = s.tags.filter((r) => r.ms > 0);
  if (tags.length) {
    lines.push("## Tags", "", tags.slice(0, 15).map((r) => `- #${r.name.replace(/\s+/g, "-")} ${fmtDuration(r.ms, { compact: true })}${r.prevMs ? ` (${delta(r.ms, r.prevMs)})` : ""}`).join("\n"), "");
  }
  if (s.achievements.length) {
    lines.push("## Milestones", "", ...s.achievements.map((a) => `- ${a.day} ${md(a.title)}`), "");
  }
  if (opts.extra) lines.push(opts.extra.trimEnd(), "");
  return lines.join("\n");
}

