// Calendar toolbar controls for the weekly template's suggestions: show/hide the overlay, apply the
// day's template (skipping or keeping conflicts), and restore suggestions dismissed for the day.
import { useMemo, useRef, useState } from "react";
import { CalendarCheck2, Layers, RotateCcw } from "lucide-react";
import { useApp } from "../state/store";
import * as A from "../state/actions";
import * as L from "../state/library";
import { fmtTime } from "../domain/format";
import { CatDot, usePlacement, useOutside } from "./bits";
import type { Id } from "../domain/types";

export function TemplateTools() {
  const mode = useApp((s) => s.calendarMode);
  const date = useApp((s) => s.date);
  const overlay = useApp((s) => s.settings.templateOverlay);
  const hasTemplate = useApp((s) => s.weekTemplate.length > 0);
  const blocks = useApp((s) => s.blocks);
  const tpl = useApp((s) => s.weekTemplate);
  const dismissed = useApp((s) => s.dismissed);
  const onPast = useApp((s) => s.settings.templateOnPast);
  const [pop, setPop] = useState<{ x: number; y: number } | null>(null);
  const applyBtn = useRef<HTMLButtonElement>(null);
  const day = useMemo(() => {
    void blocks;
    void tpl;
    void dismissed;
    void onPast;
    return L.daySuggestions(date);
  }, [date, blocks, tpl, dismissed, onPast]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!hasTemplate || mode === "month") return null;
  const pending = day.visible.length;

  const apply = () => {
    const plan = L.applyPlan(date);
    if (plan.conflicts.length === 0) return void L.applyDayTemplate(date).catch(A.reportError);
    const r = applyBtn.current!.getBoundingClientRect();
    setPop({ x: r.right - 320, y: r.bottom + 6 });
  };

  return (
    <>
      <button
        className={`icon-btn tpl-toggle ${overlay ? "on" : ""}`}
        onClick={() => void A.updateSettings({ templateOverlay: !overlay }).catch(A.reportError)}
        aria-pressed={overlay}
        aria-label="Show template suggestions"
        title={overlay ? "Hide weekly-template suggestions" : "Show weekly-template suggestions"}
      >
        <Layers size={15} />
      </button>
      {overlay && mode === "day" && day.dismissed.length > 0 && (
        <button className="btn btn-ghost sm" onClick={() => void L.restoreSuggestions(date).catch(A.reportError)} title="Show the suggestions you dismissed for this day again">
          <RotateCcw size={12} /> Restore {day.dismissed.length}
        </button>
      )}
      {overlay && mode === "day" && pending > 0 && (
        <button ref={applyBtn} className="btn btn-outline sm apply-tpl" onClick={apply} title="Add every suggestion for this day to the plan">
          <CalendarCheck2 size={13} /> Apply template ({pending})
        </button>
      )}
      {pop && <ConflictPopover x={pop.x} y={pop.y} date={date} onClose={() => setPop(null)} />}
    </>
  );
}

function ConflictPopover(p: { x: number; y: number; date: number; onClose: () => void }) {
  const { ref, style } = usePlacement(p.x, p.y);
  useOutside(ref, p.onClose);
  const categories = useApp((s) => s.categories);
  const tf = useApp((s) => s.settings.timeFormat);
  const plan = useMemo(() => L.applyPlan(p.date), [p.date]);
  const [keep, setKeep] = useState<Id[]>([]);
  const name = (catId: Id, title: string | null) => title || categories.find((c) => c.id === catId)?.name || "Untitled";
  return (
    <div className="popover conflicts popover-modal" ref={ref} style={style} role="dialog" aria-label="Template conflicts" onKeyDown={(e) => e.key === "Escape" && p.onClose()}>
      <div className="eyebrow">Apply template</div>
      <p className="small">
        {plan.clean.length} {plan.clean.length === 1 ? "suggestion fits" : "suggestions fit"}. {plan.conflicts.length} overlap{plan.conflicts.length === 1 ? "s" : ""} something already planned:
      </p>
      <ul className="conflict-list">
        {plan.conflicts.map(({ s, with: w }) => {
          const c = categories.find((x) => x.id === s.tb.categoryId);
          const on = keep.includes(s.tb.id);
          return (
            <li key={s.tb.id}>
              <label>
                <input type="checkbox" checked={on} onChange={() => setKeep((k) => (on ? k.filter((x) => x !== s.tb.id) : [...k, s.tb.id]))} />
                <CatDot color={c?.color ?? "#888"} icon={c?.icon} />
                <span>
                  <b>{name(s.tb.categoryId, s.tb.title)}</b> {fmtTime(s.startAt, tf)}–{fmtTime(s.endAt, tf)}
                  <span className="muted small"> overlaps {w.map((b) => name(b.categoryId, b.title)).join(", ")}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="muted small">Ticked ones are added anyway, next to what’s there. Unticked ones are skipped and stay as suggestions.</p>
      <div className="pf-actions">
        <button
          className="btn btn-outline sm"
          onClick={() => {
            p.onClose();
            void L.applyDayTemplate(p.date, keep).catch(A.reportError);
          }}
        >
          {keep.length ? `Apply, keep ${keep.length} overlapping` : "Apply, skip overlaps"}
        </button>
        <button className="btn btn-ghost sm" onClick={p.onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
