// The day/week timeline: the core interaction surface.
//
// Gestures (all snap to the configured interval):
//   drag on empty Plan lane     -> create a planned block (category picker opens)
//   drag on empty Actual lane   -> log actual time retroactively
//   drag a block/session        -> move (across days in week view); hold Alt or Ctrl to copy
//   drag top/bottom edge        -> resize
//   double-click empty space    -> create a block of the default length
//   double-click an item / F2   -> rename it inline
//   right-click an item         -> context menu
//   Ctrl + wheel                -> zoom

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, Play, Repeat } from "lucide-react";
import { store, useApp, useNow } from "../state/store";
import * as A from "../state/actions";
import type { Block, Id, Interval, Session } from "../domain/types";
import { dragToInterval, layoutColumns, minuteToPx, moveInterval, resizeInterval, snapMinute, type Edge } from "../domain/calendar";
import { addDays, atMinute, dayKey, isSameDay, minuteOfDay, startOfDay } from "../domain/time";
import { fmt, fmtDuration, fmtHourLabel, fmtTime } from "../domain/format";
import { computeStats } from "../domain/stats";
import { catVars } from "./bits";
import { CategoryPicker } from "./CategoryPicker";
import { ItemContextMenu } from "./ContextMenus";

type Lane = "plan" | "actual";

type Drag =
  | { kind: "create"; lane: Lane; day: number; anchor: number; cur: number; x0: number; y0: number; moved: boolean }
  | { kind: "move"; lane: Lane; id: Id; orig: Interval; grab: number; day: number; startMin: number; copy: boolean; x0: number; y0: number; moved: boolean }
  | { kind: "resize"; lane: Lane; id: Id; orig: Interval; edge: Edge; cur: number; moved: boolean };

interface PickerState {
  x: number;
  y: number;
  lane: Lane;
  interval: Interval;
}

export function Timeline({ days }: { days: number[] }) {
  const settings = useApp((s) => s.settings);
  const blocks = useApp((s) => s.blocks);
  const sessions = useApp((s) => s.sessions);
  const categories = useApp((s) => s.categories);
  const tags = useApp((s) => s.tags);
  const selection = useApp((s) => s.selection);
  const renaming = useApp((s) => s.renaming);
  const focusedDate = useApp((s) => s.date);
  const now = useNow(15_000);

  const { hourHeight, dayStartHour, dayEndHour, snapMinutes } = settings;
  const multi = days.length > 1;
  const showActual = settings.showActualLane;
  const height = (dayEndHour - dayStartHour) * hourHeight;

  const scroller = useRef<HTMLDivElement>(null);
  const cols = useRef(new Map<number, HTMLDivElement>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; kind: "block" | "session"; id: Id; at: number } | null>(null);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const updateDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  // ------------------------------------------------------------ geometry

  const minuteAt = useCallback(
    (clientY: number, col: HTMLElement, snap: number = snapMinutes, raw = false) => {
      const r = col.getBoundingClientRect();
      const m = dayStartHour * 60 + ((clientY - r.top) / hourHeight) * 60;
      const v = raw ? m : snapMinute(m, snap);
      return Math.max(dayStartHour * 60, Math.min(dayEndHour * 60, v));
    },
    [hourHeight, dayStartHour, dayEndHour, snapMinutes],
  );

  const columnAt = (clientX: number): [number, HTMLDivElement] | null => {
    let best: [number, HTMLDivElement] | null = null;
    let bestDist = Infinity;
    for (const [day, el] of cols.current) {
      const r = el.getBoundingClientRect();
      const dist = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = [day, el];
      }
    }
    return best;
  };

  // ------------------------------------------------------- auto-scroll

  const daysKey = days.map(dayKey).join(",");
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const includesToday = days.some((d) => isSameDay(d, Date.now()));
    let targetMin: number;
    if (includesToday) targetMin = minuteOfDay(Date.now()) - 120;
    else {
      const first = store.get().blocks.filter((b) => days.some((d) => isSameDay(d, b.startAt))).sort((a, b) => minuteOfDay(a.startAt) - minuteOfDay(b.startAt))[0];
      targetMin = first ? minuteOfDay(first.startAt) - 60 : 8 * 60;
    }
    el.scrollTop = Math.max(0, minuteToPx(targetMin, hourHeight, dayStartHour));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysKey]);

  // Ctrl + wheel zoom (non-passive listener so we can prevent page zoom)
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const s = store.get().settings;
      const next = Math.max(28, Math.min(180, Math.round(s.hourHeight * (e.deltaY > 0 ? 0.9 : 1.1))));
      if (next !== s.hourHeight) {
        const anchor = (el.scrollTop + e.clientY - el.getBoundingClientRect().top) / s.hourHeight;
        void A.updateSettings({ hourHeight: next });
        requestAnimationFrame(() => (el.scrollTop = anchor * next - (e.clientY - el.getBoundingClientRect().top)));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ------------------------------------------------------------ gestures

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-action]")) return; // hover buttons inside items
    const colEl = target.closest<HTMLDivElement>("[data-day]");
    if (!colEl) return;
    const day = Number(colEl.dataset.day);
    const itemEl = target.closest<HTMLElement>("[data-item]");
    const laneEl = target.closest<HTMLElement>("[data-lane]");
    const lane = (laneEl?.dataset.lane ?? "plan") as Lane;
    if (itemEl) {
      const id = itemEl.dataset.item!;
      const iv = itemInterval(lane, id);
      if (!iv) return;
      const handle = target.closest<HTMLElement>("[data-handle]")?.dataset.handle as Edge | undefined;
      e.preventDefault();
      if (handle) {
        updateDrag({ kind: "resize", lane, id, orig: iv, edge: handle, cur: handle === "start" ? minuteOfDay(iv.start) : endMinute(iv, day), moved: false });
      } else {
        const rawMin = minuteAt(e.clientY, colEl, 1, true);
        const startMin = iv.start < day ? dayStartHour * 60 : minuteOfDay(iv.start);
        updateDrag({ kind: "move", lane, id, orig: iv, grab: rawMin - startMin, day, startMin, copy: e.altKey || e.ctrlKey, x0: e.clientX, y0: e.clientY, moved: false });
      }
    } else if (laneEl) {
      e.preventDefault();
      const m = minuteAt(e.clientY, colEl, snapMinutes);
      const anchor = Math.floor(minuteAt(e.clientY, colEl, 1, true) / snapMinutes) * snapMinutes;
      updateDrag({ kind: "create", lane, day, anchor, cur: m, x0: e.clientX, y0: e.clientY, moved: false });
    }
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      // edge auto-scroll
      const sc = scroller.current;
      if (sc) {
        const r = sc.getBoundingClientRect();
        if (e.clientY < r.top + 36) sc.scrollTop -= 12;
        else if (e.clientY > r.bottom - 36) sc.scrollTop += 12;
      }
      if (d.kind === "create") {
        const col = cols.current.get(d.day);
        if (!col) return;
        const raw = minuteAt(e.clientY, col, 1, true);
        const cur = raw >= d.anchor ? Math.ceil(raw / snapMinutes) * snapMinutes : Math.floor(raw / snapMinutes) * snapMinutes;
        const moved = d.moved || Math.abs(e.clientY - d.y0) > 4;
        updateDrag({ ...d, cur, moved });
      } else if (d.kind === "move") {
        const hit = multi ? columnAt(e.clientX) : ([d.day, cols.current.get(d.day)!] as [number, HTMLDivElement]);
        if (!hit) return;
        const [day, col] = hit;
        const raw = minuteAt(e.clientY, col, 1, true);
        const dur = (d.orig.end - d.orig.start) / 60_000;
        const startMin = Math.max(dayStartHour * 60, Math.min(dayEndHour * 60 - Math.min(dur, 60), snapMinute(raw - d.grab, snapMinutes)));
        const moved = d.moved || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 4;
        updateDrag({ ...d, day, startMin, moved, copy: e.altKey || e.ctrlKey });
      } else if (d.kind === "resize") {
        const day = startOfDay(d.orig.start);
        const col = cols.current.get(day) ?? [...cols.current.values()][0];
        if (!col) return;
        updateDrag({ ...d, cur: minuteAt(e.clientY, col), moved: true });
      }
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      updateDrag(null);
      if (!d) return;
      if (d.kind === "create") {
        if (!d.moved) {
          A.select(null);
          return;
        }
        const iv = dragToInterval(d.day, d.anchor, d.cur, snapMinutes);
        setPicker({ x: e.clientX + 8, y: e.clientY - 20, lane: d.lane, interval: iv });
      } else if (d.kind === "move") {
        if (!d.moved) {
          A.select({ kind: d.lane === "plan" ? "block" : "session", id: d.id });
          return;
        }
        const iv = moveInterval(d.orig, d.day, d.startMin);
        if (iv.start === d.orig.start && !d.copy) return;
        if (d.lane === "plan") {
          if (d.copy) {
            const b = store.get().blocks.find((x) => x.id === d.id);
            if (b) void A.createBlock(iv, b.categoryId, { title: b.title, notes: b.notes, link: b.link, tagIds: b.tagIds }).catch(A.reportError);
          } else void A.updateBlock(d.id, { startAt: iv.start, endAt: iv.end }, "Move block").catch(A.reportError);
        } else {
          const s = store.get().sessions.find((x) => x.id === d.id);
          if (!s) return;
          if (s.endAt === null) {
            // running: only the start can move, and never into the future
            void A.updateSession(d.id, { startAt: Math.min(iv.start, Date.now()) }, "Move session").catch(A.reportError);
          } else if (iv.end > Date.now()) A.toast("Recorded time can’t be moved into the future");
          else void A.updateSession(d.id, { startAt: iv.start, endAt: iv.end }, "Move session").catch(A.reportError);
        }
      } else if (d.kind === "resize") {
        const iv = resizeInterval(d.orig, d.edge, d.cur, snapMinutes);
        if (iv.start === d.orig.start && iv.end === d.orig.end) return;
        if (d.lane === "plan") void A.updateBlock(d.id, { startAt: iv.start, endAt: iv.end }, "Resize block").catch(A.reportError);
        else {
          const s = store.get().sessions.find((x) => x.id === d.id);
          if (s?.endAt === null && d.edge === "end") return;
          void A.updateSession(d.id, d.edge === "start" ? { startAt: iv.start } : { endAt: Math.min(iv.end, Date.now()) }, "Resize session").catch(A.reportError);
        }
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && updateDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, minuteAt, multi, snapMinutes]);

  function itemInterval(lane: Lane, id: Id): Interval | null {
    if (lane === "plan") {
      const b = blocks.find((x) => x.id === id);
      return b ? { start: b.startAt, end: b.endAt } : null;
    }
    const s = sessions.find((x) => x.id === id);
    return s ? { start: s.startAt, end: s.endAt ?? Date.now() } : null;
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-action]")) return;
    const itemEl = target.closest<HTMLElement>("[data-item]");
    if (itemEl) {
      const id = itemEl.dataset.item!;
      if (id === "__copy__") return;
      const lane = itemEl.closest<HTMLElement>("[data-lane]")?.dataset.lane as Lane;
      A.startRename({ kind: lane === "plan" ? "block" : "session", id });
      return;
    }
    const colEl = target.closest<HTMLDivElement>("[data-day]");
    const laneEl = target.closest<HTMLElement>("[data-lane]");
    if (!colEl || !laneEl) return;
    const day = Number(colEl.dataset.day);
    const m = Math.floor(minuteAt(e.clientY, colEl, 1, true) / snapMinutes) * snapMinutes;
    const iv = dragToInterval(day, m, Math.min(1440, m + settings.defaultBlockMinutes), snapMinutes);
    setPicker({ x: e.clientX + 8, y: e.clientY - 20, lane: laneEl.dataset.lane as Lane, interval: iv });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const itemEl = target.closest<HTMLElement>("[data-item]");
    if (!itemEl) return;
    e.preventDefault();
    const lane = itemEl.closest<HTMLElement>("[data-lane]")?.dataset.lane as Lane;
    const colEl = target.closest<HTMLDivElement>("[data-day]");
    const id = itemEl.dataset.item!;
    const at = colEl ? atMinute(Number(colEl.dataset.day), minuteAt(e.clientY, colEl)) : 0;
    A.select({ kind: lane === "plan" ? "block" : "session", id });
    setMenu({ x: e.clientX, y: e.clientY, kind: lane === "plan" ? "block" : "session", id, at });
  };

  // ------------------------------------------------------------ render data

  const preview = useMemo(() => {
    if (!drag) return null;
    if (drag.kind === "move" && drag.moved) return { id: drag.id, lane: drag.lane, iv: moveInterval(drag.orig, drag.day, drag.startMin), copy: drag.copy };
    if (drag.kind === "resize" && drag.moved) return { id: drag.id, lane: drag.lane, iv: resizeInterval(drag.orig, drag.edge, drag.cur, snapMinutes), copy: false };
    return null;
  }, [drag, snapMinutes]);

  const hours = Array.from({ length: dayEndHour - dayStartHour }, (_, i) => dayStartHour + i);
  const gridStyle = { ["--hh" as string]: `${hourHeight}px`, height } as CSSProperties;

  return (
    <div className={`timeline ${multi ? "multi" : "single"} ${drag ? "dragging" : ""} ${showActual ? "" : "no-actual"}`}>
      {multi ? (
        <div className="tl-heads">
          <div className="tl-gutter-head" />
          {days.map((d) => (
            <DayHead key={d} day={d} focused={isSameDay(d, focusedDate)} />
          ))}
        </div>
      ) : (
        showActual && (
          <div className="tl-heads single">
            <div className="tl-gutter-head" />
            <div className="tl-lane-labels">
              <span>Plan</span>
              <span>Actual</span>
            </div>
          </div>
        )
      )}
      <div className="tl-scroll" ref={scroller}>
        <div className="tl-body" style={gridStyle}>
          <div className="tl-gutter">
            {hours.map((h) => (
              <div key={h} className="tl-hour" style={{ top: (h - dayStartHour) * hourHeight }}>
                <span>{h === dayStartHour || (days.some((d) => isSameDay(d, now)) && Math.abs(minuteOfDay(now) - h * 60) < 14) ? "" : fmtHourLabel(h, settings.timeFormat)}</span>
              </div>
            ))}
            {days.some((d) => isSameDay(d, now)) && minuteOfDay(now) >= dayStartHour * 60 && minuteOfDay(now) < dayEndHour * 60 && (
              <div className="tl-now-label" style={{ top: minuteToPx(minuteOfDay(now), hourHeight, dayStartHour) }}>
                {fmtTime(now, settings.timeFormat)}
              </div>
            )}
          </div>
          <div className="tl-cols" onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}>
            {days.map((day) => (
              <DayColumn
                key={day}
                day={day}
                refCb={(el) => (el ? cols.current.set(day, el) : cols.current.delete(day))}
                blocks={blocks}
                sessions={sessions}
                preview={preview}
                drag={drag}
                pending={picker && picker.interval.start < addDays(day, 1) && picker.interval.end > day ? picker : null}
                now={now}
                compact={multi}
                selection={selection}
                renaming={renaming}
                catById={catById}
                tagById={tagById}
              />
            ))}
          </div>
        </div>
      </div>
      {picker && (
        <CategoryPicker
          x={picker.x}
          y={picker.y}
          title={picker.lane === "plan" ? `Plan ${fmtTime(picker.interval.start)} – ${fmtTime(picker.interval.end)}` : `Log ${fmtTime(picker.interval.start)} – ${fmtTime(picker.interval.end)}`}
          onCancel={() => setPicker(null)}
          onPick={(categoryId, title) => {
            const p = picker;
            setPicker(null);
            const extra = title ? { title } : {};
            if (p.lane === "plan") void A.createBlock(p.interval, categoryId, extra).catch(A.reportError);
            else if (p.interval.start > Date.now()) A.toast("Actual time can’t start in the future. Plan it instead.");
            else void A.createSession(p.interval, categoryId, extra).catch(A.reportError);
          }}
        />
      )}
      {menu && <ItemContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function endMinute(iv: Interval, day: number): number {
  return iv.end >= addDays(day, 1) ? 1440 : minuteOfDay(iv.end);
}

// ---------------------------------------------------------------- columns

interface ColumnProps {
  day: number;
  refCb: (el: HTMLDivElement | null) => void;
  blocks: Block[];
  sessions: Session[];
  preview: { id: Id; lane: Lane; iv: Interval; copy: boolean } | null;
  drag: Drag | null;
  pending: PickerState | null;
  now: number;
  compact: boolean;
  selection: { kind: "block" | "session"; id: Id } | null;
  renaming: { kind: "block" | "session"; id: Id } | null;
  catById: Map<Id, import("../domain/types").Category>;
  tagById: Map<Id, import("../domain/types").Tag>;
}

function DayColumn(p: ColumnProps) {
  const settings = useApp((s) => s.settings);
  const { hourHeight, dayStartHour, dayEndHour } = settings;
  const dayEnd = addDays(p.day, 1);
  const isToday = isSameDay(p.day, p.now);

  const place = (iv: Interval) => {
    const s = Math.max(iv.start, p.day);
    const e = Math.min(iv.end, dayEnd);
    const sm = minuteOfDay(s);
    const em = e >= dayEnd ? 1440 : minuteOfDay(e);
    const top = minuteToPx(Math.max(sm, dayStartHour * 60), hourHeight, dayStartHour);
    const bottom = minuteToPx(Math.min(em, dayEndHour * 60), hourHeight, dayStartHour);
    return { top, height: Math.max(bottom - top, 3), clippedTop: iv.start < p.day, clippedBottom: iv.end > dayEnd };
  };

  const overlapsDay = (iv: Interval) => iv.start < dayEnd && iv.end > p.day;

  const planItems = useMemo(() => {
    const items = p.blocks.map((b) => {
      if (p.preview && p.preview.lane === "plan" && p.preview.id === b.id && !p.preview.copy) return { ...b, startAt: p.preview.iv.start, endAt: p.preview.iv.end, ghost: true };
      return { ...b, ghost: false };
    });
    if (p.preview?.copy && p.preview.lane === "plan") {
      const b = p.blocks.find((x) => x.id === p.preview!.id);
      if (b) items.push({ ...b, id: "__copy__", startAt: p.preview.iv.start, endAt: p.preview.iv.end, ghost: true });
    }
    return items.filter((b) => overlapsDay({ start: b.startAt, end: b.endAt }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.blocks, p.preview, p.day]);

  const actualItems = useMemo(() => {
    return p.sessions
      .map((s) => {
        const end = s.endAt ?? p.now;
        if (p.preview && p.preview.lane === "actual" && p.preview.id === s.id) {
          const iv = p.preview.iv;
          return { ...s, startAt: iv.start, endAt: s.endAt === null ? null : iv.end, end: s.endAt === null ? p.now : iv.end, ghost: true };
        }
        return { ...s, end, ghost: false };
      })
      .filter((s) => overlapsDay({ start: s.startAt, end: s.end }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.sessions, p.preview, p.day, p.now]);

  const planLayout = useMemo(() => layoutColumns(planItems.map((b) => ({ id: b.id, startAt: b.startAt, endAt: b.endAt }))), [planItems]);
  const actualLayout = useMemo(() => layoutColumns(actualItems.map((s) => ({ id: s.id, startAt: s.startAt, endAt: s.end }))), [actualItems]);

  const createGhost = p.drag?.kind === "create" && p.drag.day === p.day && p.drag.moved ? p.drag : p.pending;
  const ghostIv = p.drag?.kind === "create" && createGhost === p.drag ? dragToInterval(p.day, p.drag.anchor, p.drag.cur, settings.snapMinutes) : p.pending?.interval ?? null;

  const nowTop = isToday ? minuteToPx(minuteOfDay(p.now), hourHeight, dayStartHour) : null;

  return (
    <div className={`tl-col ${isToday ? "today" : ""}`} data-day={p.day} ref={p.refCb}>
      <div className="lane lane-plan" data-lane="plan">
        {planItems.map((b) => {
          const pos = place({ start: b.startAt, end: b.endAt });
          const lay = planLayout.get(b.id) ?? { col: 0, cols: 1 };
          return (
            <BlockView
              key={b.id}
              block={b}
              pos={pos}
              lay={lay}
              ghost={b.ghost}
              selected={p.selection?.kind === "block" && p.selection.id === b.id}
              renaming={!b.ghost && p.renaming?.kind === "block" && p.renaming.id === b.id}
              compact={p.compact}
              catById={p.catById}
              tagById={p.tagById}
              now={p.now}
            />
          );
        })}
        {ghostIv && createGhost?.lane === "plan" && <CreateGhost pos={place(ghostIv)} iv={ghostIv} />}
      </div>
      {settings.showActualLane && (
        <div className="lane lane-actual" data-lane="actual">
          {actualItems.map((s) => {
            const pos = place({ start: s.startAt, end: s.end });
            const lay = actualLayout.get(s.id) ?? { col: 0, cols: 1 };
            return (
              <SessionView
                key={s.id}
                session={s}
                end={s.end}
                pos={pos}
                lay={lay}
                ghost={s.ghost}
                selected={p.selection?.kind === "session" && p.selection.id === s.id}
                renaming={!s.ghost && p.renaming?.kind === "session" && p.renaming.id === s.id}
                compact={p.compact}
                catById={p.catById}
              />
            );
          })}
          {ghostIv && createGhost?.lane === "actual" && <CreateGhost pos={place(ghostIv)} iv={ghostIv} actual />}
        </div>
      )}
      {nowTop !== null && nowTop >= 0 && nowTop <= (dayEndHour - dayStartHour) * hourHeight && (
        <div className="tl-now" style={{ top: nowTop }}>
          <span className="tl-now-dot" />
        </div>
      )}
    </div>
  );
}

function CreateGhost({ pos, iv, actual }: { pos: { top: number; height: number }; iv: Interval; actual?: boolean }) {
  return (
    <div className={`create-ghost ${actual ? "actual" : ""}`} style={{ top: pos.top, height: pos.height }}>
      <span>
        {fmtTime(iv.start)} – {fmtTime(iv.end)} · {fmtDuration(iv.end - iv.start, { compact: true })}
      </span>
    </div>
  );
}

function itemStyle(pos: { top: number; height: number }, lay: { col: number; cols: number }, color: string): CSSProperties {
  const w = 100 / lay.cols;
  return {
    ...catVars(color),
    top: pos.top,
    height: pos.height,
    left: `calc(${lay.col * w}% + 2px)`,
    width: `calc(${w}% - 4px)`,
  };
}

function BlockView(p: {
  block: Block & { ghost: boolean };
  pos: { top: number; height: number; clippedTop: boolean; clippedBottom: boolean };
  lay: { col: number; cols: number };
  ghost: boolean;
  selected: boolean;
  renaming: boolean;
  compact: boolean;
  catById: ColumnProps["catById"];
  tagById: ColumnProps["tagById"];
  now: number;
}) {
  const b = p.block;
  const cat = p.catById.get(b.categoryId);
  const color = cat?.color ?? "#888";
  const tagNames = b.tagIds.map((t) => p.tagById.get(t)?.name).filter(Boolean) as string[];
  const label = b.title || cat?.name || "Untitled";
  const timeLabel = `${fmtTime(b.startAt)} – ${fmtTime(b.endAt)}`;
  const tiny = p.pos.height < 30;
  const isPast = b.endAt <= p.now;
  const canConfirm = b.status === "planned" && b.startAt < p.now;
  const subtitle = [b.title && cat ? cat.name : null, tagNames.join(", ") || null].filter(Boolean).join(" · ");
  return (
    <div
      className={`block status-${b.status} ${p.selected ? "selected" : ""} ${p.ghost ? "ghost" : ""} ${tiny ? "tiny" : ""} ${isPast && b.status === "planned" ? "unreviewed" : ""} ${p.pos.clippedTop ? "clip-top" : ""} ${p.pos.clippedBottom ? "clip-bottom" : ""}`}
      style={itemStyle(p.pos, p.lay, color)}
      data-item={b.id}
      title={`${label}\n${timeLabel}${tagNames.length ? "\n#" + tagNames.join(" #") : ""}`}
      aria-label={`${label}, ${timeLabel}, ${b.status}`}
      aria-selected={p.selected}
    >
      {!p.pos.clippedTop && <div className="handle top" data-handle="start" />}
      <div className="block-body">
        <div className="block-title">
          {b.recurrenceId && <Repeat size={10} />}
          {p.renaming ? <InlineName value={b.title} placeholder={cat?.name ?? "Name"} target={{ kind: "block", id: b.id }} /> : <span className={b.title ? "" : "unnamed"}>{label}</span>}
          {tiny && !p.compact && <span className="block-time-inline">{timeLabel}</span>}
        </div>
        {!tiny && (
          <div className="block-meta">
            {timeLabel}
            {subtitle && !p.compact ? ` · ${subtitle}` : ""}
          </div>
        )}
        {!tiny && p.compact && subtitle && p.pos.height > 54 && <div className="block-meta">{subtitle}</div>}
      </div>
      {!p.ghost && b.status !== "completed" && b.status !== "in_progress" && b.status !== "skipped" && (
        <div className="block-actions">
          {canConfirm && (
            <button data-action className="mini-act" title="Confirm as done (C)" onClick={() => void A.completeBlockManually(b.id)}>
              <Check size={12} />
            </button>
          )}
          <button data-action className="mini-act" title="Start session" onClick={() => void A.startTimer({ blockId: b.id })}>
            <Play size={11} />
          </button>
        </div>
      )}
      {!p.pos.clippedBottom && <div className="handle bottom" data-handle="end" />}
    </div>
  );
}

function SessionView(p: {
  session: Session;
  end: number;
  pos: { top: number; height: number; clippedTop: boolean; clippedBottom: boolean };
  lay: { col: number; cols: number };
  ghost: boolean;
  selected: boolean;
  renaming: boolean;
  compact: boolean;
  catById: ColumnProps["catById"];
}) {
  const s = p.session;
  const cat = p.catById.get(s.categoryId);
  const running = s.endAt === null;
  const dur = fmtDuration(p.end - s.startAt, { compact: true });
  return (
    <div
      className={`session ${running ? "running" : ""} ${p.selected ? "selected" : ""} ${p.ghost ? "ghost" : ""}`}
      style={itemStyle(p.pos, p.lay, cat?.color ?? "#888")}
      data-item={s.id}
      title={`${s.title || cat?.name || "Session"}\n${fmtTime(s.startAt)} – ${running ? "now" : fmtTime(p.end)} · ${dur}`}
      aria-label={`Recorded ${cat?.name ?? ""} ${dur}`}
    >
      <div className="handle top" data-handle="start" />
      {p.renaming ? (
        <div className="session-body">
          <InlineName value={s.title} placeholder={cat?.name ?? "Name"} target={{ kind: "session", id: s.id }} />
        </div>
      ) : (
        !p.compact &&
        p.pos.height >= 22 && (
          <div className="session-body">
            <span className="session-dur">{dur}</span>
            {p.pos.height >= 40 && <span className="session-name">{s.title || cat?.name}</span>}
          </div>
        )
      )}
      {!running && <div className="handle bottom" data-handle="end" />}
    </div>
  );
}

/** Inline name editor on a block or session. Enter or blur saves, Escape cancels. */
function InlineName(p: { value: string | null; placeholder: string; target: { kind: "block" | "session"; id: Id } }) {
  const [v, setV] = useState(p.value ?? "");
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const save = () => {
    if (done.current) return;
    done.current = true;
    void A.renameItem(p.target, v).catch(A.reportError);
  };
  return (
    <input
      ref={ref}
      data-action
      className="inline-name"
      value={v}
      placeholder={p.placeholder}
      aria-label="Name"
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        } else if (e.key === "Escape") {
          e.preventDefault();
          done.current = true;
          A.cancelRename();
        }
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}

// --------------------------------------------------------------- headers

function DayHead({ day, focused }: { day: number; focused: boolean }) {
  const blocks = useApp((s) => s.blocks);
  const sessions = useApp((s) => s.sessions);
  const categories = useApp((s) => s.categories);
  const now = useNow(60_000);
  const stats = useMemo(
    () => computeStats({ sessions, blocks, categories, range: { start: day, end: addDays(day, 1) }, now }),
    [sessions, blocks, categories, day, now],
  );
  const today = isSameDay(day, now);
  return (
    <button className={`tl-dayhead ${today ? "today" : ""} ${focused ? "focused" : ""}`} onClick={() => A.setDate(day)} onDoubleClick={() => A.openDay(day)} title="Double-click to open day">
      <span className="dh-dow">{fmt.weekdayShort(day)}</span>
      <span className="dh-num">{new Date(day).getDate()}</span>
      <span className="dh-total">
        {stats.recordedMs > 0 ? fmtDuration(stats.recordedMs, { compact: true }) : "–"}
        <span className="dh-planned"> / {fmtDuration(stats.plannedMs, { compact: true })}</span>
      </span>
    </button>
  );
}
