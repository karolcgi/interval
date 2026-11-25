import { useState } from "react";
import { Ban, BookmarkPlus, Check, Pencil, Repeat, ChevronRight, Combine, Copy, CopyPlus, Play, RotateCcw, Scissors, Trash2, CalendarPlus, EyeOff, LayoutTemplate } from "lucide-react";
import * as L from "../state/library";
import { WEEKDAY_NAMES } from "../domain/weekTemplate";
import { store, useApp } from "../state/store";
import * as A from "../state/actions";
import * as P from "../state/planning";
import type { Id } from "../domain/types";
import { CatDot, usePlacement, useOutside } from "./bits";
import { findMergeCandidate, splitInterval } from "../domain/calendar";

interface Props {
  x: number;
  y: number;
  kind: "block" | "session";
  id: Id;
  at: number; // timestamp under the cursor (for "split here")
  onClose: () => void;
}

export function ItemContextMenu(p: Props) {
  const { ref, style } = usePlacement(p.x, p.y);
  useOutside(ref, p.onClose);
  const categories = useApp((s) => s.categories);
  const blocks = useApp((s) => s.blocks);
  const sessions = useApp((s) => s.sessions);
  const [sub, setSub] = useState(false);
  const run = (fn: () => unknown) => () => {
    p.onClose();
    Promise.resolve(fn()).catch(A.reportError);
  };

  const block = p.kind === "block" ? blocks.find((b) => b.id === p.id) : null;
  const session = p.kind === "session" ? sessions.find((s) => s.id === p.id) : null;
  const item = block ?? session;
  if (!item) return null;

  const setCategory = (categoryId: Id) =>
    p.kind === "block" ? A.updateBlock(p.id, { categoryId }, "Change category") : A.updateSession(p.id, { categoryId }, "Change category");

  const canSplitHere = block && splitInterval({ start: block.startAt, end: block.endAt }, p.at) !== null;
  const mergeWith = block ? findMergeCandidate(block, blocks) : null;

  return (
    <div className="popover menu popover-modal" ref={ref} style={style} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {block && (
        <>
          {block.status !== "in_progress" && <MenuItem icon={<Play size={13} />} label="Start session" hint="S" onClick={run(() => L.startFromBlock(block.id))} />}
          {block.status !== "completed" && <MenuItem icon={<Check size={13} />} label="Confirm as done" hint="C" onClick={run(() => A.completeBlockManually(block.id))} />}
          {block.status !== "skipped" ? (
            <MenuItem icon={<Ban size={13} />} label="Skip" onClick={run(() => A.setBlockStatus(block.id, "skipped"))} />
          ) : (
            <MenuItem icon={<RotateCcw size={13} />} label="Restore as planned" onClick={run(() => A.setBlockStatus(block.id, "planned"))} />
          )}
          <div className="menu-sep" />
        </>
      )}
      <MenuItem icon={<Pencil size={13} />} label="Rename" hint="F2" onClick={run(() => A.startRename({ kind: p.kind, id: p.id }))} />
      <div className="menu-item has-sub" onMouseEnter={() => setSub(true)} onMouseLeave={() => setSub(false)} role="menuitem" aria-haspopup>
        <span className="menu-icon">
          <CatDot color={categories.find((c) => c.id === item.categoryId)?.color ?? "#888"} />
        </span>
        <span>Category</span>
        <ChevronRight size={13} className="menu-chev" />
        {sub && (
          <div className="popover menu submenu">
            {categories
              .filter((c) => !c.archivedAt)
              .map((c) => (
                <MenuItem key={c.id} icon={<CatDot color={c.color} emoji={c.emoji} />} label={c.name} hint={c.shortcut ?? undefined} checked={c.id === item.categoryId} onClick={run(() => setCategory(c.id))} />
              ))}
          </div>
        )}
      </div>
      {block && (
        <>
          <div className="menu-sep" />
          {block.recurrenceId && (
            <>
              <MenuItem icon={<Repeat size={13} />} label="Stop repeating after this" onClick={run(() => P.stopRepeating(block.id))} />
              <MenuItem icon={<Trash2 size={13} />} label="Delete this and following" onClick={run(() => P.deleteFollowing(block.id))} />
              <div className="menu-sep" />
            </>
          )}
          <MenuItem icon={<CopyPlus size={13} />} label="Duplicate" hint="Ctrl D" onClick={run(() => A.duplicateBlock(block.id))} />
          <MenuItem icon={<CalendarPlus size={13} />} label="Duplicate to tomorrow" onClick={run(() => A.duplicateBlock(block.id, 1))} />
          <MenuItem icon={<Copy size={13} />} label="Copy" hint="Ctrl C" onClick={run(() => A.copyBlocks([block.id]))} />
          {canSplitHere ? (
            <MenuItem icon={<Scissors size={13} />} label="Split here" onClick={run(() => A.splitBlock(block.id, p.at))} />
          ) : (
            <MenuItem icon={<Scissors size={13} />} label="Split in half" hint="X" onClick={run(() => A.splitBlock(block.id))} />
          )}
          <MenuItem icon={<Combine size={13} />} label="Merge with adjacent" disabled={!mergeWith} onClick={run(() => A.mergeBlock(block.id))} />
          <MenuItem icon={<BookmarkPlus size={13} />} label="Save as preset" onClick={run(() => L.saveBlockAsPreset(block))} />
          {block.templateBlockId && <MenuItem icon={<LayoutTemplate size={13} />} label="Edit original in Template" onClick={run(() => L.openInTemplate(block.templateBlockId!))} />}
        </>
      )}
      <div className="menu-sep" />
      <MenuItem
        icon={<Trash2 size={13} />}
        label={p.kind === "block" ? "Delete block" : "Delete recorded time"}
        hint="Del"
        danger
        onClick={run(() => (p.kind === "block" ? A.deleteBlocks([p.id]) : A.deleteSession(p.id)))}
      />
      {store.get().clipboard.length > 0 && <div className="menu-foot">Ctrl V pastes onto the focused day</div>}
    </div>
  );
}

export function MenuItem(p: { icon?: React.ReactNode; label: string; hint?: string; onClick: () => void; danger?: boolean; disabled?: boolean; checked?: boolean }) {
  return (
    <button className={`menu-item ${p.danger ? "danger" : ""}`} onClick={p.onClick} disabled={p.disabled} role="menuitem">
      <span className="menu-icon">{p.icon}</span>
      <span>{p.label}</span>
      {p.checked && <Check size={12} className="menu-check" />}
      {p.hint && <kbd>{p.hint}</kbd>}
    </button>
  );
}

/** Right-click a template suggestion (ghost) on a real day. */
export function GhostContextMenu(p: { x: number; y: number; id: Id; day: number; onClose: () => void }) {
  const { ref, style } = usePlacement(p.x, p.y);
  useOutside(ref, p.onClose);
  const run = (fn: () => unknown) => () => {
    p.onClose();
    Promise.resolve(fn()).catch(A.reportError);
  };
  return (
    <div className="popover menu popover-modal" ref={ref} style={style} role="menu" aria-label="Template suggestion" onContextMenu={(e) => e.preventDefault()}>
      <div className="menu-head">Template suggestion</div>
      <MenuItem icon={<Check size={13} />} label="Add to plan" hint="Dbl-click" onClick={run(() => L.confirmSuggestion(p.id, p.day))} />
      <MenuItem icon={<EyeOff size={13} />} label="Dismiss for this day" onClick={run(() => L.dismissSuggestion(p.id, p.day))} />
      <div className="menu-sep" />
      <MenuItem icon={<LayoutTemplate size={13} />} label="Edit original in Template" onClick={run(() => L.openInTemplate(p.id))} />
      <div className="menu-foot">Changes there affect every week</div>
    </div>
  );
}

/** Right-click a block in the Template editor. */
export function TemplateBlockMenu(p: { x: number; y: number; id: Id; onClose: () => void }) {
  const { ref, style } = usePlacement(p.x, p.y);
  useOutside(ref, p.onClose);
  const categories = useApp((s) => s.categories);
  const t = useApp((s) => s.weekTemplate.find((x) => x.id === p.id));
  const [sub, setSub] = useState<"cat" | "day" | null>(null);
  const run = (fn: () => unknown) => () => {
    p.onClose();
    Promise.resolve(fn()).catch(A.reportError);
  };
  if (!t) return null;
  return (
    <div className="popover menu popover-modal" ref={ref} style={style} role="menu" aria-label="Template block" onContextMenu={(e) => e.preventDefault()}>
      <MenuItem icon={<Pencil size={13} />} label="Rename" hint="F2" onClick={run(() => store.set({ tplSelection: t.id, tplRenaming: t.id }))} />
      <div className="menu-item has-sub" onMouseEnter={() => setSub("cat")} onMouseLeave={() => setSub(null)} role="menuitem" aria-haspopup>
        <span className="menu-icon">
          <CatDot color={categories.find((c) => c.id === t.categoryId)?.color ?? "#888"} />
        </span>
        <span>Category</span>
        <ChevronRight size={13} className="menu-chev" />
        {sub === "cat" && (
          <div className="popover menu submenu">
            {categories
              .filter((c) => !c.archivedAt)
              .map((c) => (
                <MenuItem key={c.id} icon={<CatDot color={c.color} emoji={c.emoji} />} label={c.name} checked={c.id === t.categoryId} onClick={run(() => L.updateTemplateBlock(t.id, { categoryId: c.id }, "Change category"))} />
              ))}
          </div>
        )}
      </div>
      <div className="menu-sep" />
      <MenuItem icon={<CopyPlus size={13} />} label="Duplicate" hint="Ctrl D" onClick={run(() => L.duplicateTemplateBlock(t.id))} />
      <div className="menu-item has-sub" onMouseEnter={() => setSub("day")} onMouseLeave={() => setSub(null)} role="menuitem" aria-haspopup>
        <span className="menu-icon">
          <CalendarPlus size={13} />
        </span>
        <span>Copy to</span>
        <ChevronRight size={13} className="menu-chev" />
        {sub === "day" && (
          <div className="popover menu submenu">
            {WEEKDAY_NAMES.map((name, w) => (
              <MenuItem key={w} label={name} disabled={w === t.weekday} onClick={run(() => L.duplicateTemplateBlock(t.id, w))} />
            ))}
          </div>
        )}
      </div>
      <MenuItem icon={<Copy size={13} />} label="Copy" hint="Ctrl C" onClick={run(() => L.copyTemplateBlocks([t.id]))} />
      <div className="menu-sep" />
      <MenuItem icon={<Trash2 size={13} />} label="Delete from template" hint="Del" danger onClick={run(() => L.deleteTemplateBlocks([t.id]))} />
    </div>
  );
}
