// Optional daily ritual: a few minutes of morning planning and evening review.
// Nothing here is mandatory; closing the panel never loses anything.

import { blockName } from "../state/blockName";
import { useEffect, useMemo, useState } from "react";
import { Ban, Check, X } from "lucide-react";
import { store, useApp, useNow } from "../state/store";
import * as A from "../state/actions";
import * as P from "../state/planning";
import * as repo from "../db/repo";
import type { Block, Budget, Category } from "../domain/types";
import { computeStats } from "../domain/stats";
import { budgetProgress } from "../domain/budgets";
import { addDays, dayKey, HOUR, isSameDay, startOfDay } from "../domain/time";
import { fmt, fmtDuration, fmtTime } from "../domain/format";
import { catVars, CatDot } from "./bits";
import { targetColor, targetName, useBudgetData } from "./BudgetsView";
import { copyText, DayLogTimeline, useDayLog } from "./DayLogView";
import { dayLogMarkdown } from "../domain/daylog";

export function openRitual(kind: "plan" | "review", day = store.get().date) {
  A.setCalendarMode("day");
  A.setDate(startOfDay(day));
  store.set({ ritual: { kind, day: startOfDay(day) }, selection: null });
}

/** Which ritual to suggest for the focused day, if any. */
export function suggestedRitual(day: number, now: number, note: { plannedAt: number | null; reviewedAt: number | null } | null, blocks: Block[]): "plan" | "review" | null {
  const today = startOfDay(now);
  if (day > today) return note?.plannedAt ? null : "plan";
  if (day < today) return note?.reviewedAt || !blocks.some((b) => isSameDay(b.startAt, day)) ? null : "review";
  const lastEnd = Math.max(0, ...blocks.filter((b) => isSameDay(b.startAt, day) && b.status !== "skipped").map((b) => b.endAt));
  const evening = new Date(now).getHours() >= 17 || (lastEnd > 0 && lastEnd <= now);
  if (evening && !note?.reviewedAt) return "review";
  if (!evening && !note?.plannedAt) return "plan";
  return null;
}

export function DailyRitual() {
  const ritual = useApp((s) => s.ritual);
  useEffect(() => {
    if (!ritual) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        store.set({ ritual: null });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ritual]);
  if (!ritual) return null;
  return (
    <div className="ritual-scrim" onPointerDown={(e) => e.target === e.currentTarget && store.set({ ritual: null })}>
      <div className="ritual popover-modal" role="dialog" aria-label={ritual.kind === "plan" ? "Plan the day" : "Review the day"}>
        <button className="icon-btn ritual-close" onClick={() => store.set({ ritual: null })} aria-label="Close">
          <X size={15} />
        </button>
        {ritual.kind === "plan" ? <Plan day={ritual.day} /> : <Review day={ritual.day} />}
      </div>
    </div>
  );
}

function useDay(day: number) {
  const blocks = useApp((s) => s.blocks);
  const sessions = useApp((s) => s.sessions);
  const categories = useApp((s) => s.categories);
  const now = useNow(30_000);
  const dayBlocks = useMemo(() => blocks.filter((b) => isSameDay(b.startAt, day)).sort((a, b) => a.startAt - b.startAt), [blocks, day]);
  const stats = useMemo(() => computeStats({ sessions, blocks, categories, range: { start: day, end: addDays(day, 1) }, now }), [sessions, blocks, categories, day, now]);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  return { dayBlocks, stats, catById, now, categories };
}

// ------------------------------------------------------------------ morning

function Plan({ day }: { day: number }) {
  const { dayBlocks, stats, catById, categories } = useDay(day);
  const workdayHours = useApp((s) => s.settings.workdayHours);
  const templates = useApp((s) => s.templates);
  const allBudgets = useApp((s) => s.budgets);
  const budgets = useMemo(() => allBudgets.filter((b) => !b.archivedAt && (b.period === "day" || b.period === "week")), [allBudgets]);
  const workday = workdayHours * HOUR;
  const unallocated = Math.max(0, workday - stats.plannedMs);
  const over = Math.max(0, stats.plannedMs - workday);
  const rows = stats.byCategory.filter((r) => r.plannedMs > 0 && !catById.get(r.categoryId)?.isBreak);

  const finish = async () => {
    await A.saveDailyNote({ plannedAt: Date.now() });
    store.set({ ritual: null });
    A.toast("Day planned");
  };

  return (
    <>
      <div className="eyebrow">Morning planning</div>
      <h2 className="ritual-title">{isSameDay(day, Date.now()) ? "Plan today" : `Plan ${fmt.full(day)}`}</h2>

      <section className="ritual-sec">
        <div className="ritual-total">
          <span className="rt-val">{fmtDuration(stats.plannedMs)}</span>
          <span className="muted">planned of a {workdayHours}h day</span>
          <span className="spacer" />
          <span className={over ? "rt-over" : "muted"}>{over ? `${fmtDuration(over, { compact: true })} over` : `${fmtDuration(unallocated, { compact: true })} unallocated`}</span>
        </div>
        <div className="alloc-bar" aria-hidden>
          {rows.map((r) => (
            <span key={r.categoryId} style={{ width: `${(r.plannedMs / Math.max(workday, stats.plannedMs)) * 100}%`, background: catById.get(r.categoryId)?.color }} title={catById.get(r.categoryId)?.name} />
          ))}
        </div>
        <ul className="alloc-list">
          {rows.map((r) => (
            <li key={r.categoryId}>
              <CatDot color={catById.get(r.categoryId)?.color ?? "#888"} />
              <span>{catById.get(r.categoryId)?.name}</span>
              <span className="muted">{fmtDuration(r.plannedMs, { compact: true })}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="ritual-sec">
        <h3>Timeline</h3>
        {dayBlocks.length === 0 ? (
          <div className="muted small">
            Nothing planned yet.
            {templates.length > 0 && (
              <div className="tpl-quick">
                {templates.map((t) => (
                  <button key={t.id} className="chip" onClick={() => void P.applyTemplate(t.id, day).catch(A.reportError)}>
                    Apply “{t.name}”
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <ul className="ritual-blocks">
            {dayBlocks.map((b) => (
              <BlockLine key={b.id} b={b} cat={catById.get(b.categoryId)} />
            ))}
          </ul>
        )}
        <button className="link-btn" onClick={() => store.set({ ritual: null })}>
          Edit on the timeline
        </button>
      </section>

      {budgets.length > 0 && <BudgetCheck budgets={budgets} categories={categories} />}

      <div className="ritual-foot">
        <button className="btn btn-outline" onClick={() => void finish().catch(A.reportError)}>
          <Check size={13} /> Done planning
        </button>
      </div>
    </>
  );
}

function BudgetCheck({ budgets, categories }: { budgets: Budget[]; categories: Category[] }) {
  const tags = useApp((s) => s.tags);
  const { data, weekStartsOn } = useBudgetData(budgets);
  const now = useNow(60_000);
  if (!data) return null;
  return (
    <section className="ritual-sec">
      <h3>Budgets</h3>
      <ul className="ritual-budgets">
        {budgets.map((b) => {
          const p = budgetProgress(b, data.sessions, data.blocks, categories, now, weekStartsOn);
          const goal = p.minMs ?? p.maxMs ?? 1;
          return (
            <li key={b.id} style={catVars(targetColor(b, categories))}>
              <span className="rb-name">
                {targetName(b, categories, tags)} <span className="muted">· {b.period === "day" ? "today" : "this week"}</span>
              </span>
              <span className="rb-bar">
                <span className="br-done" style={{ width: `${Math.min(1, p.doneMs / goal) * 100}%` }} />
                <span className="br-ahead" style={{ left: `${Math.min(1, p.doneMs / goal) * 100}%`, width: `${Math.min(1 - Math.min(1, p.doneMs / goal), p.plannedAheadMs / goal) * 100}%` }} />
              </span>
              <span className="muted small rb-val">
                {fmtDuration(p.doneMs + p.plannedAheadMs, { compact: true })} / {fmtDuration(goal, { compact: true })}
                {p.maxMs !== null && p.minMs === null ? " max" : ""}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="muted small">Done plus planned, against each target.</p>
    </section>
  );
}

function BlockLine({ b, cat, actions }: { b: Block; cat?: Category; actions?: React.ReactNode }) {
  return (
    <li className={`ritual-block status-${b.status}`} style={catVars(cat?.color ?? "#888")}>
      <span className="rbk-time">
        {fmtTime(b.startAt)}–{fmtTime(b.endAt)}
      </span>
      <span className="rbk-name">{blockName(b, cat?.name)}</span>
      {b.title && <span className="muted small">{cat?.name}</span>}
      <span className="spacer" />
      {actions}
    </li>
  );
}

// ------------------------------------------------------------------ evening

function Review({ day }: { day: number }) {
  const { dayBlocks, stats, catById, now } = useDay(day);
  const db = useApp((s) => s.db);
  const templates = useApp((s) => s.templates);
  const timeFormat = useApp((s) => s.settings.timeFormat);
  const log = useDayLog(day);
  const [tomorrow, setTomorrow] = useState<Block[] | null>(null);
  const tomorrowStart = addDays(day, 1);
  useEffect(() => {
    if (db) void repo.listBlocks(db, tomorrowStart, addDays(tomorrowStart, 1)).then(setTomorrow);
  }, [db, tomorrowStart, dayBlocks]);

  const unreviewed = dayBlocks.filter((b) => b.status === "planned" && b.endAt <= now);
  const rows = stats.byCategory.filter((r) => (r.recordedMs > 0 || r.plannedMs > 0) && !catById.get(r.categoryId)?.isBreak);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.recordedMs, r.plannedMs)));
  const diff = stats.recordedMs - stats.plannedMs;

  const finish = async () => {
    await A.saveDailyNote({ reviewedAt: Date.now() }, dayKey(day));
    void import("../state/obsidian").then((o) => o.autoExport()).catch((e) => console.warn(e));
    store.set({ ritual: null });
    A.toast("Day reviewed");
  };

  return (
    <>
      <div className="eyebrow">Evening review</div>
      <h2 className="ritual-title">{isSameDay(day, Date.now()) ? "Review today" : `Review ${fmt.full(day)}`}</h2>

      <section className="ritual-sec">
        <div className="ritual-total">
          <span className="rt-val">{fmtDuration(stats.recordedMs)}</span>
          <span className="muted">recorded of {fmtDuration(stats.plannedMs, { compact: true })} planned</span>
          <span className="spacer" />
          <span className="muted">
            {stats.plannedMs > 0 ? `${diff >= 0 ? "+" : "−"}${fmtDuration(Math.abs(diff), { compact: true })}` : ""}
            {stats.breakMs > 0 ? ` · ${fmtDuration(stats.breakMs, { compact: true })} breaks` : ""}
          </span>
        </div>
        <ul className="dist">
          {rows.map((r) => {
            const c = catById.get(r.categoryId);
            return (
              <li key={r.categoryId} style={catVars(c?.color ?? "#888")}>
                <div className="dist-top">
                  <span className="dist-name">{c?.name}</span>
                  <span className="dist-val">
                    {fmtDuration(r.recordedMs, { compact: true })}
                    <span className="muted"> / {fmtDuration(r.plannedMs, { compact: true })}</span>
                  </span>
                </div>
                <div className="dist-bar">
                  <span className="dist-plan" style={{ width: `${(r.plannedMs / max) * 100}%` }} />
                  <span className="dist-act" style={{ width: `${(r.recordedMs / max) * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="ritual-sec">
        <h3>{unreviewed.length ? `${unreviewed.length} block${unreviewed.length > 1 ? "s" : ""} to confirm` : "All blocks reviewed"}</h3>
        {unreviewed.length > 0 && (
          <ul className="ritual-blocks">
            {unreviewed.map((b) => (
              <BlockLine
                key={b.id}
                b={b}
                cat={catById.get(b.categoryId)}
                actions={
                  <>
                    <button className="btn btn-outline sm" onClick={() => void A.completeBlockManually(b.id).catch(A.reportError)} title="Record the planned time as done">
                      <Check size={12} /> Done
                    </button>
                    <button className="btn btn-ghost sm" onClick={() => void A.setBlockStatus(b.id, "skipped").catch(A.reportError)} title="Didn’t happen">
                      <Ban size={12} /> Skipped
                    </button>
                  </>
                }
              />
            ))}
          </ul>
        )}
        <p className="muted small">Partly done? Close this and drag in the Actual lane to log what really happened.</p>
      </section>

      <section className="ritual-sec">
        <div className="sec-head">
          <h3>Day log</h3>
          <button className="link-btn" disabled={!log?.entries.length} onClick={() => log && void copyText(dayLogMarkdown(log, { timeFormat })).then(() => A.toast("Day log copied as Markdown"))}>
            Copy Markdown
          </button>
        </div>
        {log && <DayLogTimeline log={log} timeFormat={timeFormat} compact />}
      </section>

      <section className="ritual-sec">
        <h3>Tomorrow</h3>
        <div className="muted small">
          {tomorrow === null ? "" : tomorrow.length ? `${tomorrow.length} block${tomorrow.length > 1 ? "s" : ""} planned for ${fmt.weekday(tomorrowStart)}.` : `Nothing planned for ${fmt.weekday(tomorrowStart)} yet.`}
        </div>
        <div className="tpl-quick">
          {tomorrow?.length === 0 &&
            templates.map((t) => (
              <button key={t.id} className="chip" onClick={() => void P.applyTemplate(t.id, tomorrowStart).then(() => db && repo.listBlocks(db, tomorrowStart, addDays(tomorrowStart, 1)).then(setTomorrow), A.reportError)}>
                Apply “{t.name}”
              </button>
            ))}
          <button
            className="chip"
            onClick={() => {
              void finish().then(() => openRitual("plan", tomorrowStart));
            }}
          >
            Plan {fmt.weekday(tomorrowStart)} →
          </button>
        </div>
      </section>

      <div className="ritual-foot">
        <button className="btn btn-outline" onClick={() => void finish().catch(A.reportError)}>
          <Check size={13} /> Finish review
        </button>
      </div>
    </>
  );
}
