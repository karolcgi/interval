import { useEffect, useMemo, useState } from "react";
import { Ban, Check, Combine, CopyPlus, ExternalLink, Link2, Play, RotateCcw, Scissors, Square, Trash2, X } from "lucide-react";
import { useApp, useNow } from "../state/store";
import * as A from "../state/actions";
import * as repo from "../db/repo";
import type { Block, Session } from "../domain/types";
import { computeStats } from "../domain/stats";
import { addDays, atMinute, isSameDay, startOfDay } from "../domain/time";
import { fmt, fmtClock, fmtDuration, fmtTime } from "../domain/format";
import { catVars, CategorySelect, Segmented } from "./bits";
import { TagInput } from "./TagInput";
import { RepeatSection } from "./RepeatSection";
import { openExternal } from "../platform";
import { findMergeCandidate } from "../domain/calendar";

export function RightPanel() {
  const selection = useApp((s) => s.selection);
  const blocks = useApp((s) => s.blocks);
  const sessions = useApp((s) => s.sessions);
  const block = selection?.kind === "block" ? blocks.find((b) => b.id === selection.id) : undefined;
  const session = selection?.kind === "session" ? sessions.find((s) => s.id === selection.id) : undefined;
  return (
    <aside className="panel" aria-label="Details">
      {block ? <BlockInspector key={block.id} block={block} /> : session ? <SessionInspector key={session.id} session={session} /> : <DayOverview />}
    </aside>
  );
}

// ------------------------------------------------------------- overview

function DayOverview() {
  const date = useApp((s) => s.date);
  const blocks = useApp((s) => s.blocks);
  const sessions = useApp((s) => s.sessions);
  const categories = useApp((s) => s.categories);
  const note = useApp((s) => s.dailyNote);
  const running = useApp((s) => s.running);
  const now = useNow(30_000);
  const isToday = isSameDay(date, now);

  const st = useMemo(
    () => computeStats({ sessions, blocks, categories, range: { start: date, end: addDays(date, 1) }, now }),
    [sessions, blocks, categories, date, now],
  );
  const catById = new Map(categories.map((c) => [c.id, c]));
  const rows = st.byCategory.filter((r) => r.recordedMs > 0 || r.plannedMs > 0);
  const maxRow = Math.max(1, ...rows.map((r) => Math.max(r.recordedMs, r.plannedMs)));
  const upNext = isToday
    ? blocks.filter((b) => b.status === "planned" && b.endAt > now && isSameDay(b.startAt, date) && !catById.get(b.categoryId)?.isBreak).sort((a, b) => a.startAt - b.startAt)[0]
    : undefined;
  const unreviewed = blocks.filter((b) => b.status === "planned" && b.endAt <= now && isSameDay(b.startAt, date)).length;
  const pct = st.plannedMs > 0 ? Math.min(100, (st.recordedMs / st.plannedMs) * 100) : 0;

  return (
    <div className="panel-inner">
      <div className="card hero">
        <div className="eyebrow">{isToday ? "Today’s time" : fmt.full(date)}</div>
        <div className="hero-val">{fmtDuration(st.recordedMs)}</div>
        <div className="hero-sub">
          recorded of {fmtDuration(st.plannedMs)} planned
          {st.breakMs > 0 && <> · {fmtDuration(st.breakMs, { compact: true })} breaks</>}
        </div>
        <div className="progress">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>

      <section className="panel-sec">
        <div className="sec-head">
          <h3>Planned vs actual</h3>
        </div>
        {rows.length === 0 && <p className="muted small">Nothing planned or recorded yet. Drag on the timeline to plan a block.</p>}
        <ul className="dist">
          {rows.map((r) => {
            const c = catById.get(r.categoryId);
            return (
              <li key={r.categoryId} style={catVars(c?.color ?? "#888")}>
                <div className="dist-top">
                  <span className="dist-name">{c?.name ?? "Unknown"}</span>
                  <span className="dist-val">
                    {fmtDuration(r.recordedMs, { compact: true })}
                    <span className="muted"> / {fmtDuration(r.plannedMs, { compact: true })}</span>
                  </span>
                </div>
                <div className="dist-bar">
                  <span className="dist-plan" style={{ width: `${(r.plannedMs / maxRow) * 100}%` }} />
                  <span className="dist-act" style={{ width: `${(r.recordedMs / maxRow) * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
        {unreviewed > 0 && (
          <p className="notice small">
            {unreviewed} past block{unreviewed > 1 ? "s" : ""} not yet confirmed. Hover a block and press ✓, or right-click it.
          </p>
        )}
      </section>

      {upNext && !running && (
        <section className="panel-sec">
          <div className="eyebrow">Up next</div>
          <div className="upnext" style={catVars(catById.get(upNext.categoryId)?.color ?? "#888")}>
            <div className="upnext-title">{upNext.title || catById.get(upNext.categoryId)?.name}</div>
            <div className="muted small">
              {fmtTime(upNext.startAt)} · {fmtDuration(upNext.endAt - upNext.startAt)}
            </div>
            <button className="btn btn-cat" onClick={() => void A.startTimer({ blockId: upNext.id })}>
              <Play size={12} fill="currentColor" /> Start session
            </button>
          </div>
        </section>
      )}

      <section className="panel-sec">
        <div className="eyebrow">Daily intention</div>
        <NoteField key={`i-${date}`} value={note?.intention ?? ""} placeholder="What matters today?" onSave={(v) => void A.saveDailyNote({ intention: v || null })} />
      </section>
      <section className="panel-sec">
        <div className="eyebrow">Reflection</div>
        <NoteField key={`r-${date}`} value={note?.reflection ?? ""} placeholder="Optional. How did the day go?" onSave={(v) => void A.saveDailyNote({ reflection: v || null })} />
      </section>
    </div>
  );
}

function NoteField(p: { value: string; placeholder: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(p.value);
  useEffect(() => setV(p.value), [p.value]);
  return (
    <textarea
      className="note"
      rows={2}
      value={v}
      placeholder={p.placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== p.value && p.onSave(v.trim())}
    />
  );
}

// ------------------------------------------------------------ inspectors

function TimeField(p: { value: number; onCommit: (t: number) => void; label: string }) {
  const [v, setV] = useState(fmtTime(p.value));
  useEffect(() => setV(fmtTime(p.value)), [p.value]);
  const commit = () => {
    const m = /^(\d{1,2}):?(\d{2})$/.exec(v.trim());
    if (!m) return setV(fmtTime(p.value));
    const minute = Number(m[1]) * 60 + Number(m[2]);
    if (minute > 1440) return setV(fmtTime(p.value));
    const t = atMinute(startOfDay(p.value), minute);
    if (t !== p.value) p.onCommit(t);
  };
  return (
    <input
      className="time-input"
      aria-label={p.label}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function TextField(p: { value: string | null; placeholder: string; onCommit: (v: string | null) => void; className?: string; multiline?: boolean; autoFocus?: boolean }) {
  const [v, setV] = useState(p.value ?? "");
  useEffect(() => setV(p.value ?? ""), [p.value]);
  const commit = () => {
    const next = v.trim() || null;
    if (next !== (p.value ?? null)) p.onCommit(next);
  };
  if (p.multiline)
    return <textarea className={`field ${p.className ?? ""}`} rows={3} value={v} placeholder={p.placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} />;
  return (
    <input
      className={`field ${p.className ?? ""}`}
      value={v}
      placeholder={p.placeholder}
      autoFocus={p.autoFocus}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

function InspectorHead({ color, label, onClose }: { color: string; label: string; onClose: () => void }) {
  return (
    <div className="insp-head" style={catVars(color)}>
      <span className="insp-kind">{label}</span>
      <button className="icon-btn sm" onClick={onClose} aria-label="Close details (Esc)">
        <X size={14} />
      </button>
    </div>
  );
}

function BlockInspector({ block }: { block: Block }) {
  const categories = useApp((s) => s.categories);
  const blocks = useApp((s) => s.blocks);
  const running = useApp((s) => s.running);
  const sessionsInView = useApp((s) => s.sessions);
  const [linked, setLinked] = useState<Session[]>([]);
  const db = useApp((s) => s.db);
  const now = useNow(1000);
  useEffect(() => {
    if (db) void repo.sessionsForBlock(db, block.id).then(setLinked);
  }, [db, block.id, block.updatedAt, sessionsInView]);
  const cat = categories.find((c) => c.id === block.categoryId);
  const recorded = linked.reduce((acc, s) => acc + ((s.endAt ?? now) - s.startAt), 0);
  const plannedMs = block.endAt - block.startAt;
  const isRunningHere = running?.blockId === block.id;
  const upd = (patch: Partial<Block>, label?: string) => void A.updateBlock(block.id, patch, label).catch(A.reportError);
  const canMerge = !!findMergeCandidate(block, blocks);

  return (
    <div className="panel-inner insp">
      <InspectorHead color={cat?.color ?? "#888"} label="Planned block" onClose={() => A.select(null)} />
      <TextField className="insp-title" value={block.title} placeholder={cat?.name ?? "Title"} onCommit={(title) => upd({ title }, "Rename block")} />
      <div className="insp-row">
        <CategorySelect categories={categories} value={block.categoryId} includeArchivedId={block.categoryId} onChange={(categoryId) => upd({ categoryId }, "Change category")} />
      </div>
      <div className="insp-row time-row">
        <span className="muted small">{fmt.full(block.startAt)}</span>
        <div className="time-pair">
          <TimeField label="Start time" value={block.startAt} onCommit={(t) => t < block.endAt && upd({ startAt: t }, "Change start")} />
          <span className="muted">–</span>
          <TimeField label="End time" value={block.endAt} onCommit={(t) => t > block.startAt && upd({ endAt: t }, "Change end")} />
          <span className="dur-chip">{fmtDuration(plannedMs, { compact: true })}</span>
        </div>
        <div className="dur-presets">
          {[30, 60, 90, 120].map((m) => (
            <button key={m} className={`chip ${plannedMs === m * 60_000 ? "on" : ""}`} onClick={() => upd({ endAt: block.startAt + m * 60_000 }, "Change duration")}>
              {m < 60 ? `${m}m` : `${m / 60}h`}
            </button>
          ))}
        </div>
      </div>

      <div className="insp-row">
        <Segmented
          size="sm"
          value={block.status === "in_progress" ? "planned" : block.status}
          ariaLabel="Status"
          onChange={(v) => (v === "completed" ? void A.completeBlockManually(block.id) : void A.setBlockStatus(block.id, v))}
          options={[
            { value: "planned", label: block.status === "in_progress" ? "In progress" : "Planned" },
            { value: "completed", label: "Done" },
            { value: "skipped", label: "Skipped" },
          ]}
        />
      </div>

      <label className="insp-label">Repeat</label>
      <RepeatSection block={block} />

      <div className="insp-actions">
        {isRunningHere ? (
          <button className="btn btn-cat wide" style={catVars(cat?.color ?? "#888")} onClick={() => void A.stopTimer()}>
            <Square size={12} fill="currentColor" /> Stop · {fmtClock(now - running!.startAt)}
          </button>
        ) : (
          <button className="btn btn-cat wide" style={catVars(cat?.color ?? "#888")} onClick={() => void A.startTimer({ blockId: block.id })}>
            <Play size={12} fill="currentColor" /> Start session
          </button>
        )}
        {block.status === "planned" && block.startAt < now && (
          <button className="btn btn-outline" onClick={() => void A.completeBlockManually(block.id)} title="Record the planned time as actual, without a timer">
            <Check size={13} /> Confirm
          </button>
        )}
      </div>

      <div className="insp-stat">
        <div>
          <div className="eyebrow">Planned</div>
          <div className="insp-stat-val">{fmtDuration(plannedMs)}</div>
        </div>
        <div>
          <div className="eyebrow">Recorded</div>
          <div className="insp-stat-val">{fmtDuration(recorded)}</div>
        </div>
        <div>
          <div className="eyebrow">Diff</div>
          <div className={`insp-stat-val ${recorded - plannedMs < 0 ? "neg" : ""}`}>
            {linked.length ? (recorded >= plannedMs ? "+" : "−") + fmtDuration(Math.abs(recorded - plannedMs), { compact: true }) : "–"}
          </div>
        </div>
      </div>
      {linked.length > 0 && (
        <ul className="linked">
          {linked.map((s) => (
            <li key={s.id}>
              <button className="link-row" onClick={() => A.select({ kind: "session", id: s.id })}>
                {fmtTime(s.startAt)} – {s.endAt ? fmtTime(s.endAt) : "now"}
                <span className="muted">{fmtDuration((s.endAt ?? now) - s.startAt, { compact: true })}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="insp-label">Tags</label>
      <TagInput value={block.tagIds} onChange={(tagIds) => upd({ tagIds }, "Change tags")} />

      <label className="insp-label">Link</label>
      <div className="link-field">
        <Link2 size={13} className="muted" />
        <TextField value={block.link} placeholder="obsidian://… or https://…" onCommit={(link) => upd({ link }, "Change link")} />
        {block.link && (
          <button className="icon-btn sm" onClick={() => void openExternal(block.link!)} aria-label="Open link">
            <ExternalLink size={13} />
          </button>
        )}
      </div>

      <label className="insp-label">Notes</label>
      <TextField multiline value={block.notes} placeholder="Optional notes" onCommit={(notes) => upd({ notes }, "Edit notes")} />

      <div className="insp-tools">
        <button className="icon-btn" title="Duplicate (Ctrl D)" onClick={() => void A.duplicateBlock(block.id)}>
          <CopyPlus size={14} />
        </button>
        <button className="icon-btn" title="Split in half (X)" onClick={() => void A.splitBlock(block.id)}>
          <Scissors size={14} />
        </button>
        <button className="icon-btn" title="Merge with adjacent block" disabled={!canMerge} onClick={() => void A.mergeBlock(block.id)}>
          <Combine size={14} />
        </button>
        {block.status === "skipped" ? (
          <button className="icon-btn" title="Restore as planned" onClick={() => void A.setBlockStatus(block.id, "planned")}>
            <RotateCcw size={14} />
          </button>
        ) : (
          <button className="icon-btn" title="Skip" onClick={() => void A.setBlockStatus(block.id, "skipped")}>
            <Ban size={14} />
          </button>
        )}
        <span className="spacer" />
        <button className="icon-btn danger" title="Delete (Del)" onClick={() => void A.deleteBlocks([block.id])}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function SessionInspector({ session }: { session: Session }) {
  const categories = useApp((s) => s.categories);
  const blocks = useApp((s) => s.blocks);
  const now = useNow(1000);
  const cat = categories.find((c) => c.id === session.categoryId);
  const running = session.endAt === null;
  const block = session.blockId ? blocks.find((b) => b.id === session.blockId) : undefined;
  const upd = (patch: Partial<Session>, label?: string) => void A.updateSession(session.id, patch, label).catch(A.reportError);
  const end = session.endAt ?? now;
  return (
    <div className="panel-inner insp">
      <InspectorHead color={cat?.color ?? "#888"} label={running ? "Recording now" : "Recorded time"} onClose={() => A.select(null)} />
      <TextField className="insp-title" value={session.title} placeholder={cat?.name ?? "Title"} onCommit={(title) => upd({ title }, "Rename session")} />
      <div className="insp-row">
        <CategorySelect categories={categories} value={session.categoryId} includeArchivedId={session.categoryId} onChange={(categoryId) => upd({ categoryId }, "Change category")} />
      </div>
      <div className="insp-row time-row">
        <span className="muted small">{fmt.full(session.startAt)}</span>
        <div className="time-pair">
          <TimeField label="Start time" value={session.startAt} onCommit={(t) => t < end && t <= Date.now() && upd({ startAt: t }, "Change start")} />
          <span className="muted">–</span>
          {running ? (
            <span className="time-input static">now</span>
          ) : (
            <TimeField label="End time" value={session.endAt!} onCommit={(t) => t > session.startAt && t <= Date.now() && upd({ endAt: t }, "Change end")} />
          )}
          <span className="dur-chip">{running ? fmtClock(end - session.startAt) : fmtDuration(end - session.startAt, { compact: true })}</span>
        </div>
      </div>
      {running && (
        <div className="insp-actions">
          <button className="btn btn-cat wide" style={catVars(cat?.color ?? "#888")} onClick={() => void A.stopTimer()}>
            <Square size={12} fill="currentColor" /> Stop session
          </button>
        </div>
      )}
      {block && (
        <p className="small muted">
          From planned block{" "}
          <button className="link" onClick={() => A.select({ kind: "block", id: block.id })}>
            {block.title || categories.find((c) => c.id === block.categoryId)?.name} · {fmtTime(block.startAt)}–{fmtTime(block.endAt)}
          </button>
        </p>
      )}
      <label className="insp-label">Tags</label>
      <TagInput value={session.tagIds} onChange={(tagIds) => upd({ tagIds }, "Change tags")} />
      <label className="insp-label">Notes</label>
      <TextField multiline value={session.notes} placeholder="Optional notes" onCommit={(notes) => upd({ notes }, "Edit notes")} />
      <div className="insp-meta small muted">
        {session.mode === "manual" ? "Logged manually" : "Recorded with timer"} · {fmtDuration(end - session.startAt)} · {session.tz}
      </div>
      {!running && (
        <div className="insp-tools">
          <span className="spacer" />
          <button className="icon-btn danger" title="Delete recorded time (Del)" onClick={() => void A.deleteSession(session.id)}>
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
