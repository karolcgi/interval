// Presets tab: a small personal asset library of reusable block configurations.
// No tasks, deadlines or statuses: a preset is a configuration, never a scheduled or finished thing.
import { useEffect, useMemo, useRef, useState } from "react";
import { CopyPlus, GripVertical, LayoutGrid, List, Plus, Search, Star, Trash2, X } from "lucide-react";
import { store, useApp } from "../state/store";
import * as A from "../state/actions";
import * as L from "../state/library";
import type { ActivityPreset, Id } from "../domain/types";
import { CatDot, CategorySelect, catVars, Segmented } from "./bits";
import { TagInput } from "./TagInput";
import { filterPresets, fmtMinutes, PresetMenu, useReorderTarget } from "./PresetLibrary";
import { beginPresetDrag } from "./presetDrag";

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

export function PresetsView() {
  const presets = useApp((s) => s.presets);
  const categories = useApp((s) => s.categories);
  const tags = useApp((s) => s.tags);
  const editing = useApp((s) => s.presetEditing);
  const viewMode = useApp((s) => s.settings.presetView);
  const sort = useApp((s) => s.settings.presetSort);
  const dragging = useApp((s) => s.presetDrag?.presetId ?? null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Id | "">("");
  const [favOnly, setFavOnly] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; id: Id } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const shown = useMemo(() => {
    const list = filterPresets(presets, categories, q, cat, favOnly);
    const byName = (a: ActivityPreset, b: ActivityPreset) => a.name.localeCompare(b.name);
    if (sort === "name") return list.slice().sort(byName);
    if (sort === "duration") return list.slice().sort((a, b) => b.durationMinutes - a.durationMinutes || byName(a, b));
    if (sort === "category")
      return list.slice().sort((a, b) => (catById.get(a.categoryId)?.sortOrder ?? 0) - (catById.get(b.categoryId)?.sortOrder ?? 0) || byName(a, b));
    return list; // custom order (sortOrder)
  }, [presets, categories, q, cat, favOnly, sort, catById]);
  const custom = sort === "custom";
  const insertAt = useReorderTarget(listRef, shown.map((p) => p.id), custom);
  const usedCats = categories.filter((c) => presets.some((p) => p.categoryId === c.id));

  return (
    <section className="presets-view">
      <div className="page presets-page">
        <header className="page-head">
          <div>
            <div className="eyebrow">Library</div>
            <h1 className="page-title">Presets</h1>
            <p className="page-sub muted small">Reusable blocks. Drag them from the sidebar onto Today, the Calendar or the weekly Template.</p>
          </div>
          <button className="btn btn-outline sm" onClick={() => store.set({ presetEditing: "new" })}>
            <Plus size={13} /> New preset
          </button>
        </header>

        <div className="presets-toolbar">
          <label className="preset-search wide">
            <Search size={13} aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search presets" onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <div className="chip-row" role="group" aria-label="Filter by category">
            <button className={`chip ${!cat && !favOnly ? "on" : ""}`} onClick={() => (setCat(""), setFavOnly(false))}>
              All
            </button>
            <button className={`chip ${favOnly ? "on" : ""}`} onClick={() => setFavOnly((v) => !v)} aria-pressed={favOnly}>
              <Star size={11} fill={favOnly ? "currentColor" : "none"} /> Favourites
            </button>
            {usedCats.map((c) => (
              <button key={c.id} className={`chip cat-chip ${cat === c.id ? "on" : ""}`} style={catVars(c.color)} onClick={() => setCat(cat === c.id ? "" : c.id)} aria-pressed={cat === c.id}>
                <CatDot color={c.color} emoji={c.emoji} /> {c.name}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <select className="select sm" value={sort} onChange={(e) => void A.updateSettings({ presetSort: e.target.value as typeof sort })} aria-label="Sort presets">
            <option value="custom">Custom order</option>
            <option value="name">Name</option>
            <option value="duration">Duration</option>
            <option value="category">Category</option>
          </select>
          <Segmented
            size="sm"
            value={viewMode}
            onChange={(v) => void A.updateSettings({ presetView: v })}
            ariaLabel="Layout"
            options={[
              { value: "list", label: <List size={13} />, title: "List" },
              { value: "grid", label: <LayoutGrid size={13} />, title: "Grid" },
            ]}
          />
        </div>

        {presets.length === 0 ? (
          <div className="presets-empty">
            <p className="muted">No presets yet. A preset is a block you use often, like “Houdini studying · 90 min”.</p>
            <button className="btn btn-outline sm" onClick={() => store.set({ presetEditing: "new" })}>
              <Plus size={13} /> Create your first preset
            </button>
          </div>
        ) : (
          <div ref={listRef} className={`plib-${viewMode}`} role="list" aria-label="Presets">
            {shown.map((p, i) => {
              const c = catById.get(p.categoryId);
              const tagNames = p.tagIds.map((t) => tagById.get(t)?.name).filter(Boolean);
              return (
                <div
                  key={p.id}
                  role="listitem"
                  data-preset={p.id}
                  className={`preset-card ${editing === p.id ? "on" : ""} ${dragging === p.id ? "dragging" : ""} ${insertAt === i ? "insert-before" : ""} ${insertAt === shown.length && i === shown.length - 1 ? "insert-after" : ""}`}
                  style={catVars(c?.color ?? "#888")}
                  onPointerDown={(e) => (custom ? beginPresetDrag(e, p.id, () => store.set({ presetEditing: p.id })) : undefined)}
                  onClick={() => !custom && store.set({ presetEditing: p.id })}
                  onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, id: p.id }))}
                  aria-label={`Preset ${p.name}`}
                >
                  {custom && <GripVertical size={13} className="preset-grip" aria-hidden />}
                  <CatDot color={c?.color ?? "#888"} emoji={c?.emoji} size={9} />
                  <div className="preset-card-main">
                    <div className="preset-card-name">{p.name}</div>
                    <div className="preset-card-meta muted small">
                      {c?.name ?? "No category"}
                      {tagNames.length > 0 && ` · #${tagNames.join(" #")}`}
                    </div>
                  </div>
                  <button
                    className={`icon-btn sm fav-btn ${p.favorite ? "on fav" : ""}`}
                    onClick={(e) => (e.stopPropagation(), void L.toggleFavorite(p.id).catch(A.reportError))}
                    aria-pressed={p.favorite}
                    aria-label={p.favorite ? "Remove from favourites" : "Add to favourites"}
                    title={p.favorite ? "Favourite" : "Add to favourites"}
                  >
                    <Star size={12} fill={p.favorite ? "currentColor" : "none"} />
                  </button>
                  <span className="preset-dur">{fmtMinutes(p.durationMinutes)}</span>
                </div>
              );
            })}
            {shown.length === 0 && <p className="muted small">No presets match.</p>}
          </div>
        )}
        {menu && <PresetMenu {...menu} onClose={() => setMenu(null)} />}
      </div>
      {editing && <PresetEditor key={editing} id={editing} />}
    </section>
  );
}

function PresetEditor({ id }: { id: Id | "new" }) {
  const existing = useApp((s) => (id === "new" ? undefined : s.presets.find((p) => p.id === id)));
  const categories = useApp((s) => s.categories);
  const focusPresets = useApp((s) => s.settings.focusPresets);
  const [draft, setDraft] = useState<ActivityPreset>(() => existing ?? L.newPreset());
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (id === "new") nameRef.current?.focus();
  }, [id]);
  if (id !== "new" && !existing) return null;
  const set = (patch: Partial<ActivityPreset>) => (setDraft((d) => ({ ...d, ...patch })), setError(null));
  const close = () => store.set({ presetEditing: null });
  const save = async () => {
    try {
      const saved = await L.savePreset(draft);
      store.set({ presetEditing: saved.id });
      A.toast(id === "new" ? `Created preset “${saved.name}”` : "Preset saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const dirty = !existing || JSON.stringify(existing) !== JSON.stringify(draft);
  const cat = categories.find((c) => c.id === draft.categoryId);
  return (
    <aside className="panel plib-editor" aria-label={id === "new" ? "New preset" : "Edit preset"} style={catVars(cat?.color ?? "#888")}>
      <div className="panel-inner">
        <div className="inspector-head">
          <span className="eyebrow">{id === "new" ? "New preset" : "Edit preset"}</span>
          <button className="icon-btn sm" onClick={close} aria-label="Close editor">
            <X size={14} />
          </button>
        </div>
        <form
          className="preset-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <label className="pf-row">
            <span className="pf-label">Name</span>
            <input ref={nameRef} className="field" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Houdini studying" maxLength={120} aria-label="Preset name" />
          </label>
          <div className="pf-row">
            <span className="pf-label">Category</span>
            <CategorySelect categories={categories} value={draft.categoryId} onChange={(categoryId) => set({ categoryId })} includeArchivedId={existing?.categoryId} />
          </div>
          <div className="pf-row">
            <span className="pf-label">Duration</span>
            <div className="pf-duration">
              <input
                className="field num"
                type="number"
                min={5}
                max={1440}
                step={5}
                value={draft.durationMinutes}
                onChange={(e) => set({ durationMinutes: Number(e.target.value) })}
                aria-label="Duration in minutes"
              />
              <span className="muted small">min</span>
              <div className="chip-row">
                {DURATIONS.map((m) => (
                  <button type="button" key={m} className={`chip sm ${draft.durationMinutes === m ? "on" : ""}`} onClick={() => set({ durationMinutes: m })}>
                    {fmtMinutes(m)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="pf-row">
            <span className="pf-label">Tags</span>
            <TagInput value={draft.tagIds} onChange={(tagIds) => set({ tagIds })} />
          </div>
          <label className="pf-row">
            <span className="pf-label">Notes</span>
            <textarea className="field" rows={3} value={draft.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} placeholder="Optional. Copied into each block." aria-label="Notes" />
          </label>
          <label className="pf-row">
            <span className="pf-label">Focus timer</span>
            <select className="select" value={draft.focusPresetId ?? ""} onChange={(e) => set({ focusPresetId: e.target.value || null })} aria-label="Focus timer preset">
              <option value="">None</option>
              {focusPresets.map((f) => (
                <option key={f.id} value={f.id}>
                  Pomodoro {f.focus} / {f.brk}
                </option>
              ))}
            </select>
            <span className="pf-hint muted small">Offered when you start a session from a block made with this preset.</span>
          </label>
          <label className="pf-check">
            <input type="checkbox" checked={draft.favorite} onChange={(e) => set({ favorite: e.target.checked })} /> Favourite
          </label>
          {error && <p className="notice small" role="alert">{error}</p>}
          <div className="pf-actions">
            <button type="submit" className="btn btn-cat sm" disabled={!dirty}>
              {id === "new" ? "Create preset" : "Save"}
            </button>
            {existing && (
              <>
                <button type="button" className="icon-btn" onClick={() => void L.duplicatePreset(existing.id).catch(A.reportError)} title="Duplicate" aria-label="Duplicate preset">
                  <CopyPlus size={14} />
                </button>
                <button type="button" className="icon-btn danger" onClick={() => void L.deletePreset(existing.id).catch(A.reportError)} title="Delete" aria-label="Delete preset">
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
          <p className="muted small pf-foot">Editing a preset never changes blocks already made from it.</p>
        </form>
      </div>
    </aside>
  );
}
