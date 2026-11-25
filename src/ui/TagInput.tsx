import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useApp } from "../state/store";
import * as A from "../state/actions";
import type { Id } from "../domain/types";

/** Multi-tag input with autocomplete. Enter or comma adds; unknown names create a new tag. */
export function TagInput({ value, onChange }: { value: Id[]; onChange: (ids: Id[]) => void }) {
  const tags = useApp((s) => s.tags);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const byId = new Map(tags.map((t) => [t.id, t]));

  const suggestions = useMemo(() => {
    const lq = q.trim().toLowerCase().replace(/^#/, "");
    return tags
      .filter((t) => !t.archivedAt && !value.includes(t.id) && (!lq || t.name.toLowerCase().includes(lq)))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(lq)) - Number(!b.name.toLowerCase().startsWith(lq)))
      .slice(0, 8);
  }, [tags, q, value]);

  const exact = tags.find((t) => t.name.toLowerCase() === q.trim().toLowerCase().replace(/^#/, ""));

  const add = async (name: string) => {
    const clean = name.trim().replace(/^#/, "");
    if (!clean) return;
    const t = await A.ensureTag(clean);
    if (!value.includes(t.id)) onChange([...value, t.id].sort());
    setQ("");
    setIdx(0);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      if (!q.trim()) return;
      e.preventDefault();
      const s = suggestions[idx];
      void add(s && !exact ? s.name : q).catch(A.reportError);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Backspace" && !q && value.length) {
      onChange(value.slice(0, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
      input.current?.blur();
    }
  };

  return (
    <div className="tag-input" onClick={() => input.current?.focus()}>
      {value.map((id) => (
        <span key={id} className="tag-pill">
          #{byId.get(id)?.name ?? "?"}
          <button
            aria-label={`Remove ${byId.get(id)?.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onChange(value.filter((x) => x !== id));
            }}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        ref={input}
        value={q}
        placeholder={value.length ? "" : "Add tags…"}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setIdx(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKey}
        aria-label="Add tag"
      />
      {open && (suggestions.length > 0 || (q.trim() && !exact)) && (
        <ul className="tag-suggest popover">
          {suggestions.map((t, i) => (
            <li key={t.id} className={i === idx ? "on" : ""} onMouseDown={(e) => (e.preventDefault(), void add(t.name))}>
              #{t.name}
            </li>
          ))}
          {q.trim() && !exact && (
            <li className="create" onMouseDown={(e) => (e.preventDefault(), void add(q))}>
              Create “{q.trim().replace(/^#/, "")}”
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
