// Day log: an automatic diary of what actually happened, built from recorded sessions.
// Browse any past day, copy it as Markdown or save it as YYYY-MM-DD.md (Obsidian's daily-note name).
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ClipboardCopy, Download } from "lucide-react";
import { useApp, useNow } from "../state/store";
import * as A from "../state/actions";
import * as repo from "../db/repo";
import type { Block, Session } from "../domain/types";
import { buildDayLog, dayLogFileName, dayLogMarkdown, rangeLogMarkdown, type DayLog } from "../domain/daylog";
import { addDays, addMonths, dayKey, isSameDay, startOfDay, startOfMonth, startOfWeek } from "../domain/time";
import { fmt, fmtDuration, fmtTime } from "../domain/format";
import { saveTextFile } from "../platform";
import { CatDot, Segmented } from "./bits";

const RECENT_DAYS = 60;

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/** Sessions and blocks for [start, end), reloaded when the running session or the visible data changes. */
export function useRecorded(start: number, end: number) {
  const db = useApp((s) => s.db);
  const runningId = useApp((s) => s.running?.id);
  const version = useApp((s) => s.sessions);
  const [data, setData] = useState<{ sessions: Session[]; blocks: Block[] } | null>(null);
  useEffect(() => {
    if (!db) return;
    let alive = true;
    void Promise.all([repo.listSessions(db, start, end), repo.listBlocks(db, start, end)]).then(([sessions, blocks]) => alive && setData({ sessions, blocks }));
    return () => {
      alive = false;
    };
  }, [db, start, end, runningId, version]);
  return data;
}

export function useDayLog(day: number): DayLog | null {
  const categories = useApp((s) => s.categories);
  const tags = useApp((s) => s.tags);
  const now = useNow(30_000);
  const data = useRecorded(day, addDays(day, 1));
  return useMemo(() => (data ? buildDayLog(day, data.sessions, data.blocks, categories, tags, now) : null), [data, day, categories, tags, now]);
}

export function DayLogView() {
  const storeDate = useApp((s) => s.date);
  const timeFormat = useApp((s) => s.settings.timeFormat);
  const weekStartsOn = useApp((s) => s.settings.weekStartsOn);
  const categories = useApp((s) => s.categories);
  const tags = useApp((s) => s.tags);
  const now = useNow(30_000);
  const today = startOfDay(now);
  const [day, setDay] = useState(() => Math.min(startOfDay(storeDate), today));
  const [mode, setMode] = useState<"timeline" | "markdown">("timeline");
  const log = useDayLog(day);
  const md = useMemo(() => (log ? dayLogMarkdown(log, { timeFormat }) : ""), [log, timeFormat]);

  // Recent days with anything recorded, for quick browsing.
  const recentStart = addDays(today, -RECENT_DAYS + 1);
  const recent = useRecorded(recentStart, addDays(today, 1));
  const recentDays = useMemo(() => {
    if (!recent) return [];
    const out: Array<{ day: number; ms: number }> = [];
    for (let d = today; d >= recentStart; d = addDays(d, -1)) {
      const l = buildDayLog(d, recent.sessions, recent.blocks, categories, tags, now);
      if (l.entries.length) out.push({ day: d, ms: l.totalMs });
    }
    return out;
  }, [recent, today, recentStart, categories, tags, now]);

  const copy = async () => {
    await copyText(md);
    A.toast("Day log copied as Markdown");
  };
  const save = async () => {
    const path = await saveTextFile(dayLogFileName(day), md, "md");
    if (path) A.toast(`Saved ${path}`);
  };
  const db = useApp((s) => s.db);
  const exportRange = async (which: "week" | "month") => {
    if (!db) return;
    const start = which === "week" ? startOfWeek(day, weekStartsOn) : startOfMonth(day);
    const end = which === "week" ? addDays(start, 7) : addMonths(start, 1);
    const [sessions, blocks] = await Promise.all([repo.listSessions(db, start, end), repo.listBlocks(db, start, end)]);
    const logs: DayLog[] = [];
    for (let d = start; d < end; d = addDays(d, 1)) logs.push(buildDayLog(d, sessions, blocks, categories, tags, Date.now()));
    const title = which === "week" ? `# Week of ${fmt.monthDay(start)} ${new Date(start).getFullYear()}` : `# ${fmt.monthYear(start)}`;
    const name = which === "week" ? `${dayKey(start)} week.md` : `${dayKey(start).slice(0, 7)}.md`;
    const path = await saveTextFile(name, `${title}\n\n${rangeLogMarkdown(logs, { timeFormat })}`, "md");
    if (path) A.toast(`Saved ${path}`);
  };

  return (
    <section className="page daylog">
      <header className="page-head">
        <div>
          <div className="eyebrow">What you actually did</div>
          <h1 className="page-title">Day log</h1>
        </div>
      </header>
      <p className="lede">Written automatically from your recorded time: when, what, which category. Copy it into Obsidian or save it as a daily note.</p>

      <div className="daylog-grid">
        <aside className="daylog-days" aria-label="Recent days">
          {recentDays.length === 0 && <p className="muted small">Nothing recorded in the last {RECENT_DAYS} days.</p>}
          {recentDays.map((r) => (
            <button key={r.day} className={`daylog-day ${r.day === day ? "on" : ""}`} onClick={() => setDay(r.day)}>
              <span>{isSameDay(r.day, today) ? "Today" : `${fmt.weekdayShort(r.day)} ${fmt.shortDate(r.day)}`}</span>
              <span className="muted">{fmtDuration(r.ms, { compact: true })}</span>
            </button>
          ))}
        </aside>

        <div className="daylog-main">
          <div className="daylog-bar">
            <button className="icon-btn" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">
              <ChevronLeft size={15} />
            </button>
            <h2 className="daylog-date">{fmt.full(day)}</h2>
            <button className="icon-btn" onClick={() => setDay(Math.min(today, addDays(day, 1)))} disabled={day >= today} aria-label="Next day">
              <ChevronRight size={15} />
            </button>
            {day !== today && (
              <button className="btn btn-ghost sm" onClick={() => setDay(today)}>
                Today
              </button>
            )}
            <span className="grow" />
            <Segmented value={mode} onChange={setMode} options={[{ value: "timeline", label: "Timeline" }, { value: "markdown", label: "Markdown" }]} />
          </div>

          {!log ? (
            <p className="muted small">Loading…</p>
          ) : mode === "markdown" ? (
            <pre className="daylog-md" aria-label="Day log Markdown">
              {md}
            </pre>
          ) : (
            <DayLogTimeline log={log} timeFormat={timeFormat} />
          )}

          <div className="daylog-actions">
            <button className="btn btn-outline sm" onClick={() => void copy().catch(A.reportError)} disabled={!log}>
              <ClipboardCopy size={13} /> Copy Markdown
            </button>
            <button className="btn btn-outline sm" onClick={() => void save().catch(A.reportError)} disabled={!log}>
              <Download size={13} /> Save {dayLogFileName(day)}
            </button>
            <span className="grow" />
            <button className="btn btn-ghost sm" onClick={() => void exportRange("week").catch(A.reportError)}>
              Save week
            </button>
            <button className="btn btn-ghost sm" onClick={() => void exportRange("month").catch(A.reportError)}>
              Save month
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function DayLogTimeline({ log, timeFormat, compact = false }: { log: DayLog; timeFormat: "24h" | "12h"; compact?: boolean }) {
  if (!log.entries.length) return <p className="muted small">Nothing recorded{compact ? " yet" : ""}.</p>;
  return (
    <>
      <ol className={`daylog-list ${compact ? "compact" : ""}`}>
        {log.entries.map((e) => (
          <li key={e.sessionIds[0]} className={e.isBreak ? "brk" : ""}>
            <span className="dl-time">
              {fmtTime(e.start, timeFormat)}–{e.running ? "now" : fmtTime(e.end, timeFormat)}
            </span>
            <CatDot color={e.color} />
            <span className="dl-title">
              {e.title}
              {e.title !== e.categoryName && <span className="muted"> · {e.categoryName}</span>}
              {e.tags.length > 0 && <span className="muted"> · {e.tags.map((t) => `#${t}`).join(" ")}</span>}
            </span>
            <span className="dl-dur muted">{fmtDuration(e.end - e.start, { compact: true })}</span>
          </li>
        ))}
      </ol>
      <div className="daylog-total small">
        <strong>{fmtDuration(log.totalMs, { compact: true })}</strong>
        {log.byCategory.map((c) => (
          <span key={c.categoryId}>
            <CatDot color={c.color} size={6} /> {c.name} {fmtDuration(c.ms, { compact: true })}
          </span>
        ))}
        {log.breakMs > 0 && <span className="muted">breaks {fmtDuration(log.breakMs, { compact: true })}</span>}
      </div>
    </>
  );
}

/** Compact day log for the details panel: follows the calendar's selected day. */
export function PanelDayLog() {
  const date = useApp((s) => s.date);
  const timeFormat = useApp((s) => s.settings.timeFormat);
  const log = useDayLog(startOfDay(date));
  return (
    <section className="panel-sec">
      <div className="sec-head">
        <h3>Day log</h3>
        <span className="sec-actions">
          <button
            className="link-btn"
            disabled={!log?.entries.length}
            onClick={() => log && void copyText(dayLogMarkdown(log, { timeFormat })).then(() => A.toast("Day log copied as Markdown"))}
          >
            Copy
          </button>
          <button className="link-btn" onClick={() => A.setView("log")}>
            Open
          </button>
        </span>
      </div>
      {log ? <DayLogTimeline log={log} timeFormat={timeFormat} compact /> : null}
    </section>
  );
}
