// Template tab: one generic Monday–Sunday week that repeats indefinitely. Reuses the calendar
// timeline (mode "template"). Nothing here is planned or recorded time: since v0.9 its blocks are a
// non-interactive overlay behind Today and Calendar, and they carry their own name, icon and colour.
import { useMemo, useRef, useState } from "react";
import { Copy, Import, Minus, Plus, Redo2, Trash2, Undo2, X } from "lucide-react";
import { store, useApp } from "../state/store";
import * as A from "../state/actions";
import * as L from "../state/library";
import { Timeline } from "./Timeline";
import { CatDot, catVars, lookOf, usePlacement, useOutside } from "./bits";
import { ColorField, IconButton } from "./IconPicker";
import { PALETTE } from "./CategoriesView";
import { TagInput } from "./TagInput";
import { REF_WEEK, templateTotals, WEEKDAY_NAMES, WEEKDAY_SHORT } from "../domain/weekTemplate";
import { fmtDuration, fmtTime } from "../domain/format";
import type { WeekTemplateBlock } from "../domain/types";
import { atMinute } from "../domain/time";

const hrs = (m: number) => fmtDuration(m * 60_000, { compact: true });

export function TemplateView() {
  const settings = useApp((s) => s.settings);
  const undoDepth = useApp((s) => s.undoDepth);
  const redoDepth = useApp((s) => s.redoDepth);
  const templates = useApp((s) => s.templates);
  const [pop, setPop] = useState<{ kind: "copy" | "import"; x: number; y: number } | null>(null);
  const copyBtn = useRef<HTMLButtonElement>(null);
  const importBtn = useRef<HTMLButtonElement>(null);
  const open = (kind: "copy" | "import", el: HTMLElement | null) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPop(pop?.kind === kind ? null : { kind, x: r.left, y: r.bottom + 6 });
  };
  return (
    <section className="template-view">
      <div className="calendar">
        <header className="cal-header tpl-header">
          <div className="cal-title-wrap">
            <div className="eyebrow cal-eyebrow">Repeats every week</div>
            <h1 className="cal-title static">Weekly template</h1>
            <p className="tpl-sub muted small">Your ideal week, not a calendar. Its blocks show as a dimmed overlay behind Today and Calendar, as a guide. They never count as planned or recorded time.</p>
          </div>
          <div className="cal-tools">
            <div className="zoom" title="Zoom (Ctrl + scroll)">
              <button className="icon-btn" onClick={() => void A.updateSettings({ hourHeight: Math.max(28, settings.hourHeight - 12) })} aria-label="Zoom out">
                <Minus size={14} />
              </button>
              <button className="icon-btn" onClick={() => void A.updateSettings({ hourHeight: Math.min(180, settings.hourHeight + 12) })} aria-label="Zoom in">
                <Plus size={14} />
              </button>
            </div>
            <select className="select sm" value={settings.snapMinutes} onChange={(e) => void A.updateSettings({ snapMinutes: Number(e.target.value) as 5 | 10 | 15 | 30 })} aria-label="Snap" title="Snap to">
              {[5, 10, 15, 30].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
            <button ref={copyBtn} className={`btn btn-outline sm ${pop?.kind === "copy" ? "on" : ""}`} onClick={() => open("copy", copyBtn.current)}>
              <Copy size={13} /> Copy day
            </button>
            {templates.length > 0 && (
              <button ref={importBtn} className="btn btn-ghost sm" onClick={() => open("import", importBtn.current)} title="Import a saved day template into a weekday">
                <Import size={13} /> Import day
              </button>
            )}
            <div className="stepper">
              <button className="icon-btn" onClick={() => void A.undo()} disabled={!undoDepth} aria-label="Undo" title="Undo (Ctrl Z)">
                <Undo2 size={15} />
              </button>
              <button className="icon-btn" onClick={() => void A.redo()} disabled={!redoDepth} aria-label="Redo" title="Redo (Ctrl Y)">
                <Redo2 size={15} />
              </button>
            </div>
          </div>
        </header>
        <Timeline days={REF_WEEK} mode="template" />
      </div>
      <TemplatePanel />
      {pop?.kind === "copy" && <CopyDayPopover x={pop.x} y={pop.y} onClose={() => setPop(null)} />}
      {pop?.kind === "import" && <ImportDayPopover x={pop.x} y={pop.y} onClose={() => setPop(null)} />}
    </section>
  );
}

function TemplatePanel() {
  const weekTemplate = useApp((s) => s.weekTemplate);
  const selId = useApp((s) => s.tplSelection);
  const sel = weekTemplate.find((t) => t.id === selId);
  const totals = useMemo(() => templateTotals(weekTemplate), [weekTemplate]);
  // v0.9: no categories in the template, so the week is summed by block name (with that block's look).
  const catRows = useMemo(() => {
    const m = new Map<string, { name: string; color: string; icon: string | null; min: number }>();
    for (const t of weekTemplate) {
      const name = t.title?.trim() || "Untitled";
      const r = m.get(name.toLowerCase()) ?? { name, color: t.color ?? "#888", icon: t.icon ?? null, min: 0 };
      r.min += t.durationMinutes;
      m.set(name.toLowerCase(), r);
    }
    return [...m.values()].sort((a, b) => b.min - a.min);
  }, [weekTemplate]);
  const max = Math.max(1, ...catRows.map((r) => r.min));
  return (
    <aside className="panel tpl-panel" aria-label="Template details">
      <div className="panel-inner">
        {sel ? (
          <TemplateBlockEditor key={sel.id} t={sel} />
        ) : (
          <p className="muted small tpl-hint">Drag on a day to add a block, or drag a preset from the sidebar. Alt-drag copies a block; right-click for more.</p>
        )}
        <section className="panel-sec">
          <div className="sec-head">
            <h3>Intended per week</h3>
            <span className="muted small">{hrs(totals.total)}</span>
          </div>
          {catRows.length === 0 && <p className="muted small">Nothing in the template yet.</p>}
          <ul className="dist" aria-label="Intended hours per block name">
            {catRows.map((r) => (
              <li key={r.name} style={catVars(r.color)}>
                <div className="dist-top">
                  <span className="dist-name">
                    <CatDot color={r.color} icon={r.icon} /> {r.name}
                  </span>
                  <span className="dist-val">{hrs(r.min)}</span>
                </div>
                <div className="dist-bar">
                  <span className="dist-plan" style={{ width: `${(r.min / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel-sec">
          <div className="sec-head">
            <h3>Per day</h3>
          </div>
          <ul className="tpl-days" aria-label="Intended hours per day">
            {totals.byDay.map((m, w) => (
              <li key={w}>
                <span>{WEEKDAY_SHORT[w]}</span>
                <span className="muted">{m ? hrs(m) : "–"}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">Template hours never count as planned or recorded time.</p>
        </section>
      </div>
    </aside>
  );
}

function TemplateBlockEditor({ t }: { t: WeekTemplateBlock }) {
  const categories = useApp((s) => s.categories);
  const tf = useApp((s) => s.settings.timeFormat);
  const [title, setTitle] = useState(t.title ?? "");
  const [notes, setNotes] = useState(t.notes ?? "");
  const upd = (patch: Partial<WeekTemplateBlock>, label: string) => void L.updateTemplateBlock(t.id, patch, label).catch(A.reportError);
  const start = atMinute(REF_WEEK[t.weekday], t.startMinute);
  const cat = categories.find((c) => c.id === t.categoryId);
  return (
    <section className="tpl-editor" style={catVars(lookOf(t, cat).color)} aria-label="Template block">
      <div className="inspector-head">
        <span className="eyebrow">Template block · every {WEEKDAY_NAMES[t.weekday]}</span>
        <button className="icon-btn sm" onClick={() => store.set({ tplSelection: null })} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      <div className="pf-name">
      <IconButton icon={t.icon} color={lookOf(t, cat).color} label="Template block icon" onPick={(icon) => upd({ icon }, icon ? "Change icon" : "Remove icon")} />
      <input
        className="field bare tpl-title"
        value={title}
        placeholder="Name"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => (title.trim() || null) !== t.title && upd({ title: title.trim() || null }, "Rename template block")}
        onKeyDown={(e) => (e.stopPropagation(), e.key === "Enter" && (e.target as HTMLInputElement).blur())}
        aria-label="Template block name"
      />
      </div>
      <div className="muted small tpl-time">
        {WEEKDAY_NAMES[t.weekday]} · {fmtTime(start, tf)} – {fmtTime(start + t.durationMinutes * 60_000, tf)} · {hrs(t.durationMinutes)}
      </div>
      <div className="pf-row">
        <span className="pf-label">Colour</span>
        <ColorField value={t.color} fallback="#888" palette={PALETTE} onChange={(color) => upd({ color }, "Change colour")} noAuto />
      </div>
      <div className="pf-row">
        <span className="pf-label">Day</span>
        <select className="select sm" value={t.weekday} onChange={(e) => upd({ weekday: Number(e.target.value) }, "Move template block")} aria-label="Weekday">
          {WEEKDAY_NAMES.map((n, w) => (
            <option key={w} value={w}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <div className="pf-row">
        <span className="pf-label">Tags</span>
        <TagInput value={t.tagIds} onChange={(tagIds) => upd({ tagIds }, "Change tags")} />
      </div>
      <label className="pf-row">
        <span className="pf-label">Notes</span>
        <textarea
          className="field"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => (notes.trim() || null) !== t.notes && upd({ notes: notes.trim() || null }, "Edit notes")}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label="Notes"
        />
      </label>
      <div className="pf-actions">
        <button className="btn btn-outline sm" onClick={() => void L.duplicateTemplateBlock(t.id).catch(A.reportError)}>
          Duplicate
        </button>
        <button className="icon-btn danger" onClick={() => void L.deleteTemplateBlocks([t.id]).catch(A.reportError)} aria-label="Delete template block" title="Delete (Del)">
          <Trash2 size={14} />
        </button>
      </div>
      <p className="muted small">Changes apply to future suggestions only. Blocks you already confirmed stay as they are.</p>
    </section>
  );
}

function CopyDayPopover(p: { x: number; y: number; onClose: () => void }) {
  const { ref, style } = usePlacement(p.x, p.y);
  useOutside(ref, p.onClose);
  const tpl = useApp((s) => s.weekTemplate);
  const [from, setFrom] = useState(() => Math.max(0, tpl[0]?.weekday ?? 0));
  const [to, setTo] = useState<number[]>([]);
  const [replace, setReplace] = useState(true);
  const count = tpl.filter((t) => t.weekday === from).length;
  return (
    <div className="popover copy-day popover-modal" ref={ref} style={style} role="dialog" aria-label="Copy day" onKeyDown={(e) => e.key === "Escape" && p.onClose()}>
      <div className="eyebrow">Copy a day’s structure</div>
      <label className="pf-row">
        <span className="pf-label">From</span>
        <select className="select sm" value={from} onChange={(e) => (setFrom(Number(e.target.value)), setTo([]))} aria-label="Copy from">
          {WEEKDAY_NAMES.map((n, w) => (
            <option key={w} value={w}>
              {n} ({tpl.filter((t) => t.weekday === w).length})
            </option>
          ))}
        </select>
      </label>
      <div className="pf-row">
        <span className="pf-label">To</span>
        <div className="chip-row" role="group" aria-label="Copy to">
          {WEEKDAY_SHORT.map((n, w) => (
            <button key={w} className={`chip sm ${to.includes(w) ? "on" : ""}`} disabled={w === from} aria-pressed={to.includes(w)} onClick={() => setTo((x) => (x.includes(w) ? x.filter((y) => y !== w) : [...x, w]))}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <label className="pf-check">
        <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace what’s there
      </label>
      <div className="pf-actions">
        <button
          className="btn btn-outline sm"
          disabled={!count || !to.length}
          onClick={() => {
            p.onClose();
            void L.copyTemplateDay(from, to, replace).catch(A.reportError);
          }}
        >
          Copy {count} {count === 1 ? "block" : "blocks"}
        </button>
      </div>
    </div>
  );
}

function ImportDayPopover(p: { x: number; y: number; onClose: () => void }) {
  const { ref, style } = usePlacement(p.x, p.y);
  useOutside(ref, p.onClose);
  const templates = useApp((s) => s.templates);
  const [tid, setTid] = useState(templates[0]?.id ?? "");
  const [w, setW] = useState(0);
  return (
    <div className="popover copy-day popover-modal" ref={ref} style={style} role="dialog" aria-label="Import a day template" onKeyDown={(e) => e.key === "Escape" && p.onClose()}>
      <div className="eyebrow">Import a saved day template</div>
      <label className="pf-row">
        <span className="pf-label">Template</span>
        <select className="select sm" value={tid} onChange={(e) => setTid(e.target.value)} aria-label="Day template">
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.blocks.length})
            </option>
          ))}
        </select>
      </label>
      <label className="pf-row">
        <span className="pf-label">Into</span>
        <select className="select sm" value={w} onChange={(e) => setW(Number(e.target.value))} aria-label="Weekday">
          {WEEKDAY_NAMES.map((n, i) => (
            <option key={i} value={i}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <div className="pf-actions">
        <button
          className="btn btn-outline sm"
          disabled={!tid}
          onClick={() => {
            p.onClose();
            void L.importDayTemplate(tid, w).catch(A.reportError);
          }}
        >
          Import
        </button>
      </div>
      <p className="muted small">The day template itself is kept.</p>
    </div>
  );
}
