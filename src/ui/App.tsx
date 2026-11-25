import { useEffect, useRef } from "react";
import { store, useApp } from "../state/store";
import * as A from "../state/actions";
import { Sidebar } from "./Sidebar";
import { CalendarView } from "./CalendarView";
import { RightPanel } from "./RightPanel";
import { StatsView } from "./StatsView";
import { CategoriesView } from "./CategoriesView";
import { SettingsView } from "./SettingsView";
import { FloatingTimer } from "./FloatingTimer";
import { CommandPalette } from "./CommandPalette";
import { Toasts, SleepGapBanner } from "./Overlays";
import { useTheme } from "./useTheme";
import { FocusOverlay } from "./FocusOverlay";
import { useFocusEngine, useTray } from "./useFocusEngine";

export function App() {
  const ready = useApp((s) => s.ready);
  const fatal = useApp((s) => s.fatal);
  const view = useApp((s) => s.view);
  const demo = useApp((s) => s.demo);
  const sidebarOpen = useApp((s) => s.settings.sidebarOpen);
  const panelOpen = useApp((s) => s.settings.rightPanelOpen);
  useTheme();
  useShortcuts();
  useHeartbeat();
  useFocusEngine();
  useTray();

  if (fatal)
    return (
      <div className="boot-screen">
        <div className="boot-card">
          <h1>Interval couldn’t open its database</h1>
          <p className="muted">{fatal}</p>
          <p className="muted">Your data has not been modified. Check that the data folder exists and is writable, then restart.</p>
        </div>
      </div>
    );
  if (!ready) return <div className="boot-screen" aria-busy="true" />;

  return (
    <div className={`shell ${sidebarOpen ? "" : "no-sidebar"} ${panelOpen && view === "calendar" ? "" : "no-panel"}`}>
      {sidebarOpen && <Sidebar />}
      <main className="workspace">
        {demo && (
          <div className="demo-ribbon">
            Demo data. Your real records are untouched. <button className="link" onClick={() => import("../bootstrap").then((m) => m.switchDemo(false))}>Switch to my data</button>
          </div>
        )}
        {view === "calendar" && <CalendarView />}
        {view === "stats" && <StatsView />}
        {view === "categories" && <CategoriesView />}
        {view === "settings" && <SettingsView />}
        <FloatingTimer />
      </main>
      {panelOpen && view === "calendar" && <RightPanel />}
      <SleepGapBanner />
      <CommandPalette />
      <Toasts />
      <FocusOverlay />
    </div>
  );
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = store.get();
      if (!s.ready) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "k") {
        e.preventDefault();
        store.set({ paletteOpen: !s.paletteOpen });
        return;
      }
      if (isTyping(e) || s.paletteOpen || document.querySelector(".popover-modal")) return;
      if (mod && k === "z" && !e.shiftKey) return e.preventDefault(), void A.undo();
      if ((mod && k === "y") || (mod && e.shiftKey && k === "z")) return e.preventDefault(), void A.redo();
      const sel = s.selection;
      if (mod && k === "d" && sel?.kind === "block") return e.preventDefault(), void A.duplicateBlock(sel.id);
      if (mod && k === "c" && sel?.kind === "block") return e.preventDefault(), A.copyBlocks([sel.id]);
      if (mod && k === "v") return e.preventDefault(), void A.pasteBlocks();
      if (mod && k === "e") return e.preventDefault(), void A.toggleTimer();
      if (mod || e.altKey) return;
      if ((k === "delete" || k === "backspace") && sel) {
        e.preventDefault();
        return void (sel.kind === "block" ? A.deleteBlocks([sel.id]) : A.deleteSession(sel.id));
      }
      if (k === "escape") return A.select(null);
      if (k === "f2" && sel) return e.preventDefault(), A.startRename(sel);
      if (k === "t") return A.goToday();
      if (k === "arrowleft" || k === "j") return A.stepDate(-1);
      if (k === "arrowright" || k === "k") return A.stepDate(1);
      if (k === "d") return A.setCalendarMode("day");
      if (k === "w") return A.setCalendarMode("week");
      if (k === "m") return A.setCalendarMode("month");
      if (k === "s") return void A.toggleTimer();
      if (k === "f") return store.set({ focusMode: !s.focusMode });
      if (k === "[") return void A.updateSettings({ sidebarOpen: !s.settings.sidebarOpen });
      if (k === "]") return void A.updateSettings({ rightPanelOpen: !s.settings.rightPanelOpen });
      if (k === "x" && sel?.kind === "block") return void A.splitBlock(sel.id);
      if (k === "c" && sel?.kind === "block") return void A.completeBlockManually(sel.id);
      // Category shortcuts recategorise the selected item
      if (sel) {
        const cat = s.categories.find((c) => !c.archivedAt && c.shortcut && c.shortcut.toLowerCase() === k);
        if (cat) {
          if (sel.kind === "block") void A.updateBlock(sel.id, { categoryId: cat.id }, "Change category");
          else void A.updateSession(sel.id, { categoryId: cat.id }, "Change category");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Keep a heartbeat while a timer runs so sleep/suspension can be detected. */
function useHeartbeat() {
  const last = useRef(Date.now());
  useEffect(() => {
    const tick = () => {
      const prev = last.current;
      last.current = Date.now();
      void A.heartbeat(prev).catch(() => {});
      // Roll over the "today" data at midnight
      const s = store.get();
      if (s.ready && new Date(prev).getDate() !== new Date(last.current).getDate()) void A.refresh();
    };
    const t = setInterval(tick, 30_000);
    const onVis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
}
