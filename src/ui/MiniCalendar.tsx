import { useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useCollapsed } from "./SideSection";
import { useApp } from "../state/store";
import * as A from "../state/actions";
import { addDays, addMonths, dayKey, startOfDay, startOfMonth, startOfWeek } from "../domain/time";
import { fmt } from "../domain/format";

export function MiniCalendar() {
  const date = useApp((s) => s.date);
  const mode = useApp((s) => s.calendarMode);
  const weekStartsOn = useApp((s) => s.settings.weekStartsOn);
  const [month, setMonth] = useState(startOfMonth(date));
  const [collapsed, toggle] = useCollapsed("calendar");
  useEffect(() => setMonth(startOfMonth(date)), [date]);

  const gridStart = startOfWeek(month, weekStartsOn);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const todayKey = dayKey(Date.now());
  const selKey = dayKey(date);
  const weekStart = startOfWeek(date, weekStartsOn);
  const inSelWeek = (d: number) => mode === "week" && d >= weekStart && d < addDays(weekStart, 7);
  const labels = Array.from({ length: 7 }, (_, i) => fmt.weekdayShort(addDays(gridStart, i)).slice(0, 2));

  return (
    <div className={`mini-cal ${collapsed ? "collapsed" : ""}`} aria-label="Calendar">
      <div className="mini-cal-head">
        <button className="side-toggle mini-cal-title" onClick={toggle} aria-expanded={!collapsed} title={collapsed ? "Show calendar" : "Hide calendar"}>
          <span>{fmt.monthYear(month)}</span>
          <ChevronDown size={12} className={`ftp-chev ${collapsed ? "closed" : ""}`} />
        </button>
        {!collapsed && (
          <>
            <button className="icon-btn sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
              <ChevronLeft size={14} />
            </button>
            <button className="icon-btn sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
              <ChevronRight size={14} />
            </button>
          </>
        )}
      </div>
      {!collapsed && (
      <div className="mini-cal-grid">
        {labels.map((l, i) => (
          <span key={i} className="mini-cal-dow">
            {l}
          </span>
        ))}
        {days.map((d) => {
          const k = dayKey(d);
          const out = new Date(d).getMonth() !== new Date(month).getMonth();
          return (
            <button
              key={k}
              className={`mini-cal-day ${out ? "out" : ""} ${k === todayKey ? "today" : ""} ${k === selKey ? "sel" : ""} ${inSelWeek(d) ? "in-week" : ""}`}
              onClick={() => { A.setView("calendar"); A.setDate(startOfDay(d)); }}
              onDoubleClick={() => A.openDay(d)}
              aria-label={fmt.full(d)}
            >
              {new Date(d).getDate()}
            </button>
          );
        })}
      </div>
      )}
    </div>
  );
}
