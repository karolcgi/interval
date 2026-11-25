// Obsidian export: write day logs and weekly/monthly/yearly summaries as Markdown into a folder
// inside the user's vault. No plugin needed. Files carry `generator: interval` in their frontmatter;
// Interval only ever replaces files that carry that marker, so a note you wrote is never touched.
//
//   <obsidianDir>/Days/2026-11-25.md
//   <obsidianDir>/Weeks/2026-W48.md
//   <obsidianDir>/Months/2026-11.md
//   <obsidianDir>/Years/2026.md

import { invoke } from "@tauri-apps/api/core";
import { store } from "./store";
import * as repo from "../db/repo";
import { isTauri, saveTextFile } from "../platform";
import { buildDayLog, dayLogMarkdown } from "../domain/daylog";
import { comparisonOf, periodFileName, periodOf, periodSummary, summaryMarkdown, type SummaryPeriod } from "../domain/summary";
import { addDays, dayKey, parseDayKey, startOfDay } from "../domain/time";
import type { Interval } from "../domain/types";
import { loadLifetime } from "./lifetime";

const FOLDER: Record<SummaryPeriod | "day", string> = { day: "Days", week: "Weeks", month: "Months", year: "Years" };

/** Writes into the vault folder (desktop), or downloads the file (browser preview / no folder set). */
export async function writeNote(kind: SummaryPeriod | "day", fileName: string, contents: string): Promise<string | null> {
  const dir = store.get().settings.obsidianDir;
  if (dir && isTauri()) return invoke<string>("write_vault_file", { dir, rel: `${FOLDER[kind]}/${fileName}`, contents });
  return saveTextFile(fileName, contents, "md");
}

export async function dayNote(day: number): Promise<{ name: string; md: string } | null> {
  const s = store.get();
  if (!s.db) return null;
  const end = addDays(day, 1);
  const [sessions, blocks, journal] = await Promise.all([repo.listSessions(s.db, day, end), repo.listBlocks(s.db, day, end), repo.listEntries(s.db, day, end)]);
  const log = buildDayLog(day, sessions, blocks, s.categories, s.tags, Date.now(), journal);
  return { name: `${dayKey(day)}.md`, md: dayLogMarkdown(log, { timeFormat: s.settings.timeFormat, frontmatter: true }) };
}

export async function periodNote(kind: SummaryPeriod, range: Interval, compare: "previous" | "last_year" = "previous") {
  const s = store.get();
  if (!s.db) return null;
  const life = await loadLifetime();
  const compareRange = comparisonOf(kind, range, compare, s.settings.weekStartsOn);
  const from = Math.min(range.start, compareRange.start);
  const to = Math.max(range.end, compareRange.end);
  const blocks = await repo.listBlocks(s.db, from, to);
  const sum = periodSummary({ kind, range, compareRange, sessions: life?.sessions ?? [], blocks, categories: s.categories, tags: s.tags, now: Date.now(), weekStartsOn: s.settings.weekStartsOn, achievements: life?.achievements });
  const label = compare === "last_year" ? `the same ${kind} last year` : `last ${kind}`;
  return { name: periodFileName(kind, range), md: summaryMarkdown(sum, { compareLabel: label }) };
}

interface AutoState {
  lastDay: string | null; // last day log written
  lastWeek: string | null; // first day of the last week summary written
}

/**
 * Automatic export, run at startup and after the evening review: writes every finished day since
 * the last automatic export (at most 14) and last week's summary if it has not been written yet.
 * Days are written once; editing a generated note afterwards is safe.
 */
export async function autoExport(now = Date.now()): Promise<number> {
  const s = store.get();
  if (!s.db || !s.settings.obsidianAuto || !s.settings.obsidianDir || !isTauri()) return 0;
  const state = (await repo.getSetting<AutoState>(s.db, "obsidian.auto")) ?? { lastDay: null, lastWeek: null };
  const today = startOfDay(now);
  let written = 0;
  let from = state.lastDay ? addDays(parseDayKey(state.lastDay).getTime(), 1) : addDays(today, -1);
  from = Math.max(from, addDays(today, -14));
  let lastDay = state.lastDay;
  for (let d = from; d < today; d = addDays(d, 1)) {
    const note = await dayNote(d);
    if (!note) break;
    if (!/Nothing recorded/.test(note.md)) {
      try {
        await writeNote("day", note.name, note.md);
        written++;
      } catch (e) {
        console.warn(e);
      }
    }
    lastDay = dayKey(d);
  }
  const lastWeekRange = periodOf("week", now, s.settings.weekStartsOn, -1);
  let lastWeek = state.lastWeek;
  if (lastWeek !== dayKey(lastWeekRange.start)) {
    const note = await periodNote("week", lastWeekRange);
    if (note) {
      try {
        await writeNote("week", note.name, note.md);
        written++;
      } catch (e) {
        console.warn(e);
      }
    }
    lastWeek = dayKey(lastWeekRange.start);
  }
  await s.db.batch([repo.setSettingStmt("obsidian.auto", { lastDay, lastWeek } satisfies AutoState)]);
  return written;
}
