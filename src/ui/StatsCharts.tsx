// Phase 2 analytics: activity heatmap, planned vs actual, cumulative hours.
import { useEffect, useMemo, useState } from "react";
import { useApp, useNow } from "../state/store";
import * as A from "../state/actions";
import * as repo from "../db/repo";
import type { Block, Category, Id, Session, Tag } from "../domain/types";
import { computeStats, type Bucket, type StatsFilter, type StatsResult } from "../domain/stats";
import { addDays, dayKey, startOfDay, startOfWeek } from "../domain/time";
import { fmt, fmtDuration, fmtHours } from "../domain/format";
import { activeRuns, heatmapDays, type HeatDay } from "../domain/analytics";
import { useElementWidth } from "./bits";

// ------------------------------------------------------------------ heatmap

export function Heatmap({ filter, color }: { filter: StatsFilter; color: string }) {
  const db = useApp((s) => s.db);
  const categories = useApp((s) => s.categories);
  const weekStartsOn = useApp((s) => s.settings.weekStartsOn);
  const runningId = useApp((s) => s.running?.id);
  const now = useNow(5 * 60_000);
  const today = startOfDay(now);
  const start = addDays(startOfWeek(today, weekStartsOn), -52 * 7);
  const end = addDays(startOfWeek(today, weekStartsOn), 7);
  const [data, setData] = useState<{ sessions: Session[]; blocks: Block[] } | null>(null);
  useEffect(() => {
    if (!db) return;
    let alive = true;
    void repo.listSessions(db, start, end).then((sessions) => alive && setData({ sessions, blocks: [] }));
    return () => {
      alive = false;
    };
  }, [db, start, end, runningId]);
  const days = useMemo(() => (data ? heatmapDays(computeStats({ sessions: data.sessions, blocks: [], categories, range: { start, end }, now, filter }), start, end, categories) : []), [data, categories, start, end, now, filter]);
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<HeatDay | null>(null);
  if (!data) return <div className="heatmap muted small">Loading…</div>;

  const max = Math.max(1, ...days.map((d) => d.ms));
  const weeks = Math.ceil(days.length / 7);
  const gap = 3;
  const cell = Math.max(6, Math.min(14, Math.floor((width - 28 - gap * weeks) / weeks)));
  const runs = activeRuns(days, today);
  const total = days.reduce((a, d) => a + d.ms, 0);
  const level = (ms: number) => (ms <= 0 ? 0 : Math.min(4, 1 + Math.floor((ms / max) * 4)));
  const monthLabels: Array<{ x: number; label: string }> = [];
  for (let w = 0; w < weeks; w++) {
    const d = new Date(days[w * 7].day);
    if (d.getDate() <= 7) monthLabels.push({ x: w * (cell + gap), label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(d) });
  }

  return (
    <div className="heatmap" ref={ref}>
      {width > 0 && (
        <svg width={width} height={7 * (cell + gap) + 18} role="img" aria-label="Recorded time per day, last 12 months">
          <g transform="translate(28, 14)">
            {monthLabels.map((m) => (
              <text key={m.x} x={m.x} y={-4} className="axis-label">
                {m.label}
              </text>
            ))}
            {[1, 3, 5].map((r) => (
              <text key={r} x={-6} y={r * (cell + gap) + cell - 1} className="axis-label" textAnchor="end">
                {fmt.weekdayShort(days[r].day).slice(0, 2)}
              </text>
            ))}
            {days.map((d, i) => {
              const w = Math.floor(i / 7);
              const r = i % 7;
              const future = d.day > today;
              return (
                <rect
                  key={d.day}
                  x={w * (cell + gap)}
                  y={r * (cell + gap)}
                  width={cell}
                  height={cell}
                  rx={2}
                  className={`hm-cell l${level(d.ms)} ${future ? "future" : ""}`}
                  style={level(d.ms) ? { fill: color } : undefined}
                  onMouseEnter={() => setHover(d)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => !future && A.openDay(d.day)}
                />
              );
            })}
          </g>
        </svg>
      )}
      <div className="hm-foot muted small">
        {hover ? (
          <span>
            {fmt.full(hover.day)} · {hover.ms ? fmtDuration(hover.ms) : "nothing recorded"}
          </span>
        ) : (
          <span>
            {fmtHours(total)}h over {runs.active} active days · longest run {runs.longest} day{runs.longest === 1 ? "" : "s"}
            {runs.current > 1 ? ` · current ${runs.current}` : ""}
          </span>
        )}
        <span className="hm-legend">
          less
          {[0, 1, 2, 3, 4].map((l) => (
            <svg key={l} width={10} height={10}>
              <rect width={10} height={10} rx={2} className={`hm-cell l${l}`} style={l ? { fill: color } : undefined} />
            </svg>
          ))}
          more
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------- planned vs actual

export function PlanVsActual({ stats, bucket }: { stats: StatsResult; bucket: Bucket }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 120;
  const bs = stats.buckets;
  const max = Math.max(3_600_000, ...bs.map((b) => Math.max(b.totalMs, b.plannedMs)));
  const step = bs.length ? width / bs.length : 0;
  const barW = Math.max(2, Math.min(24, step * 0.6));
  const hb = hover !== null ? bs[hover] : null;
  const label = (t: number) => (bucket === "month" ? fmt.monthYear(t) : bucket === "week" ? `Week of ${fmt.shortDate(t)}` : fmt.full(t));
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={H + 4} role="img" aria-label="Planned versus recorded time">
          <line x1={0} x2={width} y1={H} y2={H} className="grid-line" />
          {bs.map((b, i) => {
            const x = i * step + (step - barW) / 2;
            const hp = (b.plannedMs / max) * H;
            const ha = (b.totalMs / max) * H;
            return (
              <g key={b.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} opacity={hover === null || hover === i ? 1 : 0.5}>
                <rect x={i * step} y={0} width={step} height={H} fill="transparent" />
                <rect x={x} y={H - hp} width={barW} height={hp} rx={1.5} className="pva-plan" />
                <rect x={x + barW * 0.2} y={H - ha} width={barW * 0.6} height={ha} rx={1.5} className="pva-act" />
              </g>
            );
          })}
        </svg>
      )}
      <div className="hm-foot muted small">
        {hb ? (
          <span>
            {label(hb.start)} · {fmtDuration(hb.totalMs, { compact: true })} recorded of {fmtDuration(hb.plannedMs, { compact: true })} planned
          </span>
        ) : (
          <span>
            <i className="key key-plan" /> planned <i className="key key-act" /> recorded
          </span>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ cumulative

/** Running total of hours per category (or tag) across the range; top 6 series. */
export function Cumulative(p: { stats: StatsResult; sessions: Session[]; range: { start: number; end: number }; filter: StatsFilter; groupBy: "category" | "tag"; catById: Map<Id, Category>; tagById: Map<Id, Tag> }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const H = 160;
  const now = Date.now();
  const series = useMemo(() => {
    const top = (p.groupBy === "category" ? p.stats.byCategory.filter((r) => !p.catById.get(r.categoryId)?.isBreak).map((r) => r.categoryId) : p.stats.byTag.map((r) => r.tagId))
      .slice(0, 6)
      .filter(Boolean);
    const end = Math.min(p.range.end, addDays(startOfDay(now), 1));
    const days: number[] = [];
    for (let d = p.range.start; d < end; d = addDays(d, 1)) days.push(d);
    return top.map((id) => {
      const f: StatsFilter = p.groupBy === "category" ? { ...p.filter, categoryIds: [id] } : { ...p.filter, tagIds: [id] };
      const st = computeStats({ sessions: p.sessions, blocks: [], categories: [...p.catById.values()], range: { start: p.range.start, end }, now, filter: f });
      let acc = 0;
      const pts = days.map((d) => {
        const m = st.byDay.get(dayKey(d));
        if (m) for (const [cid, v] of m) if (!p.catById.get(cid)?.isBreak) acc += v;
        return acc;
      });
      const color = p.groupBy === "category" ? p.catById.get(id)?.color ?? "#888" : undefined;
      const name = p.groupBy === "category" ? p.catById.get(id)?.name ?? "" : `#${p.tagById.get(id)?.name ?? ""}`;
      return { id, name, color, pts, total: acc };
    });
  }, [p.stats, p.sessions, p.range, p.filter, p.groupBy, p.catById, p.tagById, now]);
  const n = series[0]?.pts.length ?? 0;
  const max = Math.max(3_600_000, ...series.map((s) => s.total));
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * (width - 8));
  const y = (v: number) => H - (v / max) * (H - 8);
  const tagPalette = ["var(--text)", "var(--text-2)", "var(--text-3)", "var(--accent)", "var(--now)", "var(--text-4)"];
  if (!series.length) return <p className="muted small">Nothing recorded in this range.</p>;
  return (
    <div className="chart" ref={ref}>
      {width > 0 && n > 0 && (
        <svg width={width} height={H + 4} role="img" aria-label="Cumulative hours">
          <line x1={0} x2={width} y1={H} y2={H} className="grid-line" />
          <text x={0} y={12} className="axis-label">
            {fmtHours(max)}h
          </text>
          {series.map((s, si) => (
            <polyline key={s.id} fill="none" stroke={s.color ?? tagPalette[si]} strokeWidth={1.75} strokeLinejoin="round" points={s.pts.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
          ))}
        </svg>
      )}
      <ul className="cum-legend">
        {series.map((s, si) => (
          <li key={s.id}>
            <i style={{ background: s.color ?? tagPalette[si] }} />
            {s.name}
            <span className="muted">{fmtHours(s.total)}h</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
