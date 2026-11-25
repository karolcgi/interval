import { pad2 } from "./time";

/** 4h 05m, 45m, 0m */
export function fmtDuration(ms: number, opts: { compact?: boolean } = {}): string {
  const totalMin = Math.round(Math.max(0, ms) / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (opts.compact) {
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }
  if (h === 0) return `${m}m`;
  return `${h}h ${pad2(m)}m`;
}

/** Decimal hours, e.g. 12.5 */
export function fmtHours(ms: number, digits = 1): string {
  const h = ms / 3_600_000;
  return h.toFixed(h >= 100 ? 0 : digits).replace(/\.0+$/, "");
}

/** 01:23:45 for a running timer */
export function fmtClock(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}

export function fmtTime(t: number, format: "24h" | "12h" = "24h"): string {
  const d = new Date(t);
  if (format === "12h") {
    const h = d.getHours() % 12 || 12;
    return `${h}:${pad2(d.getMinutes())}${d.getHours() < 12 ? "am" : "pm"}`;
  }
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fmtHourLabel(hour: number, format: "24h" | "12h" = "24h"): string {
  if (format === "12h") {
    const h = hour % 12 || 12;
    return `${h} ${hour % 24 < 12 ? "AM" : "PM"}`;
  }
  return `${pad2(hour % 24)}:00`;
}

const dateFmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, opts);
const fmtWeekday = dateFmt({ weekday: "long" });
const fmtWeekdayShort = dateFmt({ weekday: "short" });
const fmtMonthDay = dateFmt({ month: "long", day: "numeric" });
const fmtMonthYear = dateFmt({ month: "long", year: "numeric" });
const fmtShortDate = dateFmt({ month: "short", day: "numeric" });
const fmtFull = dateFmt({ weekday: "short", month: "short", day: "numeric", year: "numeric" });

export const fmt = {
  weekday: (t: number) => fmtWeekday.format(t),
  weekdayShort: (t: number) => fmtWeekdayShort.format(t),
  monthDay: (t: number) => fmtMonthDay.format(t),
  monthYear: (t: number) => fmtMonthYear.format(t),
  shortDate: (t: number) => fmtShortDate.format(t),
  full: (t: number) => fmtFull.format(t),
};

/** Local ISO 8601 with offset, e.g. 2026-11-25T09:00:00+01:00 (used in exports). */
export function isoLocal(t: number): string {
  const d = new Date(t);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}
