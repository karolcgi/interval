import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useApp, useNow } from "../state/store";
import * as A from "../state/actions";
import * as repo from "../db/repo";
import type { Block, Budget, BudgetPeriod, Category, Session, Tag } from "../domain/types";
import { budgetHistory, budgetProgress, budgetsLoadRange, PERIOD_LABEL, PERIOD_NOUN, type BudgetProgress, type BudgetStatus } from "../domain/budgets";
import { fmt, fmtDuration } from "../domain/format";
import { CatDot, catVars, Segmented } from "./bits";

const PERIODS: BudgetPeriod[] = ["day", "week", "month", "year", "lifetime"];
const STATUS: Record<BudgetStatus, string> = {
  met: "Met",
  on_track: "On track",
  behind: "Needs planning",
  within: "Within limit",
  near_limit: "Near limit",
  over: "Over limit",
  none: "",
};

/** Loads the sessions/blocks every budget needs (current period + history) and keeps them fresh. */
export function useBudgetData(budgets: Budget[]) {
  const db = useApp((s) => s.db);
  const weekStartsOn = useApp((s) => s.settings.weekStartsOn);
  const runningId = useApp((s) => s.running?.id);
  const blocksVersion = useApp((s) => s.blocks);
  const sessionsVersion = useApp((s) => s.sessions);
  const now = useNow(60_000);
  const [earliest, setEarliest] = useState(0);
  const [data, setData] = useState<{ sessions: Session[]; blocks: Block[] } | null>(null);
  useEffect(() => {
    if (db) void repo.earliestRecord(db).then((e) => setEarliest(e ?? Date.now()));
  }, [db]);
  const range = useMemo(() => budgetsLoadRange(budgets, now, weekStartsOn, earliest), [budgets, now, weekStartsOn, earliest]);
  useEffect(() => {
    if (!db || !budgets.length) return;
    let alive = true;
    void Promise.all([repo.listSessions(db, range.start, range.end), repo.listBlocks(db, range.start, range.end)]).then(([sessions, blocks]) => alive && setData({ sessions, blocks }));
    return () => {
      alive = false;
    };
  }, [db, range.start, range.end, runningId, blocksVersion, sessionsVersion, budgets.length]);
  return { data, earliest, weekStartsOn };
}

export function targetName(b: Budget, categories: Category[], tags: Tag[]) {
  return b.targetType === "category" ? categories.find((c) => c.id === b.targetId)?.name ?? "Deleted category" : `#${tags.find((t) => t.id === b.targetId)?.name ?? "deleted tag"}`;
}
export function targetColor(b: Budget, categories: Category[]) {
  return b.targetType === "category" ? categories.find((c) => c.id === b.targetId)?.color ?? "#888" : "var(--accent)";
}

export function BudgetsView() {
  const budgets = useApp((s) => s.budgets);
  const categories = useApp((s) => s.categories);
  const tags = useApp((s) => s.tags);
  const active = budgets.filter((b) => !b.archivedAt);
  const { data, earliest, weekStartsOn } = useBudgetData(active);
  const now = useNow(30_000);

  return (
    <section className="page budgets">
      <header className="page-head">
        <div>
          <div className="eyebrow">Allocate time on purpose</div>
          <h1 className="page-title">Time budgets</h1>
        </div>
      </header>
      <p className="lede">A target is a minimum worth protecting. A limit keeps one area from eating the rest. Both count recorded time only; planned time ahead shows whether you’re on course.</p>

      <NewBudget categories={categories} tags={tags} />

      {active.length === 0 && <p className="muted small pad-top">No budgets yet. Start with one or two that matter, like “Studying, at least 7 hours a week”.</p>}

      {PERIODS.map((period) => {
        const list = active.filter((b) => b.period === period);
        if (!list.length) return null;
        return (
          <div key={period}>
            <h2 className="section-title">{PERIOD_LABEL[period]}</h2>
            <div className="settings-block budget-list">
              {list.map((b) => (
                <BudgetRow
                  key={b.id}
                  b={b}
                  progress={data ? budgetProgress(b, data.sessions, data.blocks, categories, now, weekStartsOn, earliest) : null}
                  history={data ? budgetHistory(b, data.sessions, data.blocks, categories, now, weekStartsOn) : []}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function hoursToMinutes(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const m = /^(\d+(?:\.\d+)?)\s*h?\s*(?:(\d+)\s*m)?$/i.exec(t);
  if (!m) return NaN;
  return Math.round(Number(m[1]) * 60 + Number(m[2] ?? 0));
}

const asHours = (min: number | null) => (min === null ? "" : min % 60 === 0 ? String(min / 60) : (min / 60).toFixed(2).replace(/0$/, ""));

function NewBudget({ categories, tags }: { categories: Category[]; tags: Tag[] }) {
  const [target, setTarget] = useState("");
  const [period, setPeriod] = useState<BudgetPeriod>("week");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const add = async () => {
    const [type, id] = target.split(":");
    const minMinutes = hoursToMinutes(min);
    const maxMinutes = period === "lifetime" ? null : hoursToMinutes(max);
    if (!id) return A.toast("Choose a category or tag");
    if (Number.isNaN(minMinutes) || Number.isNaN(maxMinutes)) return A.toast("Hours look like 7, 7.5 or 7h 30m");
    try {
      await A.saveBudget({ id: repo.newId(), targetType: type as Budget["targetType"], targetId: id, period, minMinutes, maxMinutes, archivedAt: null, createdAt: Date.now() });
      setMin("");
      setMax("");
    } catch (e) {
      A.reportError(e);
    }
  };
  return (
    <div className="settings-block new-budget">
      <select className="select sm" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Budget for">
        <option value="">Category or tag…</option>
        <optgroup label="Categories">
          {categories
            .filter((c) => !c.archivedAt)
            .map((c) => (
              <option key={c.id} value={`category:${c.id}`}>
                {c.parentId ? "↳ " : ""}
                {c.name}
              </option>
            ))}
        </optgroup>
        {tags.length > 0 && (
          <optgroup label="Tags">
            {tags
              .filter((t) => !t.archivedAt)
              .map((t) => (
                <option key={t.id} value={`tag:${t.id}`}>
                  #{t.name}
                </option>
              ))}
          </optgroup>
        )}
      </select>
      <Segmented size="sm" value={period} onChange={setPeriod} ariaLabel="Period" options={PERIODS.map((p) => ({ value: p, label: p === "lifetime" ? "Lifetime" : PERIOD_NOUN[p][0].toUpperCase() + PERIOD_NOUN[p].slice(1) }))} />
      <label className="nb-field">
        <span className="muted small">at least</span>
        <input className="field num" placeholder="–" value={min} onChange={(e) => setMin(e.target.value)} aria-label="Target hours" onKeyDown={(e) => e.key === "Enter" && void add()} />
        <span className="muted small">h</span>
      </label>
      {period !== "lifetime" && (
        <label className="nb-field">
          <span className="muted small">at most</span>
          <input className="field num" placeholder="–" value={max} onChange={(e) => setMax(e.target.value)} aria-label="Limit hours" onKeyDown={(e) => e.key === "Enter" && void add()} />
          <span className="muted small">h</span>
        </label>
      )}
      <button className="btn btn-outline sm" onClick={() => void add()}>
        <Plus size={13} /> Add
      </button>
    </div>
  );
}

function BudgetRow({ b, progress, history }: { b: Budget; progress: BudgetProgress | null; history: Array<{ range: { start: number; end: number }; doneMs: number; ok: boolean }> }) {
  const categories = useApp((s) => s.categories);
  const tags = useApp((s) => s.tags);
  const [min, setMin] = useState(asHours(b.minMinutes));
  const [max, setMax] = useState(asHours(b.maxMinutes));
  useEffect(() => (setMin(asHours(b.minMinutes)), setMax(asHours(b.maxMinutes))), [b.minMinutes, b.maxMinutes]);
  const save = (patch: Partial<Budget>) => void A.saveBudget({ ...b, ...patch }).catch((e) => (A.reportError(e), setMin(asHours(b.minMinutes)), setMax(asHours(b.maxMinutes))));
  const commitMin = () => {
    const v = hoursToMinutes(min);
    if (Number.isNaN(v)) return setMin(asHours(b.minMinutes));
    if (v !== b.minMinutes) save({ minMinutes: v });
  };
  const commitMax = () => {
    const v = hoursToMinutes(max);
    if (Number.isNaN(v)) return setMax(asHours(b.maxMinutes));
    if (v !== b.maxMinutes) save({ maxMinutes: v });
  };
  const p = progress;
  const scale = p ? Math.max(p.maxMs ?? 0, p.minMs ?? 0, p.doneMs + p.plannedAheadMs, 1) : 1;
  const met = history.filter((h) => h.ok).length;
  return (
    <div className={`budget-row status-${p?.status ?? "none"}`} style={catVars(targetColor(b, categories))}>
      <div className="br-head">
        <CatDot color={targetColor(b, categories)} />
        <span className="br-name">{targetName(b, categories, tags)}</span>
        {p && p.status !== "none" && <span className={`br-status s-${p.status}`}>{STATUS[p.status]}</span>}
        <span className="spacer" />
        <label className="nb-field">
          <span className="muted small">min</span>
          <input className="field num bare" value={min} placeholder="–" onChange={(e) => setMin(e.target.value)} onBlur={commitMin} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} aria-label={`${targetName(b, categories, tags)} target hours`} />
        </label>
        {b.period !== "lifetime" && (
          <label className="nb-field">
            <span className="muted small">max</span>
            <input className="field num bare" value={max} placeholder="–" onChange={(e) => setMax(e.target.value)} onBlur={commitMax} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} aria-label={`${targetName(b, categories, tags)} limit hours`} />
          </label>
        )}
        <button className="icon-btn sm danger" onClick={() => void A.deleteBudget(b.id).catch(A.reportError)} aria-label="Delete budget" title="Delete budget">
          <Trash2 size={13} />
        </button>
      </div>
      {p && (
        <>
          <div className="br-bar" role="img" aria-label={`${fmtDuration(p.doneMs)} recorded`}>
            <span className="br-done" style={{ width: `${(Math.min(p.doneMs, scale) / scale) * 100}%` }} />
            <span className="br-ahead" style={{ left: `${(Math.min(p.doneMs, scale) / scale) * 100}%`, width: `${(Math.min(p.plannedAheadMs, scale - Math.min(p.doneMs, scale)) / scale) * 100}%` }} />
            {p.minMs !== null && <span className="br-mark min" style={{ left: `${(p.minMs / scale) * 100}%` }} title="Target" />}
            {p.maxMs !== null && <span className="br-mark max" style={{ left: `${(p.maxMs / scale) * 100}%` }} title="Limit" />}
          </div>
          <div className="br-meta muted small">
            <span className="br-done-text">{fmtDuration(p.doneMs)}</span>
            {p.minMs !== null && <> of {fmtDuration(p.minMs, { compact: true })}</>}
            {p.pct !== null && p.minMs !== null && <> · {Math.round(p.pct * 100)}%</>}
            {p.remainingMs ? <> · {fmtDuration(p.remainingMs, { compact: true })} to go</> : null}
            {p.status === "behind" && p.range.end > Date.now() && <> · plan {fmtDuration(p.remainingMs! - p.plannedAheadMs, { compact: true })} more</>}
            {p.maxMs !== null && <> · limit {fmtDuration(p.maxMs, { compact: true })}</>}
            {p.plannedAheadMs > 0 && <> · {fmtDuration(p.plannedAheadMs, { compact: true })} planned ahead</>}
            {b.period !== "lifetime" && b.period !== "day" && <span className="br-range"> · {fmt.shortDate(p.range.start)} – {fmt.shortDate(p.range.end - 1)}</span>}
          </div>
          {history.length > 0 && (
            <div className="br-history" title={`Met in ${met} of the last ${history.length} ${PERIOD_NOUN[b.period]}s`}>
              {history.map((h) => (
                <span key={h.range.start} className={h.ok ? "ok" : ""} title={`${fmt.shortDate(h.range.start)}: ${fmtDuration(h.doneMs, { compact: true })}`} />
              ))}
              <span className="muted small">
                {met} of last {history.length} {PERIOD_NOUN[b.period]}s
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
