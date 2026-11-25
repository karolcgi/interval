import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/store";
import { CatDot, usePlacement, useOutside } from "./bits";

/**
 * The "new block" popover that appears after clicking or dragging on the Plan lane.
 *
 *   Name field (focused)   type a name, Enter or Tab moves to the category list
 *   Category field         a category's shortcut key picks it; or type to filter and press Enter
 *   Alt + shortcut         picks a category straight from the name field
 *   Click a category       creates immediately with whatever name is typed
 *
 * The block's colour always comes from its category, so there is no colour control here.
 * Legacy syntax still works in the category field: "stu, Houdini VEX" -> Studying, named "Houdini VEX".
 */
export function CategoryPicker(props: { x: number; y: number; title: string; onPick: (categoryId: string, title?: string) => void; onCancel: () => void }) {
  const categories = useApp((s) => s.categories);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const { ref, style } = usePlacement(props.x, props.y);
  const nameInput = useRef<HTMLInputElement>(null);
  const catInput = useRef<HTMLInputElement>(null);
  useOutside(ref, props.onCancel);
  // Focus the name field at once, and again on the next frames: on Windows (WebView2) the click that
  // created the block can finish after this mounts and pull focus back to the timeline.
  useLayoutEffect(() => {
    const focus = () => {
      const el = nameInput.current;
      if (el && document.activeElement !== el && document.activeElement !== catInput.current) el.focus();
    };
    focus();
    const r1 = requestAnimationFrame(() => {
      focus();
      r2 = requestAnimationFrame(focus);
    });
    let r2 = 0;
    const t = setTimeout(focus, 120);
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
      clearTimeout(t);
    };
  }, []);

  const [query, legacyTitle] = useMemo(() => {
    const i = q.indexOf(",");
    return i === -1 ? [q.trim(), ""] : [q.slice(0, i).trim(), q.slice(i + 1).trim()];
  }, [q]);

  const active = useMemo(() => categories.filter((c) => !c.archivedAt), [categories]);
  const list = useMemo(() => {
    if (!query) return active;
    const lq = query.toLowerCase();
    return active
      .filter((c) => c.name.toLowerCase().includes(lq))
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(lq)) - Number(!b.name.toLowerCase().startsWith(lq)));
  }, [active, query]);

  useEffect(() => setIdx(0), [query]);

  const pick = (id: string) => props.onPick(id, name.trim() || legacyTitle || undefined);
  const byShortcut = (key: string) => active.find((x) => x.shortcut && x.shortcut.toLowerCase() === key.toLowerCase());

  const onNameKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onCancel();
    } else if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey) || e.key === "ArrowDown") {
      e.preventDefault();
      catInput.current?.focus();
    } else if (e.altKey && e.key.length === 1) {
      const c = byShortcut(e.key);
      if (c) {
        e.preventDefault();
        pick(c.id);
      }
    }
  };

  const onCatKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onCancel();
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      nameInput.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(list.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (idx === 0) nameInput.current?.focus();
      else setIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (list[idx]) pick(list[idx].id);
    } else if (q === "" && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const c = byShortcut(e.key);
      if (c) {
        e.preventDefault();
        pick(c.id);
      }
    }
  };

  return (
    <div className="popover picker popover-modal" ref={ref} style={style} role="dialog" aria-label="New block">
      <div className="picker-head">{props.title}</div>
      <input
        ref={nameInput}
        className="picker-input picker-name-input"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onNameKey}
        aria-label="Block name"
        spellCheck={false}
      />
      <div className="picker-label">
        <span>Category</span>
        <span className="picker-hint">key or type, then Enter</span>
      </div>
      <input
        ref={catInput}
        className="picker-input"
        placeholder="Filter…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onCatKey}
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
