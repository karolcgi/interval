import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useApp } from "../state/store";
import * as A from "../state/actions";
import type { Category, Tag } from "../domain/types";
import { CatDot } from "./bits";

export const PALETTE = ["#8298d7", "#8bbca0", "#ba9ad0", "#77b3bf", "#d49a72", "#c6ae76", "#9a9ba2", "#6c6d73", "#d98c9a", "#a3b86c", "#7fa7e0", "#c79bb8"];

export function CategoriesView() {
  const categories = useApp((s) => s.categories);
  const tags = useApp((s) => s.tags);
  const db = useApp((s) => s.db);
  const [usage, setUsage] = useState<Map<string, number>>(new Map());
  const [newName, setNewName] = useState("");
  const active = categories.filter((c) => !c.archivedAt);
  const archived = categories.filter((c) => c.archivedAt);

  useEffect(() => {
    if (!db) return;
    void db
      .select<{ tag_id: string; ms: number }>(
        "SELECT st.tag_id, SUM(COALESCE(s.end_at, s.start_at) - s.start_at) AS ms FROM session_tags st JOIN sessions s ON s.id = st.session_id GROUP BY st.tag_id",
      )
      .then((rows) => setUsage(new Map(rows.map((r) => [r.tag_id, Number(r.ms)]))));
  }, [db, tags]);

  // Show parents followed by their children
  const ordered: Category[] = [];
  for (const c of active.filter((x) => !x.parentId || !active.some((p) => p.id === x.parentId))) {
    ordered.push(c);
    ordered.push(...active.filter((x) => x.parentId === c.id));
  }

  const move = (id: string, dir: -1 | 1) => {
    const ids = active.map((c) => c.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void A.reorderCategories(ids);
  };

  const add = async () => {
    if (!newName.trim()) return;
    const used = new Set(categories.map((c) => c.color));
    await A.createCategory({ name: newName.trim(), color: PALETTE.find((p) => !used.has(p)) ?? PALETTE[0] });
    setNewName("");
  };

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Classify time, not tasks</div>
          <h1 className="page-title">Categories & tags</h1>
        </div>
      </header>
      <p className="lede">A category is the purpose of the time (Studying). Tags are its subject (Houdini, VEX). Archiving keeps all history intact.</p>

      <div className="settings-block">
        <div className="table-head cat-grid">
          <span />
          <span>Name</span>
          <span>Parent</span>
          <span title="Single key that assigns the category when picking or with a block selected">Key</span>
          <span title="Break time is reported separately from recorded time">Break</span>
          <span />
        </div>
        {ordered.map((c) => (
          <CategoryRow key={c.id} cat={c} all={active} onMove={move} />
        ))}
        <div className="cat-grid add-row">
          <Plus size={14} className="muted" />
          <input className="field" placeholder="New category" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void add()} />
          <button className="btn btn-outline sm" onClick={() => void add()} disabled={!newName.trim()}>
            Add
          </button>
        </div>
        {archived.length > 0 && (
          <>
            <div className="eyebrow pad-top">Archived</div>
            {archived.map((c) => (
              <div key={c.id} className="cat-grid archived">
                <CatDot color={c.color} />
                <span>{c.name}</span>
                <span />
                <span />
                <span />
                <button className="icon-btn sm" title="Restore" onClick={() => void A.saveCategory({ ...c, archivedAt: null })}>
                  <ArchiveRestore size={14} />
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      <h2 className="section-title">Tags</h2>
      <div className="settings-block">
        {tags.length === 0 && <p className="muted small">No tags yet. Add them to blocks from the details panel.</p>}
        <div className="tag-grid">
          {tags.map((t) => (
            <TagRow key={t.id} tag={t} ms={usage.get(t.id) ?? 0} />
          ))}
        </div>
        <NewTag />
      </div>
    </section>
  );
}

function CategoryRow({ cat, all, onMove }: { cat: Category; all: Category[]; onMove: (id: string, dir: -1 | 1) => void }) {
  const [name, setName] = useState(cat.name);
  const [showColors, setShowColors] = useState(false);
  useEffect(() => setName(cat.name), [cat.name]);
  const save = (patch: Partial<Category>) => void A.saveCategory({ ...cat, ...patch }).catch(A.reportError);
  return (
    <div className={`cat-grid ${cat.parentId ? "child" : ""}`} data-name={cat.name}>
      <div className="color-cell">
        <button className="swatch" style={{ background: cat.color }} onClick={() => setShowColors((v) => !v)} aria-label="Change colour" />
        {showColors && (
          <div className="popover swatches" onMouseLeave={() => setShowColors(false)}>
            {PALETTE.map((p) => (
              <button key={p} className="swatch" style={{ background: p }} onClick={() => (save({ color: p }), setShowColors(false))} aria-label={p} />
            ))}
            <label className="swatch custom" title="Custom colour">
              <input type="color" value={cat.color} onChange={(e) => save({ color: e.target.value })} />
            </label>
          </div>
        )}
      </div>
      <input className="field bare" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== cat.name && save({ name: name.trim() })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} aria-label="Category name" />
      <select className="select sm" value={cat.parentId ?? ""} onChange={(e) => save({ parentId: e.target.value || null })} aria-label="Parent category">
        <option value="">—</option>
        {all
          .filter((p) => p.id !== cat.id && !p.parentId)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
      <input
        className="field bare key-input"
        value={cat.shortcut ?? ""}
        maxLength={1}
        onChange={(e) => save({ shortcut: e.target.value.trim().slice(0, 1) || null })}
        aria-label="Shortcut key"
      />
      <input type="checkbox" checked={cat.isBreak} onChange={(e) => save({ isBreak: e.target.checked })} aria-label="Counts as break" />
      <div className="row-tools">
        <button className="icon-btn sm" onClick={() => onMove(cat.id, -1)} aria-label="Move up">
          <ArrowUp size={13} />
        </button>
        <button className="icon-btn sm" onClick={() => onMove(cat.id, 1)} aria-label="Move down">
          <ArrowDown size={13} />
        </button>
        <button
          className="icon-btn sm"
          title="Archive (or delete if never used)"
          onClick={() => void A.deleteOrArchiveCategory(cat.id).then((r) => A.toast(r === "archived" ? `“${cat.name}” archived. History kept.` : `“${cat.name}” deleted`))}
          aria-label="Archive"
        >
          <Archive size={13} />
        </button>
      </div>
    </div>
  );
}

function TagRow({ tag, ms }: { tag: Tag; ms: number }) {
  const [name, setName] = useState(tag.name);
  useEffect(() => setName(tag.name), [tag.name]);
  return (
    <div className="tag-row">
      <span className="muted">#</span>
      <input
        className="field bare"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== tag.name && void A.saveTag({ ...tag, name: name.trim() }).catch((e) => (A.reportError(e), setName(tag.name)))}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        aria-label="Tag name"
      />
      <span className="muted small mono">{(ms / 3_600_000).toFixed(1)}h</span>
      <button className="icon-btn sm" title="Delete tag (removes it from all entries; time is kept)" onClick={() => void A.deleteTag(tag.id)} aria-label={`Delete ${tag.name}`}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function NewTag() {
  const [v, setV] = useState("");
  return (
    <div className="tag-row add-row">
      <Plus size={14} className="muted" />
      <input className="field" value={v} placeholder="New tag" onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && v.trim() && void A.ensureTag(v).then(() => setV(""))} />
    </div>
  );
}
