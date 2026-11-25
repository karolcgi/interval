import { useRef } from "react";
import { ChevronLeft, ChevronRight, Minus, PanelRight, Plus } from "lucide-react";
import { useApp } from "../state/store";
import * as A from "../state/actions";
import { Timeline } from "./Timeline";
import { MonthView } from "./MonthView";
import { Segmented } from "./bits";
import { addDays, dayKey, isSameDay, parseDayKey, startOfWeek } from "../domain/time";
import { fmt } from "../domain/format";

export function CalendarView() {
  const mode = useApp((s) => s.calendarMode);
  const date = useApp((s) => s.date);
  const settings = useApp((s) => s.settings);
  const dateInput = useRef<HTMLInputElement>(null);
  const isToday = isSameDay(date, Date.now());

  let eyebrow: string;
  let title: string;
  if (mode === "day") {
    eyebrow = isToday ? `Today · ${fmt.weekday(date)}` : fmt.weekday(date);
    title = fmt.monthDay(date);
  } else if (mode === "week") {
    const s = startOfWeek(date, settings.weekStartsOn);
    const e = addDays(s, 6);
    eyebrow = `Week of ${fmt.shortDate(s)}`;
    title = `${fmt.shortDate(s)} – ${fmt.shortDate(e)}`;
  } else {
    eyebrow = String(new Date(date).getFullYear());
    title = new Intl.DateTimeFormat(undefined, { month: "long" }).format(date);
  }

  const days =
    mode === "day" ? [date] : mode === "week" ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(date, settings.weekStartsOn), i)) : [];

  return (
    <section className="calendar">
      <header className="cal-header">
        <div className="cal-title-wrap">
          <div className="eyebrow cal-eyebrow">{eyebrow}</div>
          <h1 className="cal-title" onClick={() => dateInput.current?.showPicker?.()} title="Pick a date">
            {title}
          </h1>
          <input
            ref={dateInput}
            type="date"
            className="sr-only-input"
            value={dayKey(date)}
            onChange={(e) => e.target.value && A.setDate(parseDayKey(e.target.value).getTime())}
            tabIndex={-1}
            aria-label="Pick a date"
          />
        </div>
        <div className="cal-tools">
          {mode !== "month" && (
            <div className="zoom" title="Zoom (Ctrl + scroll)">
              <button className="icon-btn" onClick={() => void A.updateSettings({ hourHeight: Math.max(28, settings.hourHeight - 12) })} aria-label="Zoom out">
                <Minus size={14} />
              </button>
              <button className="icon-btn" onClick={() => void A.updateSettings({ hourHeight: Math.min(180, settings.hourHeight + 12) })} aria-label="Zoom in">
                <Plus size={14} />
              </button>
            </div>
          )}
          {mode !== "month" && (
            <select
              className="select sm"
              value={settings.snapMinutes}
              onChange={(e) => void A.updateSettings({ snapMinutes: Number(e.target.value) as 5 | 10 | 15 | 30 })}
              aria-label="Snap"
              title="Snap to"
            >
              {[5, 10, 15, 30].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          )}
          <Segmented
            size="sm"
            value={mode}
            onChange={(m) => A.setCalendarMode(m)}
            ariaLabel="Calendar view"
            options={[
              { value: "day", label: "Day", title: "Day (D)" },
              { value: "week", label: "Week", title: "Week (W)" },
              { value: "month", label: "Month", title: "Month (M)" },
            ]}
          />
          <button className="btn btn-outline sm" onClick={A.goToday} disabled={isToday && mode === "day"} title="Today (T)">
            Today
          </button>
          <div className="stepper">
            <button className="icon-btn" onClick={() => A.stepDate(-1)} aria-label="Previous">
              <ChevronLeft size={16} />
            </button>
            <button className="icon-btn" onClick={() => A.stepDate(1)} aria-label="Next">
              <ChevronRight size={16} />
            </button>
          </div>
          <button
            className={`icon-btn ${settings.rightPanelOpen ? "on" : ""}`}
            onClick={() => void A.updateSettings({ rightPanelOpen: !settings.rightPanelOpen })}
            aria-label="Toggle details panel"
            title="Details panel ( ] )"
          >
            <PanelRight size={15} />
          </button>
        </div>
      </header>
      {mode === "month" ? <MonthView /> : <Timeline days={days} />}
    </section>
  );
}
