import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, X } from "lucide-react";
import { useApp, useNow } from "../state/store";
import * as A from "../state/actions";
import * as repo from "../db/repo";
import type { Block, Id, Interval, Session } from "../domain/types";
import { computeStats, resolveSessions, type Bucket, type StatsFilter } from "../domain/stats";
import { DAY, dayKey, previousRange, RANGE_LABELS, resolveRange, type RangePreset } from "../domain/time";
import { fmt, fmtDuration, fmtHours, fmtTime } from "../domain/format";
import { catVars, CatDot, Segmented, useElementWidth } from "./bits";
import { Cumulative, Heatmap, PlanVsActual } from "./StatsCharts";
import { FocusHistory } from "./FocusHistory";

const PRESETS: RangePreset[] = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "this_quarter", "this_year", "last_year", "all_time", "custom"];

type Drill = { type: "category" | "tag"; id: Id } | { type: "bucket"; key: string; start: number; end: number } | null;

export function StatsView() {
  const db = useApp((s) => s.db);
  const categories = useApp((s) => s.categories);
  const tags = useApp((s) => s.tags);
  const weekStartsOn = useApp((s) => s.settings.weekStartsOn);
  const runningId = useApp((s) => s.running?.id);
  const now = useNow(60_000);

  const [preset, setPreset] = useState<RangePreset>("this_week");
  const [custom, setCustom] = useState({ from: dayKey(now - 29 * DAY), to: dayKey(now) });
  const [groupBy, setGroupBy] = useState<"category" | "tag">("category");
  const [catFilter, setCatFilter] = useState<Id[]>([]);
  const [tagFilter, setTagFilter] = useState<Id[]>([]);
  const [drill, setDrill] = useState<Drill>(null);
  const [earliest, setEarliest] = useState<number | null>(null);
  const [data, setData] = useState<{ sessions: Session[]; blocks: Block[]; key: string } | null>(null);

  useEffect(() => {
    if (db) void repo.earliestRecord(db).then(setEarliest);
  }, [db]);

  const range = useMemo(() => resolveRange(preset, now, weekStartsOn, custom, earliest ?? undefined), [preset, now, weekStartsOn, custom, earliest]);
  const prev = useMemo(() => previousRange(range), [range]);
  const loadRange: Interval = useMemo(() => ({ start: Math.min(prev.start, range.start), end: range.end }), [prev, range]);

  useEffect(() => {
    if (!db) return;
    let alive = true;
    const key = `${loadRange.start}-${loadRange.end}-${runningId ?? ""}`;
    void Promise.all([repo.listSessions(db, loadRange.start, loadRange.end), repo.listBlocks(db, loadRange.start, loadRange.end)]).then(([sessions, blocks]) => {
      if (alive) setData({ sessions, blocks, key });
    });
    return () => {
      alive = false;
    };
  }, [db, loadRange, runningId]);

  const filter: StatsFilter = useMemo(() => ({ categoryIds: catFilter, tagIds: tagFilter }), [catFilter, tagFilter]);
  const days = Math.round((range.end - range.start) / DAY);
  const bucket: Bucket = days <= 35 ? "day" : days <= 140 ? "week" : "month";

  const stats = useMemo(
    () => (data ? computeStats({ sessions: data.sessions, blocks: data.blocks, categories, range, now: Date.now(), filter, bucket, weekStartsOn }) : null),
    [data, categories, range, filter, bucket, weekStartsOn],
  );
  const prevStats = useMemo(
    () => (data && preset !== "all_time" ? computeStats({ sessions: data.sessions, blocks: data.blocks, categories, range: prev, now: Date.now(), filter, weekStartsOn }) : null),
    [data, categories, prev, filter, preset, weekStartsOn],
  );

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const toggle = (list: Id[], id: Id, set: (v: Id[]) => void) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const usedCats = categories.filter((c) => !c.archivedAt || stats?.byCategory.some((r) => r.categoryId === c.id));

  return (
    <section className="stats">
      <header className="page-head">
        <div>
          <div className="eyebrow">
            {fmt.full(range.start)} – {fmt.full(range.end - 1)}
          </div>
          <h1 className="page-title">Statistics</h1>
        </div>
      </header>

      <div className="stats-controls">
        <div className="preset-row" role="tablist" aria-label="Date range">
          {PRESETS.map((p) => (
            <button key={p} role="tab" aria-selected={p === preset} className={`chip ${p === preset ? "on" : ""}`} onClick={() => (setPreset(p), setDrill(null))}>
              {RANGE_LABELS[p]}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="custom-range">
            <input type="date" className="field sm" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="From" />
            <span className="muted">to</span>
            <input type="date" className="field sm" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="To" />
          </div>
        )}
        <div className="filter-row">
          <span className="eyebrow">Categories</span>
          {usedCats.map((c) => (
            <button key={c.id} className={`chip cat-chip ${catFilter.includes(c.id) ? "on" : ""}`} style={catVars(c.color)} onClick={() => toggle(catFilter, c.id, setCatFilter)} aria-pressed={catFilter.includes(c.id)}>
              <CatDot color={c.color} icon={c.icon} /> {c.name}
            </button>
          ))}
        </div>
        <div className="filter-row">
          <span className="eyebrow">Tags</span>
          <TagFilter selected={tagFilter} onToggle={(id) => toggle(tagFilter, id, setTagFilter)} />
          {(catFilter.length > 0 || tagFilter.length > 0) && (
            <button className="link small" onClick={() => (setCatFilter([]), setTagFilter([]))}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {!stats ? (
        <div className="muted pad">Loading…</div>
      ) : (
        <>
          <div className="kpis">
            <Kpi label="Recorded" value={fmtDuration(stats.recordedMs)} delta={prevStats ? [stats.recordedMs, prevStats.recordedMs] : undefined} big />
            <Kpi label="Planned" value={fmtDuration(stats.plannedMs)} sub={stats.plannedMs ? `${Math.round((stats.recordedMs / stats.plannedMs) * 100)}% realised` : undefined} />
            <Kpi label="Focused (timer)" value={fmtDuration(stats.focusedMs)} />
            <Kpi label="Sessions" value={String(stats.sessionCount)} sub={stats.sessionCount ? `avg ${fmtDuration(stats.avgSessionMs, { compact: true })}` : undefined} />
            <Kpi label="Daily average" value={fmtDuration(stats.avgPerActiveDayMs)} sub={`${stats.activeDays} active day${stats.activeDays === 1 ? "" : "s"}`} />
            <Kpi label="Breaks" value={fmtDuration(stats.breakMs)} />
          </div>

          <div className="stats-grid">
            <div className="card chart-card wide">
              <div className="card-head">
                <h3>Recorded per {bucket}</h3>
                <span className="muted small">click a bar to inspect</span>
              </div>
              <StackedBars stats={stats} bucket={bucket} catById={catById} onPick={(b) => setDrill({ type: "bucket", key: b.key, start: b.start, end: b.end })} />
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Distribution</h3>
                <Segmented size="sm" value={groupBy} onChange={setGroupBy} options={[{ value: "category", label: "Category" }, { value: "tag", label: "Tag" }]} ariaLabel="Group by" />
              </div>
              <Distribution stats={stats} prev={prevStats} groupBy={groupBy} catById={catById} tagById={tagById} onPick={(type, id) => setDrill({ type, id })} />
              {groupBy === "tag" && <p className="muted small">A block with several tags counts fully toward each tag, so tag totals can exceed the recorded total.</p>}
            </div>

            <div className="card">
              <div className="card-head">
                <h3>When you work</h3>
              </div>
              <HourChart values={stats.byHour} />
              <WeekdayChart values={stats.byWeekday} weekStartsOn={weekStartsOn} />
            </div>
          </div>

          <div className="stats-grid">
            <div className="card chart-card wide">
              <div className="card-head">
                <h3>Activity · last 12 months</h3>
                <span className="muted small">follows the filters · click a day to open it</span>
              </div>
              <Heatmap filter={filter} color={catFilter.length === 1 ? catById.get(catFilter[0])?.color ?? "var(--accent)" : "var(--accent)"} />
            </div>
            <div className="card">
              <div className="card-head">
                <h3>Planned vs recorded</h3>
                <span className="muted small">per {bucket}</span>
              </div>
              <PlanVsActual stats={stats} bucket={bucket} />
            </div>
            <div className="card">
              <div className="card-head">
                <h3>Cumulative hours</h3>
                <span className="muted small">by {groupBy}</span>
              </div>
              {data && <Cumulative stats={stats} sessions={data.sessions} range={range} filter={filter} groupBy={groupBy} catById={catById} tagById={tagById} />}
            </div>
          </div>

          {data && <FocusHistory sessions={data.sessions} range={range} defaultBucket={days <= 35 ? "day" : days <= 140 ? "week" : days <= 800 ? "month" : "year"} />}

          {drill && data && (
            <DrillList
              drill={drill}
              sessions={data.sessions}
              range={range}
              filter={filter}
              onClose={() => setDrill(null)}
              label={
                drill.type === "bucket" ? fmt.full(drill.start) + (bucket !== "day" ? ` (${bucket})` : "") : drill.type === "category" ? catById.get(drill.id)?.name ?? "" : `#${tagById.get(drill.id)?.name}`
              }
            />
          )}
        </>
      )}
    </section>
  );
}

function TagFilter({ selected, onToggle }: { selected: Id[]; onToggle: (id: Id) => void }) {
  const tags = useApp((s) => s.tags);
  const [q, setQ] = useState("");
  const matches = q ? tags.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()) && !selected.includes(t.id)).slice(0, 6) : [];
  return (
    <>
      {selected.map((id) => (
        <button key={id} className="chip on" onClick={() => onToggle(id)} aria-pressed>
          #{tags.find((t) => t.id === id)?.name} <X size={10} />
        </button>
      ))}
      <span className="tag-filter">
        <input className="field sm" placeholder="Filter by tag…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && matches[0] && (onToggle(matches[0].id), setQ(""))} aria-label="Filter by tag" />
        {matches.length > 0 && (
          <ul className="tag-suggest popover">
            {matches.map((t) => (
              <li key={t.id} onMouseDown={(e) => (e.preventDefault(), onToggle(t.id), setQ(""))}>
                #{t.name}
              </li>
            ))}
          </ul>
        )}
      </span>
    </>
  );
}

function Kpi(p: { label: string; value: string; sub?: string; delta?: [number, number]; big?: boolean }) {
  let delta: React.ReactNode = null;
  if (p.delta) {
    const [cur, prev] = p.delta;
    if (prev > 0) {
      const pct = Math.round(((cur - prev) / prev) * 100);
      delta = (
        <span className={`delta ${pct >= 0 ? "up" : "down"}`} title={`Previous period: ${fmtDuration(prev)}`}>
          {pct >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {Math.abs(pct)}% vs previous
        </span>
      );
    } else if (cur > 0) delta = <span className="delta muted">no data in previous period</span>;
  }
  return (
    <div className={`kpi ${p.big ? "big" : ""}`}>
      <div className="eyebrow">{p.label}</div>
      <div className="kpi-val">{p.value}</div>
      {p.sub && <div className="kpi-sub">{p.sub}</div>}
      {delta}
    </div>
  );
}

// ----------------------------------------------------------------- charts

function StackedBars(p: {
  stats: NonNullable<ReturnType<typeof computeStats>>;
  bucket: Bucket;
  catById: Map<Id, import("../domain/types").Category>;
  onPick: (b: { key: string; start: number; end: number }) => void;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 180;
  const buckets = p.stats.buckets;
  const maxMs = Math.max(3_600_000, ...buckets.map((b) => [...b.byCategory.entries()].reduce((a, [cid, ms]) => a + (p.catById.get(cid)?.isBreak ? 0 : ms), 0)));
  const step = buckets.length ? Math.max(1, width) / buckets.length : 0;
  const barW = Math.max(2, Math.min(36, step * 0.66));
  const niceMax = Math.ceil(maxMs / 3_600_000 / 2) * 2 * 3_600_000 || 3_600_000;
  const ticks = [0, 0.5, 1].map((f) => f * niceMax);
  const order = [...p.catById.values()].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => c.id);
  const labelEvery = Math.ceil(buckets.length / Math.max(1, Math.floor(width / 48)));
  const label = (t: number) =>
    p.bucket === "month" ? new Intl.DateTimeFormat(undefined, { month: "short" }).format(t) : p.bucket === "week" ? fmt.shortDate(t) : buckets.length <= 7 ? fmt.weekdayShort(t) : String(new Date(t).getDate());
  const hb = hover !== null ? buckets[hover] : null;

  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={H + 22} role="img" aria-label="Recorded time per period">
          {ticks.map((t) => {
            const y = H - (t / niceMax) * H;
            return (
              <g key={t}>
                <line x1={0} x2={width} y1={y} y2={y} className="grid-line" />
                {t > 0 && (
                  <text x={0} y={y - 4} className="axis-label">
                    {fmtHours(t)}h
                  </text>
                )}
              </g>
            );
          })}
          {buckets.map((b, i) => {
            const x = i * step + (step - barW) / 2;
            let y = H;
            const segs = order.filter((cid) => b.byCategory.get(cid) && !p.catById.get(cid)?.isBreak);
            const next = buckets[i + 1]?.start ?? p.stats.range.end;
            return (
              <g key={b.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => p.onPick({ key: b.key, start: b.start, end: next })} className="bar-group">
                <rect x={i * step} y={0} width={step} height={H} fill="transparent" />
                {segs.map((cid) => {
                  const h = ((b.byCategory.get(cid) ?? 0) / niceMax) * H;
                  y -= h;
                  return <rect key={cid} x={x} y={y} width={barW} height={Math.max(0, h - 1)} rx={1.5} fill={p.catById.get(cid)?.color} opacity={hover === null || hover === i ? 1 : 0.45} />;
                })}
                {i % labelEvery === 0 && (
                  <text x={i * step + step / 2} y={H + 15} textAnchor="middle" className="axis-label">
                    {label(b.start)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hb && (
        <div className="chart-tip" style={{ left: Math.min(width - 180, Math.max(0, hover! * step)) }}>
          <div className="tip-title">
            {p.bucket === "day" ? fmt.full(hb.start) : `${p.bucket === "week" ? "Week of " : ""}${p.bucket === "month" ? fmt.monthYear(hb.start) : fmt.shortDate(hb.start)}`} · {fmtDuration(hb.totalMs)}
          </div>
          {[...hb.byCategory.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([cid, ms]) => (
              <div key={cid} className="tip-row">
                <CatDot color={p.catById.get(cid)?.color ?? "#888"} /> {p.catById.get(cid)?.name}
                <span>{fmtDuration(ms, { compact: true })}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function Distribution(p: {
  stats: NonNullable<ReturnType<typeof computeStats>>;
  prev: ReturnType<typeof computeStats> | null;
  groupBy: "category" | "tag";
  catById: Map<Id, import("../domain/types").Category>;
  tagById: Map<Id, import("../domain/types").Tag>;
  onPick: (type: "category" | "tag", id: Id) => void;
}) {
  const rows =
    p.groupBy === "category"
      ? p.stats.byCategory.map((r) => ({ id: r.categoryId, recordedMs: r.recordedMs, plannedMs: r.plannedMs, name: p.catById.get(r.categoryId)?.name ?? "?", color: p.catById.get(r.categoryId)?.color ?? "#888", isBreak: p.catById.get(r.categoryId)?.isBreak ?? false, prevMs: p.prev?.byCategory.find((x) => x.categoryId === r.categoryId)?.recordedMs ?? 0 }))
      : p.stats.byTag.map((r) => ({ id: r.tagId, recordedMs: r.recordedMs, plannedMs: r.plannedMs, name: "#" + (p.tagById.get(r.tagId)?.name ?? "?"), color: "var(--text-3)", isBreak: false, prevMs: p.prev?.byTag.find((x) => x.tagId === r.tagId)?.recordedMs ?? 0 }));
  const visible = rows.filter((r) => r.recordedMs > 0 || r.plannedMs > 0);
  const max = Math.max(1, ...visible.map((r) => Math.max(r.recordedMs, r.plannedMs)));
  const total = p.stats.recordedMs + p.stats.breakMs;
  if (!visible.length) return <p className="muted small">No recorded time in this range.</p>;
  return (
    <ul className="dist big">
      {visible.map((r) => {
        const delta = p.prev && r.prevMs > 0 ? r.recordedMs - r.prevMs : null;
        return (
          <li key={r.id} style={catVars(r.color)} className="clickable" onClick={() => p.onPick(p.groupBy, r.id)}>
            <div className="dist-top">
              <span className="dist-name">
                {r.name}
                {r.isBreak && <span className="muted small"> (break)</span>}
              </span>
              <span className="dist-val">
                <strong>{fmtHours(r.recordedMs)}h</strong>
                {p.groupBy === "category" && total > 0 && <span className="muted"> · {Math.round((r.recordedMs / total) * 100)}%</span>}
                {delta !== null && (
                  <span className={`delta ${delta >= 0 ? "up" : "down"}`} title={`Previous period: ${fmtDuration(r.prevMs)}`}>
                    {delta >= 0 ? "+" : "−"}
                    {fmtHours(Math.abs(delta))}h
                  </span>
                )}
              </span>
            </div>
            <div className="dist-bar" title={`Recorded ${fmtDuration(r.recordedMs)} · Planned ${fmtDuration(r.plannedMs)}`}>
              <span className="dist-plan" style={{ width: `${(r.plannedMs / max) * 100}%` }} />
              <span className="dist-act" style={{ width: `${(r.recordedMs / max) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function MiniBars({ values, labels, title }: { values: number[]; labels: string[]; title: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="minibars" aria-label={title}>
      <div className="eyebrow">{title}</div>
      <div className="minibars-row">
        {values.map((v, i) => (
          <div key={i} className="minibar" title={`${labels[i]}: ${fmtDuration(v)}`}>
            <span style={{ height: `${(v / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="minibars-labels">
        {labels.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </div>
  );
}

function HourChart({ values }: { values: number[] }) {
  return <MiniBars title="Hour of day" values={values} labels={values.map((_, h) => (h % 6 === 0 ? String(h).padStart(2, "0") : ""))} />;
}

function WeekdayChart({ values, weekStartsOn }: { values: number[]; weekStartsOn: 0 | 1 }) {
  const order = Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);
  const base = new Date(2024, 0, 7).getTime(); // a Sunday
  return <MiniBars title="Day of week" values={order.map((d) => values[d])} labels={order.map((d) => fmt.weekdayShort(base + d * DAY).slice(0, 2))} />;
}

function DrillList(p: { drill: NonNullable<Drill>; sessions: Session[]; range: Interval; filter: StatsFilter; onClose: () => void; label: string }) {
  const categories = useApp((s) => s.categories);
  const tags = useApp((s) => s.tags);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const range = p.drill.type === "bucket" ? { start: Math.max(p.range.start, p.drill.start), end: Math.min(p.range.end, p.drill.end) } : p.range;
  const filter: StatsFilter =
    p.drill.type === "category" ? { ...p.filter, categoryIds: [p.drill.id] } : p.drill.type === "tag" ? { ...p.filter, tagIds: [p.drill.id] } : p.filter;
  const pieces = resolveSessions(p.sessions, range, Date.now(), filter, categories).sort((a, b) => b.start - a.start);
  const total = pieces.reduce((a, x) => a + (x.end - x.start), 0);
  return (
    <div className="card drill">
      <div className="card-head">
        <h3>
          {p.label} <span className="muted">· {fmtDuration(total)} in {pieces.length} entr{pieces.length === 1 ? "y" : "ies"}</span>
        </h3>
        <button className="icon-btn sm" onClick={p.onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      <table className="entries">
        <thead>
          <tr>
            <th>Date</th>
            <th>Time</th>
            <th>Category</th>
            <th>Title</th>
            <th>Tags</th>
            <th className="num">Duration</th>
          </tr>
        </thead>
        <tbody>
          {pieces.slice(0, 300).map((x, i) => {
            const c = catById.get(x.session.categoryId);
            return (
              <tr
                key={x.session.id + i}
                onClick={() => {
                  A.openDay(x.start);
                  setTimeout(() => A.select({ kind: "session", id: x.session.id }), 50);
                }}
              >
                <td>{fmt.full(x.start)}</td>
                <td className="mono">
                  {fmtTime(x.start)}–{fmtTime(x.end)}
                </td>
                <td>
                  <CatDot color={c?.color ?? "#888"} icon={c?.icon} /> {c?.name}
                </td>
                <td>{x.session.title}</td>
                <td className="muted">{x.session.tagIds.map((t) => "#" + tagById.get(t)?.name).join(" ")}</td>
                <td className="num">{fmtDuration(x.end - x.start)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {pieces.length > 300 && <p className="muted small">Showing the latest 300 entries.</p>}
    </div>
  );
}
