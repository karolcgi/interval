// Top tab bar (v0.7): the five primary views, plus a menu for the rest.
import { useRef, useState } from "react";
import { CalendarRange, ChevronDown, Gauge, NotebookText, Settings2, Shapes, TrendingUp } from "lucide-react";
import { useApp, useNow, type View } from "../state/store";
import * as A from "../state/actions";
import { isSameDay } from "../domain/time";
import { usePlacement, useOutside } from "./bits";
import { MenuItem } from "./ContextMenus";

const MORE: Array<{ view: View; label: string; icon: React.ReactNode }> = [
  { view: "budgets", label: "Time budgets", icon: <Gauge size={13} /> },
  { view: "progress", label: "Progress", icon: <TrendingUp size={13} /> },
  { view: "reviews", label: "Reviews", icon: <CalendarRange size={13} /> },
  { view: "log", label: "Day log", icon: <NotebookText size={13} /> },
  { view: "categories", label: "Categories & tags", icon: <Shapes size={13} /> },
  { view: "settings", label: "Settings", icon: <Settings2 size={13} /> },
];

export function TopBar() {
  const view = useApp((s) => s.view);
  const mode = useApp((s) => s.calendarMode);
  const date = useApp((s) => s.date);
  const now = useNow(60_000);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const todayActive = view === "calendar" && mode === "day";
  const more = MORE.find((m) => m.view === view);

  const tabs: Array<{ id: string; label: string; active: boolean; onClick: () => void; title?: string }> = [
    { id: "today", label: "Today", active: todayActive, title: todayActive && !isSameDay(date, now) ? "Back to today (T)" : "Today (T)", onClick: () => A.openDay(Date.now()) },
    { id: "calendar", label: "Calendar", active: view === "calendar" && mode !== "day", title: "Week or month (W, M)", onClick: () => A.setCalendarMode(mode === "day" ? "week" : mode) },
    { id: "stats", label: "Statistics", active: view === "stats", onClick: () => A.setView("stats") },
    { id: "presets", label: "Presets", active: view === "presets", onClick: () => A.setView("presets") },
    { id: "template", label: "Template", active: view === "template", title: "Weekly template", onClick: () => A.setView("template") },
  ];

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden>
          <svg viewBox="0 0 22 22" width="20" height="20">
            <rect width="22" height="22" rx="5" fill="var(--accent)" />
            <path d="M6 11h10M11 6v10" stroke="var(--accent-ink)" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>
        <span className="brand-name">Interval</span>
      </div>
      <nav className="tabs" aria-label="Views">
        {tabs.map((t) => (
          <button key={t.id} aria-current={t.active ? "page" : undefined} className={`tab ${t.active ? "active" : ""}`} onClick={t.onClick} title={t.title}>
            {t.label}
          </button>
        ))}
        <button
          ref={moreBtn}
          className={`tab tab-more ${more ? "active" : ""} ${menu ? "open" : ""}`}
          aria-haspopup="menu"
          aria-expanded={!!menu}
          onClick={() => {
            const r = moreBtn.current!.getBoundingClientRect();
            setMenu(menu ? null : { x: r.left, y: r.bottom + 4 });
          }}
        >
          {more ? more.label : "More"}
          <ChevronDown size={12} />
        </button>
      </nav>
      {menu && <MoreMenu x={menu.x} y={menu.y} current={view} onClose={() => setMenu(null)} />}
    </header>
  );
}

function MoreMenu(p: { x: number; y: number; current: View; onClose: () => void }) {
  const { ref, style } = usePlacement(p.x, p.y);
  useOutside(ref, p.onClose);
  return (
    <div className="popover menu" ref={ref} style={style} role="menu" aria-label="More views" onKeyDown={(e) => e.key === "Escape" && p.onClose()}>
      {MORE.map((m) => (
        <MenuItem
          key={m.view}
          icon={m.icon}
          label={m.label}
          checked={m.view === p.current}
          onClick={() => {
            p.onClose();
            A.setView(m.view);
          }}
        />
      ))}
    </div>
  );
}
