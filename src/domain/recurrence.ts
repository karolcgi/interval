// Recurrence rules for planned blocks. Pure functions, no I/O.
//
// Rules use a small, readable subset of RFC 5545 RRULE syntax:
//   FREQ=DAILY[;INTERVAL=n]
//   FREQ=WEEKLY[;INTERVAL=n];BYDAY=MO,TU,WE,TH,FR
//   FREQ=MONTHLY[;INTERVAL=n][;BYMONTHDAY=d]
// Occurrences are evaluated on LOCAL calendar days, and the time of day is a local minute,
// so "every weekday 16:00" stays at 16:00 across DST changes.

import type { Id } from "./types";
import { addDays, dayKey, parseDayKey, startOfDay, startOfWeek } from "./time";

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY";
export const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface Rule {
  freq: Freq;
  interval: number;
  byDay: Weekday[]; // WEEKLY only; empty = the weekday of startsOn
  byMonthDay: number | null; // MONTHLY only; null = the day of startsOn
}

export interface RecurrenceRule {
  id: Id;
  rrule: string;
  startMinute: number; // local minute of day
  durationMinutes: number;
  categoryId: Id;
  title: string | null;
  tagIds: Id[];
  startsOn: string; // YYYY-MM-DD, first day the rule may produce
  endsOn: string | null; // YYYY-MM-DD inclusive, or null = forever
  materializedUntil: string | null; // last day for which occurrences were generated
  icon?: string | null; // v0.8: copied onto each occurrence
  color?: string | null;
  createdAt: number;
}

export function parseRule(rrule: string): Rule {
  const parts = Object.fromEntries(
    rrule
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const [k, v = ""] = p.split("=");
        return [k.toUpperCase(), v.toUpperCase()];
      }),
  );
  const freq = (["DAILY", "WEEKLY", "MONTHLY"].includes(parts.FREQ) ? parts.FREQ : "DAILY") as Freq;
  const interval = Math.max(1, Math.min(52, Number(parts.INTERVAL) || 1));
  const byDay = (parts.BYDAY ? parts.BYDAY.split(",") : []).filter((d: string): d is Weekday => (WEEKDAYS as readonly string[]).includes(d));
  const md = Number(parts.BYMONTHDAY);
  return { freq, interval, byDay: sortDays(byDay), byMonthDay: md >= 1 && md <= 31 ? md : null };
}

export function formatRule(r: Rule): string {
  const out = [`FREQ=${r.freq}`];
  if (r.interval > 1) out.push(`INTERVAL=${r.interval}`);
  if (r.freq === "WEEKLY" && r.byDay.length) out.push(`BYDAY=${sortDays(r.byDay).join(",")}`);
  if (r.freq === "MONTHLY" && r.byMonthDay) out.push(`BYMONTHDAY=${r.byMonthDay}`);
  return out.join(";");
}

function sortDays(days: Weekday[]): Weekday[] {
  const order = (d: Weekday) => (WEEKDAYS.indexOf(d) + 6) % 7; // Monday first
  return [...new Set(days)].sort((a, b) => order(a) - order(b));
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/** Does the rule produce an occurrence on this local day? (`day` is any time on that day.) */
export function occursOn(rule: Rule, startsOn: string, endsOn: string | null, day: number): boolean {
  const key = dayKey(day);
  if (key < startsOn) return false;
  if (endsOn && key > endsOn) return false;
  const d = new Date(startOfDay(day));
  const s = parseDayKey(startsOn);
  if (rule.freq === "DAILY") {
    const diff = Math.round((startOfDay(d.getTime()) - s.getTime()) / 86_400_000);
    return diff % rule.interval === 0;
  }
  if (rule.freq === "WEEKLY") {
    const days = rule.byDay.length ? rule.byDay : [WEEKDAYS[s.getDay()]];
    if (!days.includes(WEEKDAYS[d.getDay()])) return false;
    // Week parity anchored on the Monday of the start week (Math.round absorbs DST hours).
    const weeks = Math.round((startOfWeek(d.getTime(), 1) - startOfWeek(s.getTime(), 1)) / (7 * 86_400_000));
    return weeks % rule.interval === 0;
  }
  // MONTHLY: on the given day; months without that day (e.g. the 31st) use their last day.
  if (monthsBetween(s, d) % rule.interval !== 0) return false;
  const want = rule.byMonthDay ?? s.getDate();
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() === Math.min(want, lastDay);
}

/** Local day starts (ms) in [fromDay, toDay] inclusive on which the rule occurs. */
export function occurrencesBetween(r: Pick<RecurrenceRule, "rrule" | "startsOn" | "endsOn">, fromDay: number, toDay: number): number[] {
  const rule = parseRule(r.rrule);
  const out: number[] = [];
  for (let d = startOfDay(fromDay); d <= toDay; d = addDays(d, 1)) if (occursOn(rule, r.startsOn, r.endsOn, d)) out.push(d);
  return out;
}

const DAY_NAMES: Record<Weekday, string> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };
const DAY_NAMES_LONG: Record<Weekday, string> = { MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday", SU: "Sunday" };

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Human description: "Every weekday", "Every 2 weeks on Fri", "Monthly on the 1st". */
export function describeRule(rrule: string, startsOn?: string): string {
  const r = parseRule(rrule);
  const every = (unit: string) => (r.interval === 1 ? `Every ${unit}` : `Every ${r.interval} ${unit}s`);
  if (r.freq === "DAILY") return r.interval === 1 ? "Every day" : `Every ${r.interval} days`;
  if (r.freq === "WEEKLY") {
    const days = r.byDay.length ? r.byDay : startsOn ? [WEEKDAYS[parseDayKey(startsOn).getDay()]] : [];
    const key = days.join(",");
    if (r.interval === 1 && key === "MO,TU,WE,TH,FR") return "Every weekday";
    if (r.interval === 1 && key === "SA,SU") return "Every weekend";
    if (r.interval === 1 && days.length === 7) return "Every day";
    if (days.length === 1) return `${every("week")} on ${DAY_NAMES_LONG[days[0]]}`;
    return `${every("week")} on ${days.map((d) => DAY_NAMES[d]).join(", ")}`;
  }
  const md = r.byMonthDay ?? (startsOn ? parseDayKey(startsOn).getDate() : 1);
  return `${r.interval === 1 ? "Monthly" : `Every ${r.interval} months`} on the ${ordinal(md)}`;
}

/** Presets offered in the block inspector, relative to the block's own day. */
export function rulePresets(day: number): Array<{ label: string; rrule: string }> {
  const d = new Date(day);
  const wd = WEEKDAYS[d.getDay()];
  return [
    { label: "Every day", rrule: "FREQ=DAILY" },
    { label: "Every weekday", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
    { label: `Every week on ${DAY_NAMES_LONG[wd]}`, rrule: `FREQ=WEEKLY;BYDAY=${wd}` },
    { label: `Every 2 weeks on ${DAY_NAMES_LONG[wd]}`, rrule: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${wd}` },
    { label: `Monthly on the ${ordinal(d.getDate())}`, rrule: `FREQ=MONTHLY;BYMONTHDAY=${d.getDate()}` },
  ];
}

export { DAY_NAMES };
