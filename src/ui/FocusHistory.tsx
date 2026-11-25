// Statistics › Focus: what the focus timer recorded in the selected range. Same filters-free totals as the
// rest of Statistics (overlap resolved), plus run counts, cycles and break time from focus history.
import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store";
import * as repo from "../db/repo";
import { computeFocusStats, type FocusBucket } from "../domain/focusStats";
import type { FocusRun, Id, Interval, Session } from "../domain/types";
import { fmt, fmtDuration, fmtHours } from "../domain/format";
import { catVars, Segmented, useElementWidth } from "./bits";

export function FocusHistory(p: { sessions: Session[]; range: Interval; defaultBucket: FocusBucket }) {
  const db = useApp((s) => s.db);
  const categories = useApp((s) => s.categories);
  const tags = useApp((s) => s.tags);
  const weekStartsOn = useApp((s) => s.settings.weekStartsOn);
  const rev = useApp((s) => s.focus?.rev ?? 0);
  const [runs, setRuns] = useState<FocusRun[] | null>(null);
  const [bucket, setBucket] = useState<FocusBucket>(p.defaultBucket);
  const [groupBy, setGroupBy] = useState<"category" | "tag">("category");
  useEffect(() => setBucket(p.defaultBucket), [p.defaultBucket]);

  useEffect(() => {
    if (!db) return;
    let alive = true;
    void repo.listFocusRuns(db, p.range.start, p.range.end).then((r) => alive && setRuns(r));
    return () => {
      alive = false;
    };
  }, [db, p.range.start, p.range.end, rev]);

  const stats = useMemo(
    () => (runs ? computeFocusStats({ sessions: p.sessions, runs, categories, range: p.range, now: Date.now(), bucket, weekStartsOn }) : null),
    [runs, p.sessions, categories, p.range, bucket, weekStartsOn],
  );
  if (!stats) return null;
  const catById = new Map(categories.map((c) => [c.id, c]));
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const rows: Array<{ id: Id; name: string; color: string; ms: number }> =
    groupBy === "category"
      ? stats.byCategory.map((r) => ({ id: r.categoryId, name: catById.get(r.categoryId)?.name ?? "?", color: catById.get(r.categoryId)?.color ?? "#888", ms: r.ms }))
      : stats.byTag.map((r) => ({ id: r.tagId, name: "#" + (tagById.get(r.tagId)?.name ?? "?"), color: "var(--text-3)", ms: r.ms }));
  const max = Math.max(1, ...rows.map((r) => r.ms));

  return (
    <div className="card focus-history wide-card" aria-label="Focus history">
      <div className="card-head">
        <h3>Focus timer</h3>
        <span className="muted small">Pomodoro, Flowtime and stopwatch time in this range</span>
      </div>
      <div className="kpis focus-kpis">
        <Small label="Focused" value={fmtDuration(stats.focusMs)} />
        <Small label="Focus sessions" value={String(stats.sessions)} sub={stats.sessions ? `${stats.completed} ran to the end` : undefined} />
        <Small label="Average session" value={stats.sessions ? fmtDuration(stats.avgMs, { compact: true }) : "–"} />
        <Small label="Cycles completed" value={String(stats.cycles)} />
        <Small label="Break time" value={fmtDuration(stats.breakMs)} />
      </div>
      {stats.focusMs === 0 && stats.sessions === 0 ? (
        <p className="muted small">No timer time in this range. Start a round from the Focus timer in the sidebar.</p>
      ) : (
        <div className="focus-history-grid">
          <div>
            <div className="card-head sub">
              <h4>Focused per {bucket}</h4>
              <Segmented
                size="sm"
                value={bucket}
                onChange={setBucket}
                options={[
                  { value: "day", label: "Day" },
                  { value: "week", label: "Week" },
                  { value: "month", label: "Month" },
                  { value: "year", label: "Year" },
                ]}
                ariaLabel="Focus history period"
              />
            </div>
            <FocusBars buckets={stats.buckets} bucket={bucket} />
          </div>
          <div>
            <div className="card-head sub">
              <h4>By {groupBy}</h4>
              <Segmented size="sm" value={groupBy} onChange={setGroupBy} options={[{ value: "category", label: "Category" }, { value: "tag", label: "Tag" }]} ariaLabel="Focus grouped by" />
            </div>
            {rows.length ? (
              <ul className="dist">
                {rows.map((r) => (
                  <li key={r.id} style={catVars(r.color)}>
                    <div className="dist-top">
                      <span className="dist-name">{r.name}</span>
                      <span className="dist-val">
                        <strong>{fmtHours(r.ms)}h</strong>
                        {groupBy === "category" && stats.focusMs > 0 && <span className="muted"> · {Math.round((r.ms / stats.focusMs) * 100)}%</span>}
                      </span>
                    </div>
                    <div className="dist-bar">
                      <span className="dist-act" style={{ width: `${(r.ms / max) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No tagged focus time.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Small(p: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="eyebrow">{p.label}</div>
      <div className="kpi-val">{p.value}</div>
      {p.sub && <div className="kpi-sub">{p.sub}</div>}
    </div>
  );
}

function FocusBars({ buckets, bucket }: { buckets: Array<{ key: string; start: number; ms: number }>; bucket: FocusBucket }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(30 * 60_000, ...buckets.map((b) => b.ms));
  const label = (t: number) =>
    bucket === "year" ? String(new Date(t).getFullYear()) : bucket === "month" ? new Intl.DateTimeFormat(undefined, { month: "short" }).format(t) : bucket === "week" ? fmt.shortDate(t) : buckets.length <= 7 ? fmt.weekdayShort(t) : String(new Date(t).getDate());
  const every = Math.ceil(buckets.length / Math.max(1, Math.floor((width || 300) / 44)));
  const hb = hover !== null ? buckets[hover] : null;
  return (
    <div className="focus-bars" ref={ref} onMouseLeave={() => setHover(null)}>
      <div className="fb-plot">
        {buckets.map((b, i) => (
          <div key={b.key} className={`fb-col ${hover === i ? "on" : ""}`} onMouseEnter={() => setHover(i)} title={`${fmt.full(b.start)} · ${fmtDuration(b.ms)}`}>
            <span style={{ height: `${(b.ms / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="fb-axis">
        {buckets.map((b, i) => (
          <span key={b.key}>{i % every === 0 ? label(b.start) : ""}</span>
        ))}
      </div>
      <div className="fb-readout muted small num">{hb ? `${bucket === "day" ? fmt.full(hb.start) : label(hb.start)} · ${fmtDuration(hb.ms)}` : " "}</div>
    </div>
  );
}
