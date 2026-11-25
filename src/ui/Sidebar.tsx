import { useMemo } from "react";
import { CalendarDays, CalendarRange, ChartNoAxesColumn, Gauge, NotebookText, TrendingUp, Settings2, Shapes, Sun } from "lucide-react";
import { useApp, useNow } from "../state/store";
import * as A from "../state/actions";
import { FocusPanel } from "./FocusPanel";
import { MiniCalendar } from "./MiniCalendar";
import { computeStats } from "../domain/stats";
import { addDays, isSameDay, startOfDay } from "../domain/time";
import { fmtDuration } from "../domain/format";
import { CatDot } from "./bits";

export function Sidebar() {
  const view = useApp((s) => s.view);
  const mode = useApp((s) => s.calendarMode);
  const date = useApp((s) => s.date);
  const categories = useApp((s) => s.categories);
  const today = useApp((s) => s.today);
  const update = useApp((s) => s.update);
  const now = useNow(30_000);
  const isTodayView = view === "calendar" && mode === "day" && isSameDay(date, now);

  const totals = useMemo(() => {
    const d = startOfDay(now);
    return computeStats({ sessions: today.sessions, blocks: today.blocks, categories, range: { start: d, end: addDays(d, 1) }, now });
  }, [today, categories, now]);

  const active = categories.filter((c) => !c.archivedAt && !c.parentId);
  const recordedById = new Map(totals.byCategory.map((x) => [x.categoryId, x.recordedMs]));

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden>
          <svg viewBox="0 0 22 22" width="22" height="22">
            <rect width="22" height="22" rx="5" fill="var(--accent)" />
            <path d="M6 11h10M11 6v10" stroke="var(--accent-ink)" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>
        <span className="brand-name">Interval</span>
      </div>

      <nav className="nav">
        <NavItem icon={<Sun size={15} />} label="Today" active={isTodayView} onClick={() => { A.setCalendarMode("day"); A.goToday(); }} hint="T" />
        <NavItem icon={<CalendarDays size={15} />} label="Calendar" active={view === "calendar" && !isTodayView} onClick={() => A.setCalendarMode(mode === "day" ? "week" : mode)} hint="W" />
        <NavItem icon={<ChartNoAxesColumn size={15} />} label="Statistics" active={view === "stats"} onClick={() => A.setView("stats")} />
        <NavItem icon={<Gauge size={15} />} label="Time budgets" active={view === "budgets"} onClick={() => A.setView("budgets")} />
        <NavItem icon={<TrendingUp size={15} />} label="Progress" active={view === "progress"} onClick={() => A.setView("progress")} />
        <NavItem icon={<CalendarRange size={15} />} label="Reviews" active={view === "reviews"} onClick={() => A.setView("reviews")} />
        <NavItem icon={<NotebookText size={15} />} label="Day log" active={view === "log"} onClick={() => A.setView("log")} />
        <NavItem icon={<Shapes size={15} />} label="Categories & tags" active={view === "categories"} onClick={() => A.setView("categories")} />
      </nav>

      <MiniCalendar />

      <div className="side-section">
        <div className="eyebrow">Activities</div>
        <ul className="cat-list">
          {active.map((c) => (
            <li key={c.id} className="cat-row" title={c.shortcut ? `Shortcut: ${c.shortcut}` : undefined}>
              <CatDot color={c.color} emoji={c.emoji} />
              <span className="cat-name">{c.name}</span>
              <span className="cat-time">{recordedById.get(c.id) ? fmtDuration(recordedById.get(c.id)!, { compact: true }) : ""}</span>
            </li>
          ))}
        </ul>
      </div>

      <FocusPanel />

      <div className="side-foot">
        {update && (
          <div className="update-card">
            <div className="update-title">Update available · v{update.version}</div>
            {update.progress === null ? (
              <button className="btn btn-outline sm" onClick={() => void import("../updater").then((m) => m.installUpdate()).catch(A.reportError)}>
                Install and restart
              </button>
            ) : (
              <div className="progress">
                <span style={{ width: `${update.progress}%` }} />
              </div>
            )}
            <div className="update-sub">Your data is kept.</div>
          </div>
        )}
        <div className="today-chip" onClick={A.goToday} role="button" tabIndex={0}>
          <span className="eyebrow">Today</span>
          <span className="today-chip-val">{fmtDuration(totals.recordedMs)}</span>
          <span className="today-chip-sub">of {fmtDuration(totals.plannedMs)} planned</span>
        </div>
        <button className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => A.setView("settings")}>
          <Settings2 size={15} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}

function NavItem(props: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; hint?: string }) {
  return (
    <button className={`nav-item ${props.active ? "active" : ""}`} onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
      {props.hint && <kbd className="nav-hint">{props.hint}</kbd>}
    </button>
  );
}
