// "Today's time" and "Planned vs actual" for the focused day. Moved from the right panel to the bottom of
// the left sidebar in v0.9 (the right panel's freed room is kept for a future task inbox).
import { useMemo } from "react";
import { useApp, useNow } from "../state/store";
import * as A from "../state/actions";
import * as L from "../state/library";
import { computeStats } from "../domain/stats";
import { addDays, isSameDay } from "../domain/time";
import { fmt, fmtDuration } from "../domain/format";
import { catVars, CatDot } from "./bits";

export function DayTimeSummary() {
  const date = useApp((s) => s.date);
  const blocks = useApp((s) => s.blocks);
  const sessions = useApp((s) => s.sessions);
  const categories = useApp((s) => s.categories);
  const now = useNow(30_000);
  const isToday = isSameDay(date, now);
  const st = useMemo(
    () => computeStats({ sessions, blocks, categories, range: { start: date, end: addDays(date, 1) }, now }),
    [sessions, blocks, categories, date, now],
  );
  const catById = new Map(categories.map((c) => [c.id, c]));
  const rows = st.byCategory.filter((r) => r.recordedMs > 0 || r.plannedMs > 0);
  const maxRow = Math.max(1, ...rows.map((r) => Math.max(r.recordedMs, r.plannedMs)));
  const unreviewed = blocks.filter((b) => b.status === "planned" && b.endAt <= now && isSameDay(b.startAt, date)).length;
  const pct = st.plannedMs > 0 ? Math.min(100, (st.recordedMs / st.plannedMs) * 100) : 0;
  return (
    <div className="side-time">
      <div className="card hero">
        <button className="eyebrow link-eyebrow" onClick={A.goToday} title="Go to today">{isToday ? "Today’s time" : fmt.full(date)}</button>
        <div className="hero-val">{fmtDuration(st.recordedMs)}</div>
        <div className="hero-sub">
          recorded of {fmtDuration(st.plannedMs)} planned
          {st.breakMs > 0 && <> · {fmtDuration(st.breakMs, { compact: true })} breaks</>}
        </div>
        <div className="progress">
          <span style={{ width: `${pct}%` }} />
        </div>
        <ThreeLayers date={date} recordedMs={st.recordedMs} plannedMs={st.plannedMs} />
      </div>

      <section className="panel-sec">
        <div className="sec-head">
          <h3>Planned vs actual</h3>
        </div>
        {rows.length === 0 && <p className="muted small">Nothing planned or recorded yet. Drag on the timeline to plan a block.</p>}
        <ul className="dist">
          {rows.map((r) => {
            const c = catById.get(r.categoryId);
            return (
              <li key={r.categoryId} style={catVars(c?.color ?? "#888")}>
                <div className="dist-top">
                  <span className="dist-name"><CatDot color={c?.color ?? "#888"} icon={c?.icon} /> {c?.name ?? "Unknown"}</span>
                  <span className="dist-val">
                    {fmtDuration(r.recordedMs, { compact: true })}
                    <span className="muted"> / {fmtDuration(r.plannedMs, { compact: true })}</span>
                  </span>
                </div>
                <div className="dist-bar">
                  <span className="dist-plan" style={{ width: `${(r.plannedMs / maxRow) * 100}%` }} />
                  <span className="dist-act" style={{ width: `${(r.recordedMs / maxRow) * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
        {unreviewed > 0 && (
          <p className="notice small">
            {unreviewed} past block{unreviewed > 1 ? "s" : ""} not yet confirmed. Close them in the evening review.
          </p>
        )}
      </section>

    </div>
  );
}

/** Template, Plan and Actual side by side. Suggestions are only shown, never added to the plan total. */
function ThreeLayers({ date, recordedMs, plannedMs }: { date: number; recordedMs: number; plannedMs: number }) {
  const blocks = useApp((s) => s.blocks);
  const tpl = useApp((s) => s.weekTemplate);
  const dismissed = useApp((s) => s.dismissed);
  const onPast = useApp((s) => s.settings.templateOnPast);
  const suggested = useMemo(() => {
    void tpl;
    void dismissed;
    void onPast;
    return L.daySuggestions(date).visible.reduce((n, g) => n + (g.endAt - g.startAt), 0);
  }, [date, blocks, tpl, dismissed, onPast]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!tpl.length) return null;
  return (
    <dl className="three-layers" aria-label="Template, plan and actual">
      <div>
        <dt>Suggested</dt>
        <dd className="tpl-val">{fmtDuration(suggested, { compact: true })}</dd>
      </div>
      <div>
        <dt>Planned</dt>
        <dd>{fmtDuration(plannedMs, { compact: true })}</dd>
      </div>
      <div>
        <dt>Actual</dt>
        <dd>{fmtDuration(recordedMs, { compact: true })}</dd>
      </div>
    </dl>
  );
}

