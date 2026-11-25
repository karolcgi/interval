import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { store, useApp } from "../state/store";
import * as A from "../state/actions";
import { exportData } from "./SettingsView";
import { fmt, fmtDuration, fmtTime } from "../domain/format";
import { CatDot } from "./bits";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => unknown;
}

interface Hit {
  kind: "block" | "session";
  id: string;
  start: number;
  end: number | null;
  title: string | null;
  categoryId: string;
}

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  if (!open) return null;
  return <Palette />;
}

function Palette() {
  const categories = useApp((s) => s.categories);
  const db = useApp((s) => s.db);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [hits, setHits] = useState<Hit[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const close = () => store.set({ paletteOpen: false });
  useEffect(() => input.current?.focus(), []);

  const commands: Command[] = useMemo(() => {
    const s = store.get();
    return [
      { id: "today", label: "Go to today", hint: "T", run: A.goToday },
      { id: "day", label: "Day view", hint: "D", run: () => A.setCalendarMode("day") },
      { id: "week", label: "Week view", hint: "W", run: () => A.setCalendarMode("week") },
      { id: "month", label: "Month view", hint: "M", run: () => A.setCalendarMode("month") },
      { id: "stats", label: "Open statistics", run: () => A.setView("stats") },
      { id: "cats", label: "Edit categories & tags", run: () => A.setView("categories") },
      { id: "settings", label: "Open settings", run: () => A.setView("settings") },
      { id: "timer", label: s.running ? "Stop timer" : "Start timer", hint: "S", run: A.toggleTimer },
      { id: "undo", label: "Undo", hint: "Ctrl Z", run: A.undo },
      { id: "redo", label: "Redo", hint: "Ctrl Y", run: A.redo },
      { id: "theme", label: "Toggle light / dark theme", run: () => A.updateSettings({ theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark" }) },
      { id: "sidebar", label: "Toggle sidebar", hint: "[", run: () => A.updateSettings({ sidebarOpen: !s.settings.sidebarOpen }) },
      { id: "panel", label: "Toggle details panel", hint: "]", run: () => A.updateSettings({ rightPanelOpen: !s.settings.rightPanelOpen }) },
      { id: "actual", label: "Toggle actual lane", run: () => A.updateSettings({ showActualLane: !s.settings.showActualLane }) },
      { id: "export-json", label: "Export all data (JSON)", run: () => exportData("json") },
      { id: "export-csv", label: "Export time entries (CSV)", run: () => exportData("csv") },
      ...categories
        .filter((c) => !c.archivedAt)
        .map((c) => ({ id: `start-${c.id}`, label: `Start timer: ${c.name}`, run: () => A.startTimer({ categoryId: c.id }) })),
    ];
  }, [categories]);

  const filtered = useMemo(() => {
    const lq = q.trim().toLowerCase();
    if (!lq) return commands;
    return commands.filter((c) => lq.split(/\s+/).every((w) => c.label.toLowerCase().includes(w)));
  }, [commands, q]);

  // Search historical entries by title, notes or tag name
  useEffect(() => {
    const lq = q.trim();
    if (!db || lq.length < 2) return setHits([]);
    const like = `%${lq}%`;
    let alive = true;
    const t = setTimeout(async () => {
      const rows = await db.select<{ kind: string; id: string; start_at: number; end_at: number | null; title: string | null; category_id: string }>(
        `SELECT 'session' AS kind, s.id, s.start_at, s.end_at, s.title, s.category_id FROM sessions s
           WHERE s.title LIKE ? OR s.notes LIKE ? OR EXISTS (SELECT 1 FROM session_tags st JOIN tags t ON t.id = st.tag_id WHERE st.session_id = s.id AND t.name LIKE ?)
         UNION ALL
         SELECT 'block', b.id, b.start_at, b.end_at, b.title, b.category_id FROM blocks b
           WHERE b.title LIKE ? OR b.notes LIKE ? OR EXISTS (SELECT 1 FROM block_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.block_id = b.id AND t.name LIKE ?)
         ORDER BY start_at DESC LIMIT 12`,
        [like, like, like, like, like, like],
      );
      if (alive) setHits(rows.map((r) => ({ kind: r.kind as Hit["kind"], id: r.id, start: Number(r.start_at), end: r.end_at === null ? null : Number(r.end_at), title: r.title, categoryId: r.category_id })));
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, db]);

  const total = filtered.length + hits.length;
  useEffect(() => setIdx(0), [q]);

  const runAt = (i: number) => {
    close();
    if (i < filtered.length) Promise.resolve(filtered[i].run()).catch(A.reportError);
    else {
      const h = hits[i - filtered.length];
      if (!h) return;
      A.openDay(h.start);
      setTimeout(() => A.select({ kind: h.kind, id: h.id }), 50);
    }
  };

  const catById = new Map(categories.map((c) => [c.id, c]));
  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div className="palette popover-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <Search size={15} className="muted" />
          <input
            ref={input}
            value={q}
            placeholder="Type a command or search past entries…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") (e.preventDefault(), setIdx((i) => Math.min(total - 1, i + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setIdx((i) => Math.max(0, i - 1)));
              else if (e.key === "Enter") (e.preventDefault(), runAt(idx));
            }}
          />
        </div>
        <ul className="palette-list">
          {filtered.map((c, i) => (
            <li key={c.id} className={i === idx ? "on" : ""} onMouseEnter={() => setIdx(i)} onClick={() => runAt(i)}>
              <span>{c.label}</span>
              {c.hint && <kbd>{c.hint}</kbd>}
            </li>
          ))}
          {hits.length > 0 && <li className="palette-sep">Entries</li>}
          {hits.map((h, j) => {
            const i = filtered.length + j;
            const c = catById.get(h.categoryId);
            return (
              <li key={h.kind + h.id} className={i === idx ? "on" : ""} onMouseEnter={() => setIdx(i)} onClick={() => runAt(i)}>
                <CatDot color={c?.color ?? "#888"} />
                <span>{h.title || c?.name}</span>
                <span className="muted small">
                  {h.kind === "block" ? "planned" : "recorded"} · {fmt.shortDate(h.start)} {fmtTime(h.start)}
                  {h.end ? ` · ${fmtDuration(h.end - h.start, { compact: true })}` : ""}
                </span>
              </li>
            );
          })}
          {total === 0 && <li className="palette-empty muted">No results</li>}
        </ul>
      </div>
    </div>
  );
}
