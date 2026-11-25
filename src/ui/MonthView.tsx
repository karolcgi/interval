import { useMemo } from "react";
import { useApp, useNow } from "../state/store";
import * as A from "../state/actions";
import { computeStats } from "../domain/stats";
import { addDays, dayKey, startOfMonth, startOfWeek } from "../domain/time";
import { fmt, fmtDuration } from "../domain/format";

/** Month overview: recorded hours per day with a stacked category bar. Click a day to open it. */
export function MonthView() {
  const date = useApp((s) => s.date);
  const blocks = useApp((s) => s.blocks);
  const sessions = useApp((s) => s.sessions);
  const categories = useApp((s) => s.categories);
  const weekStartsOn = useApp((s) => s.settings.weekStartsOn);
  const now = useNow(60_000);
  const month = startOfMonth(date);
  const gridStart = startOfWeek(month, weekStartsOn);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  const stats = useMemo(
    () => computeStats({ sessions, blocks, categories, range: { start: gridStart, end: addDays(gridStart, 42) }, now, bucket: "day" }),
    [sessions, blocks, categories, gridStart, now],
  );
  const planned = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of blocks) {
      if (b.status === "skipped" || categories.find((c) => c.id === b.categoryId)?.isBreak) continue;
      const k = dayKey(b.startAt);
      m.set(k, (m.get(k) ?? 0) + (b.endAt - b.startAt));
    }
    return m;
  }, [blocks, categories]);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const maxMs = Math.max(6 * 3_600_000, ...stats.buckets.map((b) => b.totalMs));
  const todayKey = dayKey(now);

  return (
    <div className="month">
      <div className="month-dows">
        {days.slice(0, 7).map((d) => (
          <span key={d}>{fmt.weekdayShort(d)}</span>
        ))}
      </div>
      <div className="month-grid">
        {days.map((d, i) => {
          const k = dayKey(d);
          const bucket = stats.buckets[i];
          const out = new Date(d).getMonth() !== new Date(month).getMonth();
          const segs = bucket ? [...bucket.byCategory.entries()].filter(([cid]) => !catById.get(cid)?.isBreak).sort((a, b) => b[1] - a[1]) : [];
          const total = bucket?.totalMs ?? 0;
          const plan = planned.get(k) ?? 0;
          const dominant = segs[0] ? catById.get(segs[0][0]) : null;
          return (
            <button key={k} className={`month-cell ${out ? "out" : ""} ${k === todayKey ? "today" : ""}`} onClick={() => A.openDay(d)}>
              <div className="mc-top">
                <span className="mc-num">{new Date(d).getDate()}</span>
                {total > 0 && <span className="mc-total">{fmtDuration(total, { compact: true })}</span>}
              </div>
              {dominant && <div className="mc-dominant">{dominant.name}</div>}
              <div className="mc-bar" title={segs.map(([cid, ms]) => `${catById.get(cid)?.name}: ${fmtDuration(ms)}`).join("\n")}>
                {segs.map(([cid, ms]) => (
                  <span key={cid} style={{ width: `${(ms / maxMs) * 100}%`, background: catById.get(cid)?.color }} />
                ))}
              </div>
              {plan > 0 && (
                <div className="mc-plan" title="Recorded vs planned">
                  <span style={{ width: `${Math.min(100, (total / plan) * 100)}%` }} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
