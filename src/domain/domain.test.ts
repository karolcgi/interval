import { describe, expect, it } from "vitest";
import { t } from "../test/helpers";
import { addDays, dayKey, hoursInDay, minuteOfDay, previousRange, resolveRange, shiftDaysKeepClock, splitByDay, startOfDay, startOfWeek, HOUR, MINUTE } from "./time";
import { findOverlaps, resolveOverlaps } from "./overlap";
import { computeStats, expandCategoryIds } from "./stats";
import { canMerge, dragToInterval, layoutColumns, moveInterval, pxToMinute, resizeInterval, snapMinute, splitInterval, splitPoint } from "./calendar";
import type { Block, Category, Session } from "./types";
import { fmtClock, fmtDuration, isoLocal } from "./format";
import { parseCsv, toCsv } from "./csv";
import { flowtimeBreakMinutes, breakLength, nextStep, type FocusState } from "./focus";
import { activeRuns } from "./analytics";
import { describeRule, formatRule, occurrencesBetween, parseRule } from "./recurrence";
import { buildDayLog, dayLogMarkdown, rangeLogMarkdown } from "./daylog";
import { buildLedger, deriveAchievements, milestoneProgress, weekStreak, balancedWeeks, DEFAULT_LADDER } from "./progression";
import { comparisonOf, isoWeek, periodFileName, periodOf, periodSummary, summaryMarkdown } from "./summary";
import { bindings, comboOf, prettyKey } from "../state/shortcuts";

// ------------------------------------------------------------- fixtures

const cat = (id: string, extra: Partial<Category> = {}): Category => ({
  id, name: id, color: "#888", icon: null, parentId: null, sortOrder: 0, shortcut: null, isBreak: false, archivedAt: null, createdAt: 0, updatedAt: 0, ...extra,
});
const CATS = [cat("work"), cat("study"), cat("houdini-study", { parentId: "study" }), cat("break", { isBreak: true })];

let seq = 0;
const sess = (start: number, end: number | null, categoryId: string, tagIds: string[] = [], extra: Partial<Session> = {}): Session => ({
  id: `s${++seq}`, startAt: start, endAt: end, tz: "Europe/Warsaw", categoryId, blockId: null, title: null, notes: null, mode: "stopwatch", tagIds, createdAt: start, updatedAt: start, ...extra,
});
const blk = (start: number, end: number, categoryId: string, status: Block["status"] = "planned", tagIds: string[] = []): Block => ({
  id: `b${++seq}`, startAt: start, endAt: end, tz: "Europe/Warsaw", categoryId, title: null, notes: null, link: null, status, recurrenceId: null, tagIds, createdAt: start, updatedAt: start,
});

// ----------------------------------------------------------------- time

describe("time zones and day boundaries (Europe/Warsaw)", () => {
  it("splits a session crossing midnight into two local days", () => {
    const parts = splitByDay({ start: t(2026, 11, 24, 23), end: t(2026, 11, 25, 1, 30) });
    expect(parts.map((p) => p.day)).toEqual(["2026-11-24", "2026-11-25"]);
    expect(parts[0].end - parts[0].start).toBe(1 * HOUR);
    expect(parts[1].end - parts[1].start).toBe(1.5 * HOUR);
  });

  it("knows DST days have 23 and 25 hours", () => {
    expect(hoursInDay(t(2026, 3, 29))).toBe(23); // spring forward
    expect(hoursInDay(t(2026, 10, 25))).toBe(25); // fall back
    expect(hoursInDay(t(2026, 11, 25))).toBe(24);
  });

  it("measures durations across a DST change in real elapsed time", () => {
    // 01:00 -> 04:00 local on the spring-forward night is only 2 real hours
    const s = sess(t(2026, 3, 29, 1), t(2026, 3, 29, 4), "work");
    const st = computeStats({ sessions: [s], blocks: [], categories: CATS, range: { start: t(2026, 3, 29), end: t(2026, 3, 30) }, now: t(2026, 4, 1) });
    expect(st.recordedMs).toBe(2 * HOUR);
  });

  it("addDays lands on local midnight even across DST", () => {
    const d = addDays(t(2026, 3, 28), 1);
    expect(new Date(d).getHours()).toBe(0);
    expect(new Date(addDays(t(2026, 10, 24), 2)).getDate()).toBe(26);
  });

  it("copying a block to the next day keeps its wall-clock time across DST", () => {
    const moved = shiftDaysKeepClock(t(2026, 3, 28, 9), 1);
    expect(minuteOfDay(moved)).toBe(9 * 60);
  });

  it("resolves named ranges with Monday week start", () => {
    const now = t(2026, 11, 25, 10); // Wednesday
    const lw = resolveRange("last_week", now, 1);
    expect(lw.start).toBe(t(2026, 11, 16));
    expect(lw.end).toBe(t(2026, 11, 23));
    const ty = resolveRange("this_year", now, 1);
    expect(ty.start).toBe(t(2026, 1, 1));
    expect(ty.end).toBe(t(2027, 1, 1));
    expect(resolveRange("this_quarter", now, 1).start).toBe(t(2026, 10, 1));
    expect(resolveRange("custom", now, 1, { from: "2026-11-10", to: "2026-11-01" })).toEqual({ start: t(2026, 11, 1), end: t(2026, 11, 11) });
    expect(startOfWeek(now, 0)).toBe(t(2026, 11, 22));
  });

  it("previous period mirrors month shapes", () => {
    expect(previousRange({ start: t(2026, 3, 1), end: t(2026, 4, 1) })).toEqual({ start: t(2026, 2, 1), end: t(2026, 3, 1) });
    expect(previousRange({ start: t(2026, 11, 16), end: t(2026, 11, 23) })).toEqual({ start: t(2026, 11, 9), end: t(2026, 11, 16) });
  });
});

// -------------------------------------------------------------- overlap

describe("overlap policy: latest start wins, totals never exceed wall-clock time", () => {
  it("keeps disjoint intervals unchanged", () => {
    const r = resolveOverlaps([{ id: "a", start: 0, end: 10 }, { id: "b", start: 20, end: 30 }]);
    expect(r).toEqual([{ id: "a", start: 0, end: 10 }, { id: "b", start: 20, end: 30 }]);
  });

  it("gives the overlap to the session that started later", () => {
    const r = resolveOverlaps([{ id: "a", start: 0, end: 60 }, { id: "b", start: 30, end: 90 }]);
    expect(r).toEqual([{ id: "a", start: 0, end: 30 }, { id: "b", start: 30, end: 90 }]);
  });

  it("handles a session nested inside another (a resumes afterwards)", () => {
    const r = resolveOverlaps([{ id: "a", start: 0, end: 100 }, { id: "b", start: 40, end: 60 }]);
    expect(r).toEqual([{ id: "a", start: 0, end: 40 }, { id: "b", start: 40, end: 60 }, { id: "a", start: 60, end: 100 }]);
    expect(r.reduce((s, x) => s + x.end - x.start, 0)).toBe(100);
  });

  it("breaks exact ties deterministically", () => {
    const r = resolveOverlaps([{ id: "a", start: 0, end: 10, createdAt: 1 }, { id: "b", start: 0, end: 10, createdAt: 2 }]);
    expect(r).toEqual([{ id: "b", start: 0, end: 10 }]);
  });

  it("reports overlapping pairs", () => {
    expect(findOverlaps([{ id: "a", start: 0, end: 10 }, { id: "b", start: 5, end: 15 }, { id: "c", start: 20, end: 30 }])).toEqual([["a", "b"]]);
  });

  it("stats total of overlapping sessions equals their union", () => {
    const a = sess(t(2026, 11, 25, 9), t(2026, 11, 25, 11), "work");
    const b = sess(t(2026, 11, 25, 10), t(2026, 11, 25, 12), "study");
    const st = computeStats({ sessions: [a, b], blocks: [], categories: CATS, range: { start: t(2026, 11, 25), end: t(2026, 11, 26) }, now: t(2026, 11, 26) });
    expect(st.recordedMs).toBe(3 * HOUR);
    expect(st.byCategory.find((c) => c.categoryId === "work")!.recordedMs).toBe(1 * HOUR);
    expect(st.byCategory.find((c) => c.categoryId === "study")!.recordedMs).toBe(2 * HOUR);
  });
});

// ---------------------------------------------------------------- stats

describe("statistics", () => {
  const day = { start: t(2026, 11, 25), end: t(2026, 11, 26) };
  const now = t(2026, 11, 25, 18);

  it("counts actual sessions only, never planned or skipped blocks", () => {
    const st = computeStats({
      sessions: [sess(t(2026, 11, 25, 15, 10), t(2026, 11, 25, 16, 20), "study")],
      blocks: [blk(t(2026, 11, 25, 15), t(2026, 11, 25, 16, 30), "study", "completed"), blk(t(2026, 11, 25, 17), t(2026, 11, 25, 18), "work", "skipped"), blk(t(2026, 11, 25, 20), t(2026, 11, 25, 21), "work")],
      categories: CATS, range: day, now,
    });
    expect(st.recordedMs).toBe(70 * MINUTE);
    expect(st.plannedMs).toBe(90 * MINUTE + 60 * MINUTE); // skipped block excluded
  });

  it("counts multi-tag sessions once in totals but fully per tag", () => {
    const st = computeStats({ sessions: [sess(t(2026, 11, 25, 9), t(2026, 11, 25, 10), "study", ["houdini", "vex"])], blocks: [], categories: CATS, range: day, now });
    expect(st.recordedMs).toBe(HOUR);
    expect(st.byTag.find((x) => x.tagId === "houdini")!.recordedMs).toBe(HOUR);
    expect(st.byTag.find((x) => x.tagId === "vex")!.recordedMs).toBe(HOUR);
    expect(st.byCategory.find((x) => x.categoryId === "study")!.recordedMs).toBe(HOUR);
  });

  it("filters by tag and by category (including subcategories)", () => {
    const sessions = [
      sess(t(2026, 11, 25, 9), t(2026, 11, 25, 10), "study", ["houdini"]),
      sess(t(2026, 11, 25, 10), t(2026, 11, 25, 11, 30), "study", ["drawing"]),
      sess(t(2026, 11, 25, 12), t(2026, 11, 25, 12, 30), "houdini-study"),
      sess(t(2026, 11, 25, 13), t(2026, 11, 25, 17), "work", ["houdini"]),
    ];
    const studyOnly = computeStats({ sessions, blocks: [], categories: CATS, range: day, now, filter: { categoryIds: ["study"] } });
    expect(studyOnly.recordedMs).toBe(3 * HOUR);
    const studyHoudini = computeStats({ sessions, blocks: [], categories: CATS, range: day, now, filter: { categoryIds: ["study"], tagIds: ["houdini"] } });
    expect(studyHoudini.recordedMs).toBe(HOUR);
    expect(expandCategoryIds(["study"], CATS).has("houdini-study")).toBe(true);
  });

  it("clips to the range and splits midnight-crossing sessions per day", () => {
    const s = sess(t(2026, 11, 24, 23), t(2026, 11, 25, 2), "work");
    const st = computeStats({ sessions: [s], blocks: [], categories: CATS, range: day, now });
    expect(st.recordedMs).toBe(2 * HOUR);
    const wk = computeStats({ sessions: [s], blocks: [], categories: CATS, range: { start: t(2026, 11, 23), end: t(2026, 11, 30) }, now });
    expect(wk.byDay.get("2026-11-24")!.get("work")).toBe(HOUR);
    expect(wk.byDay.get("2026-11-25")!.get("work")).toBe(2 * HOUR);
  });

  it("counts a running session up to now", () => {
    const st = computeStats({ sessions: [sess(t(2026, 11, 25, 17), null, "work")], blocks: [], categories: CATS, range: day, now });
    expect(st.recordedMs).toBe(HOUR);
  });

  it("reports break time separately", () => {
    const st = computeStats({ sessions: [sess(t(2026, 11, 25, 9), t(2026, 11, 25, 10), "work"), sess(t(2026, 11, 25, 10), t(2026, 11, 25, 10, 15), "break")], blocks: [], categories: CATS, range: day, now });
    expect(st.recordedMs).toBe(HOUR);
    expect(st.breakMs).toBe(15 * MINUTE);
    expect(st.sessionCount).toBe(1);
  });

  it("buckets by week and month for long ranges", () => {
    const sessions = [sess(t(2026, 1, 5, 9), t(2026, 1, 5, 10), "work"), sess(t(2026, 2, 10, 9), t(2026, 2, 10, 11), "work")];
    const st = computeStats({ sessions, blocks: [], categories: CATS, range: { start: t(2026, 1, 1), end: t(2027, 1, 1) }, now, bucket: "month" });
    expect(st.buckets).toHaveLength(12);
    expect(st.buckets[0].totalMs).toBe(HOUR);
    expect(st.buckets[1].totalMs).toBe(2 * HOUR);
  });
});

// ------------------------------------------------------------- calendar

describe("calendar interactions", () => {
  const day = t(2026, 11, 25);

  it("snaps minutes", () => {
    expect(snapMinute(547, 15)).toBe(540);
    expect(snapMinute(553, 15)).toBe(555);
    expect(snapMinute(553, 5)).toBe(555);
    expect(pxToMinute(112, 56, 0, 15)).toBe(120);
  });

  it("drag 09:00 → 11:30 creates that interval, in either direction", () => {
    expect(dragToInterval(day, 540, 690, 15)).toEqual({ start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 11, 30) });
    expect(dragToInterval(day, 690, 540, 15)).toEqual({ start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 11, 30) });
    expect(dragToInterval(day, 540, 540, 15)).toEqual({ start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 9, 15) });
  });

  it("moves keep duration, including to another day", () => {
    const iv = { start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 10, 30) };
    expect(moveInterval(iv, t(2026, 11, 27), 14 * 60)).toEqual({ start: t(2026, 11, 27, 14), end: t(2026, 11, 27, 15, 30) });
  });

  it("resizes either edge with a minimum length", () => {
    const iv = { start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 10) };
    expect(resizeInterval(iv, "end", 11 * 60, 15).end).toBe(t(2026, 11, 25, 11));
    expect(resizeInterval(iv, "start", 8 * 60, 15).start).toBe(t(2026, 11, 25, 8));
    expect(resizeInterval(iv, "end", 8 * 60, 15).end).toBe(t(2026, 11, 25, 9, 15)); // cannot invert
    expect(resizeInterval(iv, "end", 1440, 15).end).toBe(t(2026, 11, 26)); // to midnight
  });

  it("splits and refuses slivers", () => {
    const iv = { start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 10) };
    expect(splitInterval(iv, t(2026, 11, 25, 9, 30))).toEqual([{ start: iv.start, end: t(2026, 11, 25, 9, 30) }, { start: t(2026, 11, 25, 9, 30), end: iv.end }]);
    expect(splitInterval(iv, t(2026, 11, 25, 9, 2))).toBeNull();
    expect(splitPoint({ start: t(2026, 11, 25, 9), end: t(2026, 11, 25, 10, 10) }, 15)).toBe(t(2026, 11, 25, 9, 30));
  });

  it("merges only same-category adjacent blocks", () => {
    const a = blk(t(2026, 11, 25, 9), t(2026, 11, 25, 10), "work");
    const b = blk(t(2026, 11, 25, 10), t(2026, 11, 25, 11), "work");
    const c = blk(t(2026, 11, 25, 11), t(2026, 11, 25, 12), "study");
    const d = blk(t(2026, 11, 25, 13), t(2026, 11, 25, 14), "work");
    expect(canMerge(a, b)).toBe(true);
    expect(canMerge(b, c)).toBe(false);
    expect(canMerge(a, d)).toBe(false);
  });

  it("lays overlapping blocks side by side", () => {
    const lay = layoutColumns([
      { id: "a", startAt: 0, endAt: 10 },
      { id: "b", startAt: 5, endAt: 15 },
      { id: "c", startAt: 20, endAt: 30 },
    ]);
    expect(lay.get("a")).toEqual({ col: 0, cols: 2 });
    expect(lay.get("b")).toEqual({ col: 1, cols: 2 });
    expect(lay.get("c")).toEqual({ col: 0, cols: 1 });
  });

  it("startOfDay is stable", () => {
    expect(startOfDay(t(2026, 11, 25, 23, 59))).toBe(day);
  });
});

describe("formatting & csv", () => {
  it("formats durations and clocks", () => {
    expect(fmtDuration(4 * HOUR)).toBe("4h 00m");
    expect(fmtDuration(45 * MINUTE)).toBe("45m");
    expect(fmtDuration(70 * MINUTE, { compact: true })).toBe("1h 10m");
    expect(fmtClock(3723_000)).toBe("1:02:03");
  });
  it("writes local ISO with offset", () => {
    expect(isoLocal(t(2026, 11, 25, 9))).toBe("2026-11-25T09:00:00+01:00");
    expect(isoLocal(t(2026, 7, 1, 9))).toBe("2026-07-01T09:00:00+02:00");
  });
  it("round-trips CSV with quotes, commas and newlines", () => {
    const csv = toCsv(["a", "b"], [["x, y", 'say "hi"'], ["line\nbreak", ""]]);
    expect(parseCsv(csv)).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["line\nbreak", ""]]);
  });
});

// ------------------------------------------------------------- recurrence

describe("recurrence rules", () => {
  const days = (rrule: string, startsOn: string, from: [number, number, number], to: [number, number, number], endsOn: string | null = null) =>
    occurrencesBetween({ rrule, startsOn, endsOn }, new Date(...from).getTime(), new Date(...to).getTime()).map((d) => dayKey(d));

  it("parses and formats a readable subset of RRULE", () => {
    const r = parseRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR,MO");
    expect(r).toEqual({ freq: "WEEKLY", interval: 2, byDay: ["MO", "FR"], byMonthDay: null });
    expect(formatRule(r)).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR");
    expect(parseRule("garbage").freq).toBe("DAILY");
  });

  it("every weekday skips weekends", () => {
    expect(days("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "2026-11-25", [2026, 10, 23], [2026, 11, 2])).toEqual([
      "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-30", "2026-12-01", "2026-12-02",
    ]);
  });

  it("every 2 weeks keeps parity from the start week", () => {
    expect(days("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR", "2026-11-27", [2026, 10, 1], [2027, 0, 1])).toEqual(["2026-11-27", "2026-12-11", "2026-12-25"]);
  });

  it("monthly on the 31st falls back to the last day of shorter months", () => {
    expect(days("FREQ=MONTHLY;BYMONTHDAY=31", "2027-01-31", [2027, 0, 1], [2027, 3, 30])).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  });

  it("daily with interval across the DST change, honouring ends_on", () => {
    expect(days("FREQ=DAILY;INTERVAL=2", "2026-10-23", [2026, 9, 20], [2026, 10, 3], "2026-10-31")).toEqual([
      "2026-10-23", "2026-10-25", "2026-10-27", "2026-10-29", "2026-10-31",
    ]);
  });

  it("describes rules in plain language", () => {
    expect(describeRule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")).toBe("Every weekday");
    expect(describeRule("FREQ=WEEKLY;BYDAY=FR")).toBe("Every week on Friday");
    expect(describeRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH")).toBe("Every 2 weeks on Mon, Thu");
    expect(describeRule("FREQ=MONTHLY;BYMONTHDAY=1")).toBe("Monthly on the 1st");
    expect(describeRule("FREQ=DAILY")).toBe("Every day");
  });
});

describe("focus transitions", () => {
  it("flowtime break table", () => {
    expect([10, 30, 60, 120].map((m) => flowtimeBreakMinutes(m * MINUTE))).toEqual([5, 8, 10, 15]);
  });
  it("long break every Nth round", () => {
    const p = { focus: 25, brk: 5, long: 15, every: 4 };
    expect([1, 2, 3, 4, 5, 8].map((r) => breakLength(p, r))).toEqual([5, 5, 5, 15, 5, 15]);
  });
  it("nothing happens while paused or before the deadline", () => {
    const f: FocusState = { kind: "pomodoro", phase: "focus", preset: { focus: 25, brk: 5, long: 15, every: 4 }, phaseStart: 0, phaseEnd: 1000, round: 0, pausedRemaining: null, suggestedBreakMin: null, categoryId: "c", tagIds: [], title: null, blockId: null };
    expect(nextStep(f, 999).type).toBe("none");
    expect(nextStep({ ...f, pausedRemaining: 5 }, 5000).type).toBe("none");
    expect(nextStep(f, 1000)).toEqual({ type: "focus-done", at: 1000, breakMinutes: 5, round: 1 });
  });
});

describe("advanced analytics", () => {
  it("planned time per bucket excludes breaks and skipped blocks", () => {
    const cats = [{ id: "w", isBreak: false }, { id: "b", isBreak: true }] as Category[];
    const blk = (id: string, cat: string, d: number, h0: number, h1: number, status: Block["status"] = "planned") =>
      ({ id, categoryId: cat, startAt: t(2026, 11, d, h0), endAt: t(2026, 11, d, h1), status, tagIds: [], createdAt: 0 }) as unknown as Block;
    const st = computeStats({
      sessions: [],
      blocks: [blk("a", "w", 23, 9, 12), blk("b", "b", 23, 12, 13), blk("c", "w", 24, 9, 11, "skipped"), blk("d", "w", 25, 22, 26)],
      categories: cats,
      range: { start: t(2026, 11, 23), end: t(2026, 11, 30) },
      now: t(2026, 11, 23),
    });
    expect(st.buckets.map((b) => b.plannedMs / HOUR)).toEqual([3, 0, 2, 2, 0, 0, 0]); // midnight-crossing block split
  });

  it("active-day runs ignore an empty today", () => {
    const day = (d: number, h: number) => ({ day: t(2026, 11, d), ms: h * HOUR });
    expect(activeRuns([day(20, 1), day(21, 0), day(22, 2), day(23, 1), day(24, 3), day(25, 0)], t(2026, 11, 25))).toEqual({ longest: 3, current: 3, active: 4 });
  });
});

describe("day log", () => {
  const D = t(2026, 11, 25);
  const blocks: Block[] = [{ id: "b1", title: "Client X boards", categoryId: "work" } as Block];
  it("builds a markdown timeline from recorded sessions, titles first, merging resumed sessions", () => {
    const sessions = [
      sess(t(2026, 11, 25, 9), t(2026, 11, 25, 10, 30), "study", [], { title: "Houdini VEX" }),
      sess(t(2026, 11, 25, 10, 30), t(2026, 11, 25, 10, 45), "break"),
      sess(t(2026, 11, 25, 11), t(2026, 11, 25, 12), "work", [], { blockId: "b1" }),
      sess(t(2026, 11, 25, 12), t(2026, 11, 25, 13), "work", [], { blockId: "b1" }), // resumed: merges
      sess(t(2026, 11, 24, 23), t(2026, 11, 25, 0, 30), "work"), // crosses midnight: clipped
      sess(t(2026, 11, 25, 14), null, "study", [], { title: "Running *thing*" }),
    ];
    const log = buildDayLog(D, sessions, blocks, CATS, [], t(2026, 11, 25, 14, 20));
    expect(log.entries.map((e) => e.title)).toEqual(["work", "Houdini VEX", "break", "Client X boards", "Running *thing*"]);
    expect(log.entries[3].end - log.entries[3].start).toBe(2 * HOUR);
    expect(log.breakMs).toBe(15 * MINUTE);
    expect(log.totalMs).toBe(30 * MINUTE + 90 * MINUTE + 2 * HOUR + 20 * MINUTE);
    const md = dayLogMarkdown(log);
    expect(md).toContain("- 09:00–10:30 **Houdini VEX** · study · 1h 30m");
    expect(md).toContain("- 10:30–10:45 break · 15m");
    expect(md).toContain("- 11:00–13:00 **Client X boards** · work · 2h");
    expect(md).toContain("- 00:00–00:30 **work** · 30m");
    expect(md).toContain("- 14:00–now **Running \\*thing\\*** · study · 20m");
    expect(md).toMatch(/\*\*Total 4h 20m\*\* · work 2h 30m · study 1h 50m · Breaks 15m\n$/);
  });
  it("handles empty days and multi-day exports", () => {
    const empty = buildDayLog(D, [], [], CATS, [], D);
    expect(dayLogMarkdown(empty, { heading: false })).toBe("Nothing recorded.\n");
    const d2 = buildDayLog(addDays(D, 1), [sess(t(2026, 11, 26, 9), t(2026, 11, 26, 10), "work")], [], CATS, [], t(2026, 11, 27));
    const md = rangeLogMarkdown([empty, d2]);
    expect(md.startsWith("## Thursday 26 November 2026\n\n- 09:00–10:00 **work** · 1h")).toBe(true);
  });
});

describe("progression", () => {
  it("accumulates lifetime hours per tag and category (parents include children) and dates each milestone", () => {
    const sessions: Session[] = [];
    // 3h of Houdini study on 5 days a week for 4 weeks = 60h
    for (let w = 0; w < 4; w++) for (let d = 0; d < 5; d++) sessions.push(sess(t(2026, 10, 5 + w * 7 + d, 9), t(2026, 10, 5 + w * 7 + d, 12), "houdini-study", ["houdini"]));
    sessions.push(sess(t(2026, 10, 5, 12), t(2026, 10, 5, 13), "break"));
    const L = buildLedger(sessions, CATS, t(2026, 11, 1));
    const p = milestoneProgress(L.byTag.get("houdini"), DEFAULT_LADDER);
    expect(p.totalMs).toBe(60 * HOUR);
    expect(p.reached.map((r) => r.hours)).toEqual([10, 25, 50]);
    expect(p.reached[0].day).toBe("2026-10-08"); // 4th day: 12h
    expect(p.nextHours).toBe(100);
    expect(p.pctToNext).toBeCloseTo(10 / 50);
    // parent "study" includes its subcategory; breaks are not intentional time
    expect(milestoneProgress(L.byCategory.get("study"), DEFAULT_LADDER).totalMs).toBe(60 * HOUR);
    expect([...L.intentional.values()].reduce((a, b) => a + b, 0)).toBe(60 * HOUR);
  });

  it("weekly streaks ignore rest days and never break on the running week", () => {
    const s = new Map<string, number>([
      ["2026-11-02", HOUR], // Mon, week 1
      ["2026-11-14", 2 * HOUR], // Sat, week 2 (only one day that week: still counts)
      ["2026-11-20", HOUR], // Fri, week 3
    ]);
    const st = weekStreak(s, t(2026, 11, 24, 10), 1); // Tuesday of week 4, nothing yet this week
    expect(st.current).toBe(3);
    expect(st.longest).toBe(3);
    expect(st.firstReached.get(3)).toBe("2026-11-16");
    s.delete("2026-11-14");
    expect(weekStreak(s, t(2026, 11, 24, 10), 1).current).toBe(1);
  });

  it("balanced weeks need 3 active days and no day past the working day", () => {
    const s = new Map<string, number>([
      ["2026-11-02", 6 * HOUR], ["2026-11-03", 7 * HOUR], ["2026-11-04", 8 * HOUR], // balanced
      ["2026-11-09", 6 * HOUR], ["2026-11-10", 11 * HOUR], ["2026-11-11", 6 * HOUR], // one long day
    ]);
    expect(balancedWeeks(s, 8 * HOUR, 1, t(2026, 11, 25))).toEqual(["2026-11-02"]);
  });

  it("derives achievements, caps intentional hours per day, and shows the next locked tier", () => {
    const sessions: Session[] = [];
    for (let i = 0; i < 12; i++) sessions.push(sess(t(2026, 9, 1 + i, 8), t(2026, 9, 1 + i, 20), "work", [], { mode: "stopwatch" })); // 12h days
    const L = buildLedger(sessions, CATS, t(2026, 11, 1));
    const all = deriveAchievements({ ledger: L, categories: CATS, tags: [], ladder: DEFAULT_LADDER, workdayHours: 8, weekStartsOn: 1, now: t(2026, 11, 1) });
    const life = all.filter((a) => a.kind === "lifetime");
    // 12 days × 8h cap = 96h: the 100h tier is not reached despite 144 raw hours
    expect(life).toHaveLength(1);
    expect(life[0].day).toBeNull();
    expect(life[0].progress?.value).toBe(96);
    const deep = all.filter((a) => a.kind === "deep");
    expect(deep[0].day).toBe("2026-09-10"); // 10th session
    expect(deep[1].day).toBeNull();
    expect(all.find((a) => a.id === "milestone:category:work:100")?.day).toBe("2026-09-09");
    expect(all.some((a) => a.kind === "balance" && a.day)).toBe(false); // 12h days are never "balanced"
  });
});

describe("summaries", () => {
  it("compares a week with the previous one and with the same week last year, and exports Markdown", () => {
    const wk = periodOf("week", t(2026, 11, 25), 1);
    expect(wk.start).toBe(t(2026, 11, 23));
    expect(comparisonOf("week", wk, "previous", 1).start).toBe(t(2026, 11, 16));
    expect(new Date(comparisonOf("week", wk, "last_year", 1).start).getDay()).toBe(1);
    expect(isoWeek(t(2026, 11, 25))).toEqual({ year: 2026, week: 48 });
    expect(isoWeek(t(2027, 1, 1))).toEqual({ year: 2026, week: 53 });
    expect(periodFileName("week", wk)).toBe("2026-W48.md");
    const sessions = [
      sess(t(2026, 11, 23, 9), t(2026, 11, 23, 13), "work", ["houdini"]),
      sess(t(2026, 11, 24, 9), t(2026, 11, 24, 10), "study"),
      sess(t(2026, 11, 17, 9), t(2026, 11, 17, 11), "work"),
    ];
    const s = periodSummary({ kind: "week", range: wk, compareRange: comparisonOf("week", wk, "previous", 1), sessions, blocks: [], categories: CATS, tags: [{ id: "houdini", name: "Houdini" } as never], now: t(2026, 11, 30), weekStartsOn: 1 });
    expect(s.recordedMs).toBe(5 * HOUR);
    expect(s.prevRecordedMs).toBe(2 * HOUR);
    expect(s.categories.map((r) => [r.name, r.ms / HOUR, r.prevMs / HOUR])).toEqual([["work", 4, 2], ["study", 1, 0]]);
    const md = summaryMarkdown(s, { compareLabel: "last week" });
    expect(md).toMatch(/^---\ntype: interval-week\nperiod: 2026-W48\nstart: 2026-11-23\nend: 2026-11-29\ntotal_hours: 5\n/);
    expect(md).toContain("hours_work: 4");
    expect(md).toContain("generator: interval");
    expect(md).toContain("| work | 4h | +2h |");
    expect(md).toContain("| study | 1h | new |");
    expect(md).toContain("- #Houdini 4h");
  });
});

describe("shortcuts", () => {
  const ev = (key: string, m: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key, ctrlKey: false, altKey: false, shiftKey: false, ...m });
  it("normalises key events and applies overrides", () => {
    expect(comboOf(ev("T"))).toBe("t");
    expect(comboOf(ev("e", { ctrlKey: true }))).toBe("ctrl+e");
    expect(comboOf(ev("F2", { shiftKey: true }))).toBe("shift+f2");
    expect(comboOf(ev("?", { shiftKey: true }))).toBe("?");
    expect(comboOf(ev("Shift", { shiftKey: true }))).toBe("");
    const b = bindings({ today: "g", focusMode: "" });
    expect(b.get("g")).toBe("today");
    expect(b.has("t")).toBe(false);
    expect([...b.values()]).not.toContain("focusMode");
    expect(prettyKey("ctrl+shift+f2")).toBe("Ctrl Shift F2");
  });
});
