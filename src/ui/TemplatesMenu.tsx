import { useRef, useState } from "react";
import { LayoutTemplate, Trash2 } from "lucide-react";
import { useApp } from "../state/store";
import * as A from "../state/actions";
import * as P from "../state/planning";
import type { DayTemplate } from "../domain/types";
import { fmt, fmtDuration } from "../domain/format";
import { usePlacement, useOutside } from "./bits";

/** Calendar header button: apply a day template to the focused day, or save the focused day as one. */
export function TemplatesMenu() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btn}
        className={`icon-btn ${at ? "on" : ""}`}
        title="Day templates"
        aria-label="Day templates"
        onClick={() => {
          const r = btn.current!.getBoundingClientRect();
          setAt(at ? null : { x: r.right - 300, y: r.bottom + 6 });
        }}
      >
        <LayoutTemplate size={15} />
      </button>
      {at && <TemplatesPopover x={at.x} y={at.y} onClose={() => setAt(null)} />}
    </>
  );
}

function TemplatesPopover(p: { x: number; y: number; onClose: () => void }) {
  const templates = useApp((s) => s.templates);
  const date = useApp((s) => s.date);
  const { ref, style } = usePlacement(p.x, p.y);
  useOutside(ref, p.onClose);
  const [name, setName] = useState("");
  const dayLabel = fmt.shortDate(date);
  const save = async () => {
    const t = await P.saveDayAsTemplate(date, name).catch(A.reportError);
    if (t) setName("");
  };
  return (
    <div className="popover templates popover-modal" ref={ref} style={style} role="dialog" aria-label="Day templates" onKeyDown={(e) => e.key === "Escape" && p.onClose()}>
      <div className="tpl-head">
        <span className="eyebrow">Day templates</span>
        <span className="muted small">for {dayLabel}</span>
      </div>
      {templates.length === 0 && <p className="tpl-empty muted small">Plan a typical day, then save it here. Applying a template adds its blocks to any day.</p>}
      <ul className="tpl-list">
        {templates.map((t) => (
          <TemplateRow key={t.id} t={t} date={date} onApplied={p.onClose} />
        ))}
      </ul>
      <div className="tpl-save">
        <input
          className="field"
          placeholder={`Save ${dayLabel} as…`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && name.trim()) void save();
            if (e.key === "Escape") p.onClose();
          }}
          aria-label="New template name"
        />
        <button className="btn btn-outline sm" disabled={!name.trim()} onClick={() => void save()}>
          Save
        </button>
      </div>
    </div>
  );
}

function TemplateRow({ t, date, onApplied }: { t: DayTemplate; date: number; onApplied: () => void }) {
  const categories = useApp((s) => s.categories);
  const color = (id: string) => categories.find((c) => c.id === id)?.color ?? "#888";
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(t.name);
  const total = t.blocks.reduce((a, b) => a + b.durationMinutes, 0) * 60_000;
  const first = Math.min(...t.blocks.map((b) => b.startMinute), 24 * 60);
  const last = Math.max(...t.blocks.map((b) => b.startMinute + b.durationMinutes), 0);
  const span = Math.max(60, last - first);
  return (
    <li className="tpl-row">
      <div className="tpl-main">
        {renaming ? (
          <input
            className="field bare tpl-rename"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => (setRenaming(false), void P.renameTemplate(t.id, name))}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") (setName(t.name), setRenaming(false));
            }}
            aria-label="Template name"
          />
        ) : (
          <button className="tpl-name" onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
            {t.name}
          </button>
        )}
        <div className="tpl-strip" aria-hidden>
          {t.blocks.map((b) => (
            <span key={b.id} style={{ left: `${((b.startMinute - first) / span) * 100}%`, width: `${(b.durationMinutes / span) * 100}%`, background: color(b.categoryId) }} />
          ))}
        </div>
        <div className="muted small">
          {t.blocks.length} block{t.blocks.length === 1 ? "" : "s"} · {fmtDuration(total, { compact: true })}
          <button className="link-btn tpl-replace" onClick={() => void P.saveDayAsTemplate(date, t.name, t.id).catch(A.reportError)} title="Overwrite this template with the blocks planned on the current day">
            Replace with this day
          </button>
        </div>
      </div>
      <div className="tpl-acts">
        <button className="btn btn-outline sm" onClick={() => void P.applyTemplate(t.id, date).then(onApplied, A.reportError)}>
          Apply
        </button>
        <button className="icon-btn sm danger" title="Delete template" aria-label={`Delete ${t.name}`} onClick={() => void P.deleteTemplate(t.id).catch(A.reportError)}>
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  );
}
