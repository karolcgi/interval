import { useEffect, useRef } from "react";
import { bindings, comboOf } from "../state/shortcuts";
import { store, useApp } from "../state/store";
import * as A from "../state/actions";
import { Sidebar } from "./Sidebar";
import { CalendarView } from "./CalendarView";
import { RightPanel } from "./RightPanel";
import { StatsView } from "./StatsView";
import { BudgetsView } from "./BudgetsView";
import { DayLogView } from "./DayLogView";
import { ProgressView } from "./ProgressView";
import { ReviewsView } from "./ReviewsView";
import { CategoriesView } from "./CategoriesView";
import { SettingsView } from "./SettingsView";
import { FloatingTimer } from "./FloatingTimer";
import { CommandPalette } from "./CommandPalette";
import { Toasts, SleepGapBanner } from "./Overlays";
import { useTheme } from "./useTheme";
import { FocusOverlay } from "./FocusOverlay";
import { DailyRitual } from "./DailyRitual";
import { useFocusAlerts, useFocusEngine, useGlobalShortcuts, useShellEvents, useShellPrefs, useTimerBroadcast, currentSnapshot } from "./useFocusEngine";
import { CompletionCard } from "./FloatWindows";
import * as F from "../state/focus";

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
  useTimerBroadcast();
  useShellEvents();
  useShellPrefs();
  useFocusAlerts();
  useGlobalShortcuts();
  // The in-workspace timer pill is for when the docked timer is out of sight.
  const dockedTimer = useApp((s) => s.settings.sidebarOpen && s.settings.focusPanelOpen);

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
    <div className={`shell ${sidebarOpen ? "" : "no-sidebar"}`}>
      {sidebarOpen && <Sidebar />}
      <main className="workspace">
        {demo && (
          <div className="demo-ribbon">
            Demo data. Your real records are untouched. <button className="link" onClick={() => import("../bootstrap").then((m) => m.switchDemo(false))}>Switch to my data</button>
          </div>
        )}
        {view === "calendar" && <CalendarView />}
        {view === "stats" && <StatsView />}
        {view === "budgets" && <BudgetsView />}
        {view === "log" && <DayLogView />}
        {view === "progress" && <ProgressView />}
        {view === "reviews" && <ReviewsView />}
        {view === "categories" && <CategoriesView />}
        {view === "settings" && <SettingsView />}
        {!dockedTimer && <FloatingTimer />}
      </main>
      {view === "calendar" ? <RightPanel overview={panelOpen} /> : <div />}
      <SleepGapBanner />
      <CommandPalette />
      <Toasts />
      <DailyRitual />
      <FocusOverlay />
      <InAppCompletion />
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
      if ((mod || e.altKey) && !bindings(s.settings.shortcuts).has(comboOf(e))) return;
      if ((k === "delete" || k === "backspace") && sel) {
        e.preventDefault();
        return void (sel.kind === "block" ? A.deleteBlocks([sel.id]) : A.deleteSession(sel.id));
      }
      if (k === "escape") return A.select(null);
      if (k === "arrowleft") return A.stepDate(-1);
      if (k === "arrowright") return A.stepDate(1);
      const action = bindings(s.settings.shortcuts).get(comboOf(e));
      if (action) {
        e.preventDefault();
        return runAction(action);
      }
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

function runAction(id: string) {
  const s = store.get();
  const sel = s.selection;
  switch (id) {
    case "today":
      return A.goToday();
    case "prev":
      return A.stepDate(-1);
    case "next":
      return A.stepDate(1);
    case "dayView":
      return A.setCalendarMode("day");
    case "weekView":
      return A.setCalendarMode("week");
    case "monthView":
      return A.setCalendarMode("month");
    case "timer":
      return void A.toggleTimer();
    case "focusMode":
      return store.set({ focusMode: !s.focusMode });
    case "focusToggle":
      return void F.toggle().catch(A.reportError);
    case "focusSkip":
      return void F.skip().catch(A.reportError);
    case "focusExtend":
      return void F.extend(5).catch(A.reportError);
    case "miniTimer":
      return void import("./FocusPanel").then((m) => m.toggleMini()).catch(A.reportError);
    case "sidebar":
      return void A.updateSettings({ sidebarOpen: !s.settings.sidebarOpen });
    case "panel":
      return void A.updateSettings({ rightPanelOpen: !s.settings.rightPanelOpen });
    case "split":
      return sel?.kind === "block" ? void A.splitBlock(sel.id) : undefined;
    case "confirm":
      return sel?.kind === "block" ? void A.completeBlockManually(sel.id) : undefined;
    case "rename":
      return sel ? A.startRename(sel) : undefined;
    case "dayLog":
      return A.setView("log");
    case "progress":
      return A.setView("progress");
    case "reviews":
      return A.setView("reviews");
  }
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

/** Browser preview: the completion popup as a card in the corner (the desktop app uses its own window). */
function InAppCompletion() {
  const at = useApp((s) => s.completionPopup);
  const rev = useApp((s) => s.focus?.rev ?? 0);
  const openRev = useRef<number | null>(null);
  useEffect(() => {
    if (at === null) return void (openRev.current = null);
    if (openRev.current === null) openRev.current = rev;
    else if (rev !== openRev.current) store.set({ completionPopup: null });
  }, [at, rev]);
  if (at === null) return null;
  const snap = currentSnapshot();
  return (
    <div className="in-app-completion">
      <CompletionCard snap={snap} send={(cmd) => void F.runCommand(cmd, snap.rev).catch(A.reportError)} onClose={() => store.set({ completionPopup: null })} />
    </div>
  );
}
