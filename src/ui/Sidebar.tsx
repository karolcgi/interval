// Left sidebar (v0.7): mini calendar, activity presets, activities, focus timer, then today's
// totals. Primary navigation lives in the top tab bar. Calendar, presets and activities collapse;
// the timer keeps its own toggle. Collapsed sections are remembered (settings.sidebarCollapsed).
import { useMemo } from "react";
import { Settings2 } from "lucide-react";
import { useApp, useNow } from "../state/store";
import { SideSection } from "./SideSection";
import * as A from "../state/actions";
import { FocusPanel } from "./FocusPanel";
import { MiniCalendar } from "./MiniCalendar";
import { PresetLibrary } from "./PresetLibrary";
import { computeStats } from "../domain/stats";
import { addDays, startOfDay } from "../domain/time";
import { fmtDuration } from "../domain/format";
import { CatDot } from "./bits";
import * as L from "../state/library";

export function Sidebar() {
  const view = useApp((s) => s.view);
  const categories = useApp((s) => s.categories);
  const today = useApp((s) => s.today);
  const update = useApp((s) => s.update);
  const weekTemplate = useApp((s) => s.weekTemplate);
  const dismissed = useApp((s) => s.dismissed);
  const now = useNow(30_000);

  const totals = useMemo(() => {
    const d = startOfDay(now);
    return computeStats({ sessions: today.sessions, blocks: today.blocks, categories, range: { start: d, end: addDays(d, 1) }, now });
  }, [today, categories, now]);
  // Suggested by the template and not yet planned (never part of the planned total).
  const suggestedMs = useMemo(() => {
    void weekTemplate;
    void dismissed;
    return L.suggestedTodayMs(today.blocks);
  }, [weekTemplate, dismissed, today.blocks]);

  const active = categories.filter((c) => !c.archivedAt && !c.parentId);
  const recordedById = new Map(totals.byCategory.map((x) => [x.categoryId, x.recordedMs]));

  return (
    <aside className="sidebar">
      <MiniCalendar />

      <PresetLibrary />

      <SideSection id="activities" title="Activities">
        <ul className="cat-list">
          {active.map((c) => (
            <li key={c.id} className="cat-row" title={c.shortcut ? `Shortcut: ${c.shortcut}` : undefined}>
              <CatDot color={c.color} icon={c.icon} />
              <span className="cat-name">{c.name}</span>
              <span className="cat-time">{recordedById.get(c.id) ? fmtDuration(recordedById.get(c.id)!, { compact: true }) : ""}</span>
            </li>
          ))}
        </ul>
      </SideSection>

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
        <div className="today-chip" onClick={A.goToday} role="button" tabIndex={0} aria-label="Today's totals">
          <span className="eyebrow">Today</span>
          <span className="today-chip-val">{fmtDuration(totals.recordedMs)}</span>
          <span className="today-chip-sub">of {fmtDuration(totals.plannedMs)} planned</span>
          {suggestedMs > 0 && <span className="today-chip-sub tpl-sub">+ {fmtDuration(suggestedMs, { compact: true })} suggested by template</span>}
        </div>
        <button className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => A.setView("settings")}>
          <Settings2 size={15} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}
