// v0.12 (integration Phase 3): optional Obsidian task / project for a focus session or a recorded one.
// A compact searchable list in the page (no native <select>, which closes by itself in the desktop webview).
import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronDown, CircleDashed, FolderKanban, X } from "lucide-react";
import { useApp } from "../state/store";
import { statusOf } from "../domain/integration";
import { TnIcon } from "./TnIcon";
import { useOutside } from "./bits";

export function LinkPicker(p: { kind: "task" | "project"; value: string | null; title: string | null; onPick: (ref: string | null) => void; compact?: boolean }) {
  const tasks = useApp((s) => s.extTasks);
  const projects = useApp((s) => s.extProjects);
  const meta = useApp((s) => s.extMeta);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => (setOpen(false), setQ("")), []);
  useOutside(ref, open ? close : () => {});

  const options = useMemo(() => {
    const n = q.trim().toLowerCase();
    const src =
      p.kind === "task"
        ? tasks.filter((t) => t.active || t.ref === p.value).map((t) => ({ ref: t.ref, title: t.title, sub: t.data.projectNames[0] ?? "", status: statusOf(meta, t.data.status), active: t.active }))
        : [...projects].sort((a, b) => Number(b.active) - Number(a.active)).map((x) => ({ ref: x.ref, title: x.title, sub: x.active ? "" : (x.status ?? ""), status: null, active: x.active }));
    return (n ? src.filter((o) => o.title.toLowerCase().includes(n) || o.sub.toLowerCase().includes(n)) : src).slice(0, 80);
  }, [p.kind, p.value, tasks, projects, meta, q]);

  const choose = (r: string | null) => {
    close();
    if (r !== p.value) p.onPick(r);
  };
  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") (e.preventDefault(), close());
    else if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(options.length - 1, h + 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(0, h - 1)));
    else if (e.key === "Enter") (e.preventDefault(), options[hi] && choose(options[hi].ref));
  };
  const label = p.kind === "task" ? "Task" : "Project";
  const shown = p.value ? (p.kind === "task" ? (tasks.find((t) => t.ref === p.value)?.title ?? p.title) : (projects.find((x) => x.ref === p.value)?.title ?? p.title)) : null;
  const Ico = p.kind === "task" ? CircleDashed : FolderKanban;

  return (
    <div className={`link-pick ${p.compact ? "compact" : ""}`} ref={ref}>
      <div className={`link-pick-btn ${p.value ? "set" : ""}`}>
        <button type="button" className="link-pick-main" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${shown ?? "none"}`} onClick={() => (setHi(0), setOpen(!open))} title={shown ? `${label}: ${shown}` : `Link a ${label.toLowerCase()} (optional)`}>
          <Ico size={12} className="muted" />
          <span className="link-pick-name">{shown ?? <span className="muted">{label} (optional)</span>}</span>
          {!p.value && <ChevronDown size={11} className="muted" />}
        </button>
        {p.value && (
          <button type="button" className="icon-btn sm" onClick={() => choose(null)} aria-label={`Remove ${label.toLowerCase()}`} title={`No ${label.toLowerCase()}`}>
            <X size={11} />
          </button>
        )}
      </div>
      {open && (
        <div className="link-pick-pop popover" onKeyDown={onKey}>
          <input className="field sm" autoFocus placeholder={`Search ${label.toLowerCase()}s`} value={q} onChange={(e) => (setQ(e.target.value), setHi(0))} aria-label={`Search ${label.toLowerCase()}s`} />
          <ul role="listbox" aria-label={label}>
            {options.map((o, i) => (
              <li key={o.ref} role="option" aria-selected={o.ref === p.value} className={`${i === hi ? "hi" : ""} ${o.ref === p.value ? "on" : ""} ${o.active ? "" : "inactive"}`} onMouseEnter={() => setHi(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o.ref)} title={o.ref}>
                {p.kind === "task" ? <TnIcon name={o.status?.icon} color={o.status?.color} size={11} className="link-pick-ico" /> : <FolderKanban size={11} className="muted" />}
                <span className="link-pick-title">{o.title}</span>
                {o.sub && <span className="muted link-pick-sub">{o.sub}</span>}
              </li>
            ))}
            {options.length === 0 && <li className="muted empty">{p.kind === "task" ? "No tasks" : "No projects"}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
