// Compact icon picker (v0.8): the curated Lucide set with keyword search, tinted with the item's colour.
// Replaced the v0.5 emoji picker. Offline; icons are bundled.
import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { ICON_GROUPS, Icon, iconExists, searchIcons } from "./icons";

export function IconPicker({
  onPick,
  onClose,
  canClear,
  className,
  color,
  current,
}: {
  onPick: (icon: string | null) => void;
  onClose: () => void;
  canClear?: boolean;
  className?: string;
  color?: string;
  current?: string | null;
}) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    // Defer so the click that opened the picker doesn't immediately close it
    const t = setTimeout(() => document.addEventListener("pointerdown", down), 0);
    document.addEventListener("keydown", key, true);
    return () => (clearTimeout(t), document.removeEventListener("pointerdown", down), document.removeEventListener("keydown", key, true));
  }, [onClose]);

  const groups = useMemo(() => (q.trim() ? [{ name: "Results", items: searchIcons(q) }] : ICON_GROUPS), [q]);
  const pick = (name: string | null) => (onPick(name), onClose());
  return (
    <div
      ref={ref}
      className={`popover icon-picker ${className ?? ""}`}
      role="dialog"
      aria-label="Pick an icon"
      style={color ? ({ ["--ic" as string]: color } as React.CSSProperties) : undefined}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="icon-search">
        <input
          ref={input}
          className="field sm"
          placeholder="Search: coffee, dog, render…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const first = groups[0]?.items[0];
              if (first) pick(first[0]);
            }
          }}
          aria-label="Search icons"
        />
        {canClear && (
          <button className="icon-btn sm" onClick={() => pick(null)} title="Remove icon" aria-label="Remove icon">
            <X size={13} />
          </button>
        )}
      </div>
      <div className="icon-scroll">
        {groups.map((g) => (
          <div key={g.name}>
            <div className="icon-group">{g.name}</div>
            <div className="icon-grid">
              {g.items.map(([name, I, k]) => (
                <button key={name} className={`icon-cell ${current === name ? "on" : ""}`} onClick={() => pick(name)} title={name.replace(/-/g, " ")} aria-label={`${name.replace(/-/g, " ")} icon`} data-icon={name} data-k={k}>
                  <I size={16} strokeWidth={1.9} aria-hidden />
                </button>
              ))}
            </div>
          </div>
        ))}
        {groups[0]?.items.length === 0 && <div className="muted small icon-empty">No icon for “{q}”. Try a broader word.</div>}
      </div>
    </div>
  );
}

/** A square button showing the current icon (or a faint "add" glyph) that opens the picker below it. */
export function IconButton({ icon, color, label, onPick, size = "md", className }: { icon: string | null | undefined; color?: string; label: string; onPick: (icon: string | null) => void; size?: "sm" | "md"; className?: string }) {
  const [open, setOpen] = useState(false);
  const has = iconExists(icon);
  return (
    <span className={`icon-trigger-wrap ${className ?? ""}`}>
      <button type="button" className={`icon-trigger ${size} ${has ? "has" : ""}`} style={has && color ? { color } : undefined} onClick={() => setOpen((v) => !v)} title={has ? "Change icon" : "Add an icon"} aria-label={label} aria-expanded={open}>
        {has ? <Icon name={icon} size={size === "sm" ? 14 : 16} /> : <ImagePlus size={size === "sm" ? 13 : 15} strokeWidth={1.7} aria-hidden />}
      </button>
      {open && <IconPicker canClear={has} color={color} current={icon} onPick={onPick} onClose={() => setOpen(false)} />}
    </span>
  );
}

/** Own colour, or the category's (null). Used by presets, blocks and template blocks. */
export function ColorField({ value, fallback, onChange, palette, noAuto }: { value: string | null | undefined; fallback: string; onChange: (color: string | null) => void; palette: string[]; noAuto?: boolean }) {
  return (
    <div className="color-field" role="radiogroup" aria-label="Colour">
      {!noAuto && <button type="button" role="radio" aria-checked={!value} className={`color-auto ${!value ? "on" : ""}`} onClick={() => onChange(null)} title="Use the category colour">
        <span className="swatch sm" style={{ background: fallback }} /> Category
      </button>}
      {palette.slice(0, 12).map((c) => (
        <button type="button" key={c} role="radio" aria-checked={value === c} className={`swatch sm ${value === c ? "on" : ""}`} style={{ background: c }} onClick={() => onChange(c)} aria-label={`Colour ${c}`} />
      ))}
      <label className={`swatch sm custom ${value && !palette.slice(0, 12).includes(value) ? "on" : ""}`} title="Custom colour" style={value && !palette.slice(0, 12).includes(value) ? { background: value } : undefined}>
        <input type="color" value={value || fallback} onChange={(e) => onChange(e.target.value)} aria-label="Custom colour" />
      </label>
    </div>
  );
}
