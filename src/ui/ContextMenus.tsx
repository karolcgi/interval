import { useState } from "react";
import { Ban, Check, Pencil, ChevronRight, Combine, Copy, CopyPlus, Play, RotateCcw, Scissors, Trash2, CalendarPlus } from "lucide-react";
import { store, useApp } from "../state/store";
import * as A from "../state/actions";
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
          {block.status !== "in_progress" && <MenuItem icon={<Play size={13} />} label="Start session" hint="S" onClick={run(() => A.startTimer({ blockId: block.id }))} />}
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
                <MenuItem key={c.id} icon={<CatDot color={c.color} />} label={c.name} hint={c.shortcut ?? undefined} checked={c.id === item.categoryId} onClick={run(() => setCategory(c.id))} />
              ))}
          </div>
        )}
      </div>
      {block && (
        <>
          <div className="menu-sep" />
          <MenuItem icon={<CopyPlus size={13} />} label="Duplicate" hint="Ctrl D" onClick={run(() => A.duplicateBlock(block.id))} />
          <MenuItem icon={<CalendarPlus size={13} />} label="Duplicate to tomorrow" onClick={run(() => A.duplicateBlock(block.id, 1))} />
          <MenuItem icon={<Copy size={13} />} label="Copy" hint="Ctrl C" onClick={run(() => A.copyBlocks([block.id]))} />
          {canSplitHere ? (
            <MenuItem icon={<Scissors size={13} />} label="Split here" onClick={run(() => A.splitBlock(block.id, p.at))} />
          ) : (
            <MenuItem icon={<Scissors size={13} />} label="Split in half" hint="X" onClick={run(() => A.splitBlock(block.id))} />
          )}
          <MenuItem icon={<Combine size={13} />} label="Merge with adjacent" disabled={!mergeWith} onClick={run(() => A.mergeBlock(block.id))} />
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
