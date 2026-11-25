import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/store";
import { CatDot, usePlacement, useOutside } from "./bits";

/**
 * Appears after drag-creating on the timeline. Press a category's shortcut key, or type to
 * filter and press Enter. Anything typed after a comma becomes the block title:
 * "stu, Houdini VEX" -> Studying, titled "Houdini VEX".
 */
export function CategoryPicker(props: { x: number; y: number; title: string; onPick: (categoryId: string, title?: string) => void; onCancel: () => void }) {
  const categories = useApp((s) => s.categories);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const { ref, style } = usePlacement(props.x, props.y);
  const input = useRef<HTMLInputElement>(null);
  useOutside(ref, props.onCancel);
  useEffect(() => input.current?.focus(), []);

  const [query, title] = useMemo(() => {
    const i = q.indexOf(",");
    return i === -1 ? [q.trim(), ""] : [q.slice(0, i).trim(), q.slice(i + 1).trim()];
  }, [q]);

  const list = useMemo(() => {
    const active = categories.filter((c) => !c.archivedAt);
    if (!query) return active;
    const lq = query.toLowerCase();
    return active
      .filter((c) => c.name.toLowerCase().includes(lq))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(lq)) - Number(!b.name.toLowerCase().startsWith(lq)));
  }, [categories, query]);

  useEffect(() => setIdx(0), [query]);

  const pick = (id: string) => props.onPick(id, title || undefined);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onCancel();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(list.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (list[idx]) pick(list[idx].id);
    } else if (q === "" && e.key.length === 1) {
      const c = categories.find((x) => !x.archivedAt && x.shortcut && x.shortcut.toLowerCase() === e.key.toLowerCase());
      if (c) {
        e.preventDefault();
        pick(c.id);
      }
    }
  };

  return (
    <div className="popover picker popover-modal" ref={ref} style={style} role="dialog" aria-label="Choose category">
      <div className="picker-head">{props.title}</div>
      <input
        ref={input}
        className="picker-input"
        placeholder="Category…  (add “, title”)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        aria-label="Filter categories"
      />
      <ul className="picker-list" role="listbox">
        {list.map((c, i) => (
          <li
            key={c.id}
            role="option"
            aria-selected={i === idx}
            className={`picker-item ${i === idx ? "on" : ""}`}
            onMouseEnter={() => setIdx(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(c.id);
            }}
          >
            <CatDot color={c.color} />
            <span className="picker-name">
              {c.parentId ? "↳ " : ""}
              {c.name}
            </span>
            {c.shortcut && <kbd>{c.shortcut}</kbd>}
          </li>
        ))}
        {list.length === 0 && <li className="picker-empty">No matching category</li>}
      </ul>
    </div>
  );
}
