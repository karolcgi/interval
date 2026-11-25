// Small shared UI primitives.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Category } from "../domain/types";
import { Icon, iconExists } from "./icons";

export function CatDot({ color, size = 8, icon }: { color: string; size?: number; icon?: string | null }) {
  // A category, preset or block with an icon shows the Lucide icon, tinted with its colour, in place of the dot
  if (iconExists(icon)) return <span className="cat-icon" style={{ color }} aria-hidden="true"><Icon name={icon} size={Math.max(12, size + 5)} /></span>;
  return <span className="cat-dot" style={{ background: color, width: size, height: size }} />;
}

/** How an item looks: its own colour and icon (presets, and blocks copied from them), else its category's. */
export function lookOf(item: { color?: string | null; icon?: string | null } | null | undefined, cat: Pick<Category, "color" | "icon"> | null | undefined) {
  return { color: item?.color || cat?.color || "#888", icon: item?.icon ?? cat?.icon ?? null };
}

export function catVars(color: string): CSSProperties {
  return { ["--c" as string]: color } as CSSProperties;
}

export function Segmented<T extends string | number>(props: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  return (
    <div className={`segmented ${props.size === "sm" ? "sm" : ""}`} role="radiogroup" aria-label={props.ariaLabel}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === props.value}
          title={o.title}
          className={o.value === props.value ? "on" : ""}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CategorySelect(props: { categories: Category[]; value: string; onChange: (id: string) => void; includeArchivedId?: string }) {
  const options = props.categories.filter((c) => !c.archivedAt || c.id === props.includeArchivedId);
  const current = props.categories.find((c) => c.id === props.value);
  return (
    <div className="cat-select" style={catVars(current?.color ?? "#888")}>
      <CatDot color={current?.color ?? "#888"} icon={current?.icon} />
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)} aria-label="Category">
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.parentId ? "  ↳ " : ""}
            {c.name}
            {c.archivedAt ? " (archived)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Keep a popover inside the viewport. */
export function usePlacement(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8));
    setPos({ left, top });
  }, [x, y]);
  return { ref, style: { left: pos.left, top: pos.top } as CSSProperties };
}

export function useOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    const h = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    const t = setTimeout(() => window.addEventListener("pointerdown", h), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", h);
    };
  }, [ref, onOutside]);
}

export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
