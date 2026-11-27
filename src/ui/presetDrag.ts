// Dragging presets from the library onto a timeline (Today, Calendar, Template) or within the list
// to reorder. Pointer events rather than HTML5 drag-and-drop: the desktop webview reserves native
// drag-and-drop for files, and pointer events give us snapping and a live preview anyway.

import type React from "react";
import { store, type DragItem } from "../state/store";
import type { Id } from "../domain/types";

export interface DropTarget {
  /** Does this point land on the target? Checked newest-registered first. */
  hit(x: number, y: number): boolean;
  /** `presetId` is null when an activity, task or project (`item`) is dropped. */
  drop(x: number, y: number, presetId: Id | null, item?: DragItem): void;
}

const targets: DropTarget[] = [];

export function registerDropTarget(t: DropTarget): () => void {
  targets.push(t);
  return () => {
    const i = targets.indexOf(t);
    if (i >= 0) targets.splice(i, 1);
  };
}

export function targetAt(x: number, y: number): DropTarget | null {
  for (let i = targets.length - 1; i >= 0; i--) if (targets[i].hit(x, y)) return targets[i];
  return null;
}

/** Call from a preset row's onPointerDown. A press without movement is a click (`onClick`). */
export function beginPresetDrag(e: React.PointerEvent, presetId: Id, onClick?: () => void) {
  beginDrag(e, presetId, undefined, onClick);
}

/** Drag an activity, Obsidian task or project onto PLAN (same mechanics as presets). */
export function beginItemDrag(e: React.PointerEvent, item: DragItem, onClick?: () => void) {
  beginDrag(e, null, item, onClick);
}

function beginDrag(e: React.PointerEvent, presetId: Id | null, item: DragItem | undefined, onClick?: () => void) {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest("button, input, [data-nodrag]")) return;
  e.preventDefault();
  const x0 = e.clientX;
  const y0 = e.clientY;
  let dragging = false;
  const move = (ev: PointerEvent) => {
    if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
    dragging = true;
    store.set({ presetDrag: { presetId, item, x: ev.clientX, y: ev.clientY } });
  };
  const end = (ev: PointerEvent | null) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", key, true);
    store.set({ presetDrag: null });
    if (!ev) return;
    if (!dragging) return onClick?.();
    targetAt(ev.clientX, ev.clientY)?.drop(ev.clientX, ev.clientY, presetId, item);
  };
  const up = (ev: PointerEvent) => end(ev);
  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.stopPropagation();
      end(null);
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", key, true);
}
