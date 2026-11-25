// Sidebar preset library: compact draggable rows (an asset library, not a task list).
// Drag a row onto Today, Calendar or Template to place it; drag within the list to reorder;
// double-click or right-click to edit, duplicate, favourite or delete.
import { useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, Plus, Search, Star, Pencil, CopyPlus, Trash2, X } from "lucide-react";
import { store, useApp } from "../state/store";
import * as A from "../state/actions";
import * as L from "../state/library";
import type { ActivityPreset, Category, Id } from "../domain/types";
import { fmtDuration } from "../domain/format";
import { CatDot, catVars, usePlacement, useOutside } from "./bits";
import { MenuItem } from "./ContextMenus";
import { SideSection } from "./SideSection";
import { beginPresetDrag, registerDropTarget } from "./presetDrag";

export const fmtMinutes = (m: number) => fmtDuration(m * 60_000, { compact: true });

export function openPresetEditor(id: Id | "new") {
  store.set({ view: "presets", presetEditing: id });
}

export function filterPresets(presets: ActivityPreset[], categories: Category[], q: string, cat: Id | "", favOnly: boolean) {
  const term = q.trim().toLowerCase();
  const catName = new Map(categories.map((c) => [c.id, c.name.toLowerCase()]));
  return presets.filter(
    (p) =>
      (!cat || p.categoryId === cat) &&
      (!favOnly || p.favorite) &&
      (!term || p.name.toLowerCase().includes(term) || (catName.get(p.categoryId) ?? "").includes(term)),
  );
}

/** Insertion index for a reorder drop at clientY over a list of rows. */
function insertIndex(list: HTMLElement, y: number): number {
  const rows = [...list.querySelectorAll<HTMLElement>("[data-preset]")];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) return i;
  }
  return rows.length;
}

/** Makes a list of [data-preset] rows a reorder drop target. Returns the insertion index while a preset is dragged over it. */
export function useReorderTarget(listRef: React.RefObject<HTMLElement | null>, ids: Id[], enabled = true): number | null {
  const drag = useApp((s) => s.presetDrag);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  useEffect(() => {
    if (!enabled) return;
    return registerDropTarget({
      hit: (x, y) => {
        const el = listRef.current;
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top - 4 && y <= r.bottom + 4;
      },
      drop: (_x, y, presetId) => {
        const el = listRef.current;
        if (!el) return;
        const i = insertIndex(el, y);
        const list = idsRef.current;
        const before = list[i] ?? null;
        if (before === presetId || (i > 0 && list[i - 1] === presetId)) return; // dropped where it was
        void L.movePreset(presetId, before).catch(A.reportError);
      },
    });
  }, [enabled, listRef]);
  if (!enabled || !drag || !listRef.current) return null;
  const r = listRef.current.getBoundingClientRect();
  if (drag.x < r.left || drag.x > r.right || drag.y < r.top - 4 || drag.y > r.bottom + 4) return null;
  return insertIndex(listRef.current, drag.y);
}

export function PresetLibrary() {
  const presets = useApp((s) => s.presets);
  const categories = useApp((s) => s.categories);
  const dragging = useApp((s) => s.presetDrag?.presetId ?? null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Id | "">("");
  const [favOnly, setFavOnly] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: Id } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const shown = useMemo(() => filterPresets(presets, categories, q, cat, favOnly), [presets, categories, q, cat, favOnly]);
  const insertAt = useReorderTarget(listRef, shown.map((p) => p.id));
  const usedCats = categories.filter((c) => presets.some((p) => p.categoryId === c.id));

  return (
    <SideSection
      id="presets"
      title="Presets"
      className="preset-lib"
      actions={
        <button className="icon-btn sm" onClick={() => openPresetEditor("new")} title="New preset" aria-label="New preset">
          <Plus size={13} />
        </button>
      }
    >
      {presets.length > 0 && (
        <div className="preset-filter">
          <label className="preset-search">
            <Search size={12} aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search presets" aria-label="Search presets" onKeyDown={(e) => (e.stopPropagation(), e.key === "Escape" && setQ(""))} />
            {q && (
              <button className="icon-btn sm" onClick={() => setQ("")} aria-label="Clear search">
                <X size={11} />
              </button>
            )}
          </label>
          <button className={`icon-btn sm ${favOnly ? "on fav" : ""}`} onClick={() => setFavOnly((v) => !v)} aria-pressed={favOnly} title="Favourites only" aria-label="Favourites only">
            <Star size={12} fill={favOnly ? "currentColor" : "none"} />
          </button>
          {usedCats.length > 1 && (
            <select className="preset-cat-filter" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filter by category" title="Filter by category">
              <option value="">All</option>
              {usedCats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {presets.length === 0 ? (
        <p className="preset-empty muted small">
          Reusable blocks you drag onto the calendar. Press <b>+</b>, or right-click a block › Save as preset.
        </p>
      ) : (
        <ul className="plib-list" ref={listRef} aria-label="Activity presets">
          {shown.map((p, i) => {
            const c = catById.get(p.categoryId);
            return (
              <li
                key={p.id}
                data-preset={p.id}
                className={`plib-row ${dragging === p.id ? "dragging" : ""} ${insertAt === i ? "insert-before" : ""} ${insertAt === shown.length && i === shown.length - 1 ? "insert-after" : ""}`}
                style={catVars(c?.color ?? "#888")}
                onPointerDown={(e) => beginPresetDrag(e, p.id)}
                onDoubleClick={() => openPresetEditor(p.id)}
                onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, id: p.id }))}
                title={`${p.name} · ${fmtMinutes(p.durationMinutes)}${c ? ` · ${c.name}` : ""}\nDrag onto the calendar or template`}
                aria-label={`Preset ${p.name}, ${fmtMinutes(p.durationMinutes)}`}
              >
                <GripVertical size={12} className="preset-grip" aria-hidden />
                <CatDot color={c?.color ?? "#888"} emoji={c?.emoji} />
                <span className="preset-name">{p.name}</span>
                {p.favorite && <Star size={10} className="preset-star" fill="currentColor" aria-label="Favourite" />}
                <span className="preset-dur">{fmtMinutes(p.durationMinutes)}</span>
              </li>
            );
          })}
          {shown.length === 0 && <li className="preset-empty muted small">No presets match.</li>}
        </ul>
      )}
      {menu && <PresetMenu {...menu} onClose={() => setMenu(null)} />}
    </SideSection>
  );
}

export function PresetMenu(p: { x: number; y: number; id: Id; onClose: () => void }) {
  const { ref, style } = usePlacement(p.x, p.y);
  useOutside(ref, p.onClose);
  const preset = useApp((s) => s.presets.find((x) => x.id === p.id));
  if (!preset) return null;
  const run = (fn: () => unknown) => () => {
    p.onClose();
    Promise.resolve(fn()).catch(A.reportError);
  };
  return (
    <div className="popover menu popover-modal" ref={ref} style={style} role="menu" aria-label="Preset" onContextMenu={(e) => e.preventDefault()}>
      <MenuItem icon={<Pencil size={13} />} label="Edit" onClick={run(() => openPresetEditor(preset.id))} />
      <MenuItem icon={<CopyPlus size={13} />} label="Duplicate" onClick={run(() => L.duplicatePreset(preset.id))} />
      <MenuItem icon={<Star size={13} />} label={preset.favorite ? "Remove from favourites" : "Add to favourites"} onClick={run(() => L.toggleFavorite(preset.id))} />
      <div className="menu-sep" />
      <MenuItem icon={<Trash2 size={13} />} label="Delete preset" danger onClick={run(() => L.deletePreset(preset.id))} />
      <div className="menu-foot">Blocks made from it are kept</div>
    </div>
  );
}

/** The chip that follows the pointer while a preset is dragged. */
export function PresetDragChip() {
  const drag = useApp((s) => s.presetDrag);
  const preset = useApp((s) => (drag ? s.presets.find((p) => p.id === drag.presetId) : undefined));
  const cat = useApp((s) => (preset ? s.categories.find((c) => c.id === preset.categoryId) : undefined));
  if (!drag || !preset) return null;
  return (
    <div className="preset-drag-chip" style={{ left: drag.x + 12, top: drag.y + 10, ...catVars(cat?.color ?? "#888") }} aria-hidden>
      <CatDot color={cat?.color ?? "#888"} emoji={cat?.emoji} />
      <span>{preset.name}</span>
      <span className="preset-dur">{fmtMinutes(preset.durationMinutes)}</span>
    </div>
  );
}
