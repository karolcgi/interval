// Reviews: weekly and monthly summaries and a year in review, each compared with the previous
// period or the same period last year. Copy as Markdown, save a file, or write it into Obsidian.
import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, ClipboardCopy, Download, NotebookPen } from "lucide-react";
import { useApp, useNow } from "../state/store";
import * as A from "../state/actions";
import * as repo from "../db/repo";
import { useLifetime } from "../state/lifetime";
import { writeNote } from "../state/obsidian";
import { comparisonOf, periodFileName, periodOf, periodSummary, periodTitle, summaryMarkdown, type CompareTo, type PeriodSummary, type SummaryPeriod } from "../domain/summary";
import { milestoneProgress, seriesIn, deepSessions, type DaySeries } from "../domain/progression";
import { addDays, dayKey, parseDayKey, HOUR } from "../domain/time";
import { fmt, fmtDuration } from "../domain/format";
import type { Block, Interval } from "../domain/types";
import { CatDot, catVars, Segmented, useElementWidth } from "./bits";
import { copyText } from "./DayLogView";

const dur = (ms: number) => fmtDuration(ms, { compact: true });

export function ReviewsView() {
  const db = useApp((s) => s.db);
  const categories = useApp((s) => s.categories);
  const tags = useApp((s) => s.tags);
  const settings = useApp((s) => s.settings);
  const personal = useApp((s) => s.achievements);
  const now = useNow(5 * 60_000);
  const life = useLifetime();
  const [kind, setKind] = useState<SummaryPeriod>("week");
  const [offset, setOffset] = useState(-1); // last finished period by default
  const [compare, setCompare] = useState<CompareTo>("previous");
  useEffect(() => setOffset(kind === "year" ? 0 : -1), [kind]);

  const range = useMemo(() => periodOf(kind, now, settings.weekStartsOn, offset), [kind, now, settings.weekStartsOn, offset]);
  const compareRange = useMemo(() => comparisonOf(kind, range, compare, settings.weekStartsOn), [kind, range, compare, settings.weekStartsOn]);
  const [blocks, setBlocks] = useState<Block[] | null>(null);
  useEffect(() => {
    if (!db) return;
    let alive = true;
    void repo.listBlocks(db, Math.min(range.start, compareRange.start), Math.max(range.end, compareRange.end)).then((b) => alive && setBlocks(b));
    return () => {
      alive = false;
    };
  }, [db, range, compareRange]);

  const sum = useMemo(
    () =>
      life && blocks
        ? periodSummary({ kind, range, compareRange, sessions: life.sessions, blocks, categories, tags, now, weekStartsOn: settings.weekStartsOn, achievements: life.achievements })
        : null,
    [life, blocks, kind, range, compareRange, categories, tags, now, settings.weekStartsOn],
  );
  const compareLabel = compare === "last_year" ? `same ${kind} last year` : `last ${kind}`;
  const personalIn = personal.filter((a) => a.achievedOn >= dayKey(range.start) && a.achievedOn <= dayKey(range.end - 1));
  const yearExtra = useMemo(() => (kind === "year" && life ? yearHighlights(life.ledger.byTag, tags, range, settings.milestoneHours) : []), [kind, life, tags, range, settings.milestoneHours]);

  const markdown = useMemo(() => {
    if (!sum) return "";
    const extra: string[] = [];
    if (yearExtra.length) {
      extra.push("## Skills this year", "", ...yearExtra.map((y) => `- #${y.name.replace(/\s+/g, "-")} +${dur(y.gainedMs)} (${dur(y.totalMs)} lifetime${y.levelsGained ? `, +${y.levelsGained} level${y.levelsGained > 1 ? "s" : ""}` : ""})`), "");
    }
    if (personalIn.length) extra.push("## Personal achievements", "", ...personalIn.map((a) => `- ${a.achievedOn} ${a.title}`), "");
    return summaryMarkdown(sum, { compareLabel, extra: extra.join("\n") });
  }, [sum, compareLabel, yearExtra, personalIn]);

  const isFuture = range.start > now;
  const canNext = periodOf(kind, now, settings.weekStartsOn, offset + 1).start <= now;

  const toVault = async () => {
    const path = await writeNote(kind, periodFileName(kind, range), markdown);
    if (path) A.toast(`Saved ${path}`);
  };

  return (
    <section className="page reviews">
      <header className="page-head">
        <div>
          <div className="eyebrow">Look back</div>
          <h1 className="page-title">Reviews</h1>
        </div>
        <Segmented value={kind} onChange={setKind} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "year", label: "Year in review" }]} ariaLabel="Period" />
      </header>

      <div className="rev-bar">
        <button className="icon-btn" onClick={() => setOffset(offset - 1)} aria-label="Previous period">
          <ChevronLeft size={15} />
        </button>
        <h2 className="rev-title">{periodTitle(kind, range)}</h2>
        <button className="icon-btn" onClick={() => setOffset(offset + 1)} disabled={!canNext} aria-label="Next period">
          <ChevronRight size={15} />
        </button>
        <span className="grow" />
        <span className="muted small">Compare with</span>
        <Segmented value={compare} onChange={setCompare} size="sm" options={[{ value: "previous", label: kind === "year" ? "Last year" : `Last ${kind}` }, { value: "last_year", label: "A year ago" }]} ariaLabel="Compare with" />
      </div>

      {!sum || isFuture ? (
        <p className="muted small">{isFuture ? "This period hasn’t started." : "Loading…"}</p>
      ) : (
        <>
          <div className="kpis rev-kpis">
            <Kpi label="Recorded" value={dur(sum.recordedMs)} cur={sum.recordedMs} prev={sum.prevRecordedMs} vs={compareLabel} />
            <Kpi label="Planned" value={dur(sum.plannedMs)} sub={sum.plannedMs ? `${Math.round((sum.recordedMs / sum.plannedMs) * 100)}% realised` : undefined} />
            <Kpi label="Active days" value={String(sum.activeDays)} cur={sum.activeDays} prev={sum.prevActiveDays} vs={compareLabel} count />
            <Kpi label="Focused" value={dur(sum.focusedMs)} sub={`${sum.sessions} sessions`} />
            <Kpi label="Breaks" value={dur(sum.breakMs)} />
          </div>

          <Bars sum={sum} />

          <div className="rev-cols">
            <div>
              <h3 className="rev-h">Categories</h3>
              <CompareRows rows={sum.categories} vs={compareLabel} />
            </div>
            <div>
              <h3 className="rev-h">Tags</h3>
              {sum.tags.length ? <CompareRows rows={sum.tags.slice(0, 12)} vs={compareLabel} tag /> : <p className="muted small">No tagged time.</p>}
            </div>
          </div>

          {kind === "year" && life && (
            <>
              <h3 className="rev-h">Every day of {new Date(range.start).getFullYear()}</h3>
              <YearGrid series={life.ledger.intentional} range={range} />
              {yearExtra.length > 0 && (
                <>
                  <h3 className="rev-h">Skills this year</h3>
                  <ul className="rev-skills">
                    {yearExtra.map((y) => (
                      <li key={y.id}>
                        <span>#{y.name}</span>
                        <span className="muted">
                          +{dur(y.gainedMs)} · {dur(y.totalMs)} lifetime
                        </span>
                        {y.levelsGained > 0 && <span className="skill-level">+{y.levelsGained} lv</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="muted small">
                {deepSessions(life.ledger).filter((d) => d >= dayKey(range.start) && d <= dayKey(range.end - 1)).length} deep work sessions this year.
              </p>
            </>
          )}

          {(sum.achievements.length > 0 || personalIn.length > 0) && (
            <>
              <h3 className="rev-h">Milestones</h3>
              <ul className="ach-list">
                {personalIn.map((a) => (
                  <li key={a.id} className="ach earned">
                    <span className="rev-day">{fmt.shortDate(parseDayKey(a.achievedOn).getTime())}</span>
                    <span className="ach-title">{a.title}</span>
                  </li>
                ))}
                {sum.achievements.map((a) => (
                  <li key={a.id} className="ach earned" style={a.color ? catVars(a.color) : undefined}>
                    <span className="rev-day">{fmt.shortDate(parseDayKey(a.day!).getTime())}</span>
                    <span className="ach-title">{a.title}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="daylog-actions">
            <button className="btn btn-outline sm" onClick={() => void copyText(markdown).then(() => A.toast("Summary copied as Markdown"))}>
              <ClipboardCopy size={13} /> Copy Markdown
            </button>
            {settings.obsidianDir ? (
              <button className="btn btn-outline sm" onClick={() => void toVault().catch(A.reportError)}>
                <NotebookPen size={13} /> Save to Obsidian
              </button>
            ) : (
              <button className="btn btn-outline sm" onClick={() => void toVault().catch(A.reportError)}>
                <Download size={13} /> Save {periodFileName(kind, range)}
              </button>
            )}
            <span className="grow" />
            {!settings.obsidianDir && (
              <button className="link-btn" onClick={() => A.setView("settings")}>
                Set an Obsidian folder
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Kpi(p: { label: string; value: string; sub?: string; cur?: number; prev?: number; vs?: string; count?: boolean }) {
  let delta: React.ReactNode = null;
  if (p.cur !== undefined && p.prev !== undefined && p.prev > 0) {
    const d = p.cur - p.prev;
    const txt = p.count ? String(Math.abs(d)) : dur(Math.abs(d));
    delta = (
      <span className="delta">
        {d >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
        {txt} vs {p.vs}
      </span>
    );
  }
  return (
    <div className="kpi">
      <div className="eyebrow">{p.label}</div>
      <div className="kpi-val">{p.value}</div>
      {p.sub && <div className="kpi-sub">{p.sub}</div>}
      {delta}
    </div>
  );
}

function CompareRows({ rows, vs, tag = false }: { rows: PeriodSummary["categories"]; vs: string; tag?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.ms, r.prevMs)));
  return (
    <ul className="dist big">
      {rows.map((r) => {
        const d = r.ms - r.prevMs;
        return (
          <li key={r.id} style={catVars(r.color ?? "var(--text-2)")}>
            <div className="dist-top">
              <span className="dist-name">
                {r.color && <CatDot color={r.color} size={6} />} {tag ? "#" : ""}
                {r.name}
              </span>
              <span className="dist-val">
                {dur(r.ms)}
                <span className={`muted rev-delta ${d > 0 ? "up" : d < 0 ? "down" : ""}`} title={`${dur(r.prevMs)} ${vs}`}>
                  {r.prevMs === 0 ? "new" : Math.abs(d) < 60_000 ? "=" : `${d > 0 ? "+" : "−"}${dur(Math.abs(d))}`}
                </span>
              </span>
            </div>
            <div className="dist-bar">
              <span className="dist-plan" style={{ width: `${(r.prevMs / max) * 100}%` }} />
              <span className="dist-act" style={{ width: `${(r.ms / max) * 100}%`, height: "100%" }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Bars({ sum }: { sum: PeriodSummary }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const H = 80;
  const max = Math.max(HOUR, ...sum.buckets.map((b) => b.ms));
  const step = sum.buckets.length ? width / sum.buckets.length : 0;
  const label = (t: number) => (sum.kind === "year" ? new Intl.DateTimeFormat(undefined, { month: "short" }).format(t) : sum.kind === "week" ? fmt.weekdayShort(t) : String(new Date(t).getDate()));
  return (
    <div className="chart rev-bars" ref={ref}>
      {width > 0 && (
        <svg width={width} height={H + 18} role="img" aria-label="Recorded time per day">
          {sum.buckets.map((b, i) => {
            const bh = (b.ms / max) * H;
            const bw = Math.max(2, Math.min(28, step * 0.6));
            return (
              <g key={b.start}>
                <title>{`${label(b.start)}: ${dur(b.ms)}`}</title>
                <rect x={i * step + (step - bw) / 2} y={H - bh} width={bw} height={bh} rx={1.5} className="pva-act" />
                {(sum.kind !== "month" || i % 5 === 0) && (
                  <text x={i * step + step / 2} y={H + 13} textAnchor="middle" className="axis-label">
                    {label(b.start)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function YearGrid({ series, range }: { series: DaySeries; range: Interval }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const days: Array<{ t: number; ms: number }> = [];
  for (let d = range.start; d < range.end; d = addDays(d, 1)) days.push({ t: d, ms: series.get(dayKey(d)) ?? 0 });
  const max = Math.max(1, ...days.map((d) => d.ms));
  const offset = (new Date(range.start).getDay() + 6) % 7;
  const weeks = Math.ceil((days.length + offset) / 7);
  const gap = 3;
  const cell = Math.max(5, Math.min(13, Math.floor((width - gap * weeks) / weeks)));
  const lvl = (ms: number) => (ms <= 0 ? 0 : Math.min(4, 1 + Math.floor((ms / max) * 4)));
  return (
    <div className="heatmap" ref={ref}>
      {width > 0 && (
        <svg width={width} height={7 * (cell + gap)} role="img" aria-label="Recorded time per day this year">
          {days.map((d, i) => {
            const k = i + offset;
            return (
              <rect key={d.t} x={Math.floor(k / 7) * (cell + gap)} y={(k % 7) * (cell + gap)} width={cell} height={cell} rx={2} className={`hm-cell l${lvl(d.ms)}`} style={lvl(d.ms) ? { fill: "var(--text-2)" } : undefined} onClick={() => A.openDay(d.t)}>
                <title>{`${fmt.full(d.t)}: ${d.ms ? dur(d.ms) : "nothing recorded"}`}</title>
              </rect>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function yearHighlights(byTag: Map<string, DaySeries>, tags: Array<{ id: string; name: string }>, range: Interval, ladder: number[]) {
  const out: Array<{ id: string; name: string; gainedMs: number; totalMs: number; levelsGained: number }> = [];
  for (const t of tags) {
    const s = byTag.get(t.id);
    if (!s) continue;
    const gainedMs = seriesIn(s, range);
    if (gainedMs < HOUR) continue;
    const upTo = new Map([...s].filter(([d]) => d <= dayKey(range.end - 1)));
    const before = new Map([...s].filter(([d]) => d < dayKey(range.start)));
    const end = milestoneProgress(upTo, ladder);
    out.push({ id: t.id, name: t.name, gainedMs, totalMs: end.totalMs, levelsGained: end.level - milestoneProgress(before, ladder).level });
  }
  return out.sort((a, b) => b.gainedMs - a.gainedMs).slice(0, 10);
}
