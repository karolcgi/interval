// Focus timer engine: the single owner of the timer (Pomodoro, Flowtime, Stopwatch).
//
// Rules
//  * One timer, one state (`store.focus`, persisted as setting `timer.focus`). Other windows (floating
//    mini timer, completion popup, tray) only render a snapshot of it and send commands back here.
//  * Every transition is ONE database transaction: closing/opening sessions, the focus_runs history row,
//    the block status and the persisted timer state. A crash can never leave half a transition behind,
//    and repeating a transition is impossible because the state it starts from is gone once committed.
//  * All engine operations run one at a time (`serial`), so a tick, a click and a tray command can never
//    interleave. Commands from other windows carry the state revision they were issued against and are
//    ignored if the timer has moved on (double clicks, stale popups).
//  * Time comes from stored timestamps. `tick(now)` is idempotent and catches up: a phase is closed at its
//    exact deadline, not when the tick happens.
//  * Sleep: if nothing ran for more than 5 minutes (computer asleep, app closed), a running focus phase is
//    paused at the last moment Interval was alive, so time away is never recorded as focus. A break simply
//    ends, and the next round is not started automatically.

import { store, type PausedTimer } from "./store";
import * as repo from "../db/repo";
import * as A from "./actions";
import type { Statement } from "../db/driver";
import type { Block, FocusRun, Id, Session, SessionMode } from "../domain/types";
import { currentTimeZone, MINUTE } from "../domain/time";
import { fmtDuration } from "../domain/format";
import {
  activeAt,
  breakKindAfter,
  deadlineOf,
  derive,
  flowtimeBreakMinutes,
  isActivePhase,
  type CompletedPhase,
  type FocusKind,
  type FocusState,
  type PomodoroPreset,
} from "../domain/focus";
import { notify } from "../notify";

export const SLEEP_GAP = 5 * MINUTE;
const HEARTBEAT_KEY = "timer.heartbeat";

// ------------------------------------------------------------------------------------ events

export type FocusEventType = "focusStart" | "focusEnd" | "breakStart" | "breakEnd" | "cycleEnd";
export interface FocusEvent {
  type: FocusEventType;
  at: number;
  auto: boolean; // caused by the timer itself (not a click)
  live: boolean; // happened just now (not a catch-up after sleep or restart)
}

type Listener = (events: FocusEvent[], state: FocusState | null) => void;
const listeners = new Set<Listener>();
/** Sounds, notifications and the completion popup subscribe here (main window only). */
export function onFocusEvents(fn: Listener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

// -------------------------------------------------------------------------------------- lock

let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

/** Resolves once every queued engine operation has finished (tests, shutdown). */
export function settled(): Promise<void> {
  return chain.then(() => {});
}

// ---------------------------------------------------------------------------------- settings

export function presetFromSettings(): PomodoroPreset {
  const s = store.get().settings;
  return { focus: s.pomodoroFocus, brk: s.pomodoroBreak, long: s.pomodoroLongBreak, every: Math.max(1, s.pomodoroLongEvery) };
}

function breakCategoryId(): Id | undefined {
  const { settings, categories } = store.get();
  const chosen = categories.find((c) => c.id === settings.breakCategoryId && !c.archivedAt);
  return (chosen ?? categories.find((c) => c.isBreak && !c.archivedAt))?.id;
}

// ----------------------------------------------------------------------------------- the Tx

type Target = { blockId?: Id | null; categoryId?: Id; tagIds?: Id[]; title?: string | null };
type Resolved = { categoryId: Id; tagIds: Id[]; title: string | null; blockId: Id | null };
type SegmentSpec = Resolved & { mode: SessionMode };

async function findBlock(id: Id): Promise<Block | null> {
  const s = store.get();
  return s.blocks.find((b) => b.id === id) ?? s.today.blocks.find((b) => b.id === id) ?? (await repo.getBlock(s.db!, id));
}

/** Collects one transition's writes; `commit` applies them in a single transaction. */
class Tx {
  private sessions = new Map<Id, { before: Session | null; after: Session | null }>();
  private blocks = new Map<Id, { before: Block; after: Block }>();
  extra: Statement[] = [];
  events: FocusEvent[] = [];
  running: Session | null;
  paused: PausedTimer | null;
  acc: number;
  lastClosed: Session | null = null;

  constructor(
    readonly at: number,
    readonly auto = false,
    readonly live = true,
  ) {
    const s = store.get();
    this.running = s.running;
    this.paused = s.paused;
    this.acc = s.runAccumulatedMs;
  }

  private putSession(before: Session | null, after: Session | null) {
    const id = (after ?? before)!.id;
    const prev = this.sessions.get(id);
    this.sessions.set(id, { before: prev ? prev.before : before, after });
  }

  /** End the running segment at `at`. */
  closeSegment(at: number) {
    const r = this.running;
    if (!r) return;
    const closed = { ...r, endAt: Math.max(at, r.startAt), updatedAt: Date.now() };
    this.putSession(r, closed);
    this.lastClosed = closed;
    this.running = null;
  }

  openSegment(at: number, spec: SegmentSpec) {
    const now = Date.now();
    const s: Session = { id: repo.newId(), startAt: at, endAt: null, tz: currentTimeZone(), categoryId: spec.categoryId, blockId: spec.blockId, title: spec.title, notes: null, mode: spec.mode, tagIds: spec.tagIds, createdAt: now, updatedAt: now };
    this.putSession(null, s);
    this.running = s;
  }

  updateRunning(patch: Partial<Session>) {
    const r = this.running;
    if (!r) return;
    const next = { ...r, ...patch, updatedAt: Date.now() };
    this.putSession(r, next);
    this.running = next;
  }

  deleteSession(s: Session) {
    this.putSession(s, null);
    if (this.running?.id === s.id) this.running = null;
  }

  async blockStatus(blockId: Id | null, status: Block["status"]) {
    if (!blockId) return;
    const prev = this.blocks.get(blockId);
    const before = prev?.before ?? (await findBlock(blockId));
    if (!before) return;
    if (!prev && before.status === status) return;
    this.blocks.set(blockId, { before, after: { ...(prev?.after ?? before), status, updatedAt: Date.now() } });
  }

  run(f: FocusState, at: number, outcome: FocusRun["outcome"], extra: Partial<FocusRun> = {}) {
    if (!f.runId || !isActivePhase(f)) return;
    const now = Date.now();
    const row: FocusRun = {
      id: f.runId,
      cycleId: f.cycleId,
      kind: f.kind,
      phase: f.phase === "focus" ? "focus" : f.breakKind === "long" ? "long_break" : "short_break",
      round: f.phase === "focus" ? f.round + 1 : Math.max(1, f.round),
      startedAt: f.phaseStart,
      endedAt: outcome ? at : null,
      plannedMs: f.phaseMs,
      activeMs: activeAt(f, at),
      outcome,
      endsCycle: false,
      categoryId: f.phase === "focus" ? f.categoryId : (breakCategoryId() ?? null),
      blockId: f.phase === "focus" ? f.blockId : null,
      createdAt: now,
      updatedAt: now,
      ...extra,
    };
    this.extra.push(repo.upsertFocusRunStmt(row));
  }

  deleteRun(id: Id | null) {
    if (id) this.extra.push(repo.deleteFocusRunStmt(id));
  }

  event(type: FocusEventType, at = this.at) {
    this.events.push({ type, at, auto: this.auto, live: this.live });
  }

  async commit(focus: FocusState | null) {
    const prevRev = store.get().focus?.rev ?? 0;
    const next = focus ? derive({ ...focus, rev: Math.max(prevRev, focus.rev) + 1 }) : null;
    const changes: A.Change[] = [
      ...[...this.blocks.values()].map((c) => ({ type: "block" as const, before: c.before, after: c.after })),
      ...[...this.sessions.values()].filter((c) => c.before || c.after).map((c) => ({ type: "session" as const, before: c.before, after: c.after })),
    ];
    const statements = [
      ...this.extra,
      repo.setSettingStmt("timer.focus", next),
      repo.setSettingStmt("timer.paused", this.paused),
      repo.setSettingStmt("timer.accumulated", this.acc),
      repo.setSettingStmt(HEARTBEAT_KEY, Math.max(this.at, Date.now())),
    ];
    await A.commitTimer(changes, statements, { focus: next, paused: this.paused, runAccumulatedMs: this.acc });
    store.set({ lastAlive: Math.max(store.get().lastAlive ?? 0, Date.now()) });
    if (this.events.length) listeners.forEach((l) => l(this.events, next));
    return next;
  }
}

async function resolveTarget(t: Target): Promise<Resolved | null> {
  const s = store.get();
  const block = t.blockId ? await findBlock(t.blockId) : null;
  const categoryId = t.categoryId ?? block?.categoryId ?? s.categories.find((c) => !c.archivedAt && !c.isBreak)?.id;
  if (!categoryId) return null;
  return {
    categoryId,
    tagIds: t.tagIds ?? block?.tagIds ?? [],
    title: t.title !== undefined ? t.title : (block?.title ?? null),
    blockId: block?.id ?? null,
  };
}

const target = (f: FocusState): Resolved => ({ categoryId: f.categoryId, tagIds: f.tagIds, title: f.title, blockId: f.blockId });

// ------------------------------------------------------------------------------ transitions

/** End whatever is active (a new timer starts, or the user stops). */
async function endActive(tx: Tx, f: FocusState | null, at: number, outcome: FocusRun["outcome"]) {
  if (f && isActivePhase(f)) tx.run(f, at, outcome);
  const blockId = f?.blockId ?? tx.running?.blockId ?? tx.paused?.blockId ?? null;
  tx.closeSegment(at);
  await tx.blockStatus(blockId, "completed");
  tx.paused = null;
  tx.acc = 0;
}

async function openFocus(tx: Tx, f: FocusState, at: number): Promise<FocusState> {
  const next: FocusState = {
    ...f,
    phase: "focus",
    runId: repo.newId(),
    phaseStart: at,
    phaseMs: f.kind === "pomodoro" ? f.preset.focus * MINUTE : null,
    activeMs: 0,
    segStart: at,
    breakKind: null,
    suggestedBreakMin: null,
    recorded: true,
  };
  tx.openSegment(at, { ...target(f), mode: f.kind });
  tx.paused = null;
  tx.acc = 0;
  await tx.blockStatus(f.blockId, "in_progress");
  tx.run(next, at, null);
  tx.event("focusStart", at);
  return next;
}

function openBreak(tx: Tx, f: FocusState, at: number, minutes: number): FocusState {
  const cat = breakCategoryId();
  const recorded = store.get().settings.focusRecordBreaks && !!cat;
  if (recorded) tx.openSegment(at, { categoryId: cat!, tagIds: [], title: null, blockId: null, mode: f.kind });
  tx.paused = null;
  tx.acc = 0;
  const next: FocusState = { ...f, phase: "break", runId: repo.newId(), phaseStart: at, phaseMs: minutes * MINUTE, activeMs: 0, segStart: at, recorded, suggestedBreakMin: null };
  tx.run(next, at, null);
  tx.event("breakStart", at);
  return next;
}

/** A focus phase ends (deadline reached, skipped, or Flowtime stop). */
async function completeFocus(tx: Tx, f: FocusState, at: number, outcome: "completed" | "skipped", opts: { noAutoBreak?: boolean } = {}): Promise<FocusState | null> {
  const activeMs = activeAt(f, at);
  tx.closeSegment(at);
  const round = f.round + 1;
  const cycleDone = f.kind === "pomodoro" && round % Math.max(1, f.preset.every) === 0;
  tx.run(f, at, outcome, { activeMs, endsCycle: cycleDone });
  if (f.kind === "stopwatch") {
    await tx.blockStatus(f.blockId, "completed");
    return null;
  }
  const breakKind = f.kind === "pomodoro" ? breakKindAfter(f.preset, round) : "short";
  const minutes = f.kind === "pomodoro" ? (breakKind === "long" ? f.preset.long : f.preset.brk) : flowtimeBreakMinutes(activeMs);
  const completed: CompletedPhase = { phase: "focus", runId: f.runId!, breakKind, activeMs, phaseMs: f.phaseMs, at, outcome, sessionId: tx.lastClosed?.id ?? null, cycleDone, round, cycleId: f.cycleId };
  tx.event(cycleDone ? "cycleEnd" : "focusEnd", at);
  const base: FocusState = { ...f, round, breakKind, completed, suggestedBreakMin: minutes };
  if (f.kind === "pomodoro" && store.get().settings.focusAutoBreak && !opts.noAutoBreak) return openBreak(tx, base, at, minutes);
  return { ...base, phase: "suggest", runId: null, phaseStart: at, phaseMs: null, activeMs: 0, segStart: null };
}

/** A break ends (deadline reached or skipped). */
async function completeBreak(tx: Tx, f: FocusState, at: number, outcome: "completed" | "skipped", opts: { forceFocus?: boolean; noAuto?: boolean } = {}): Promise<FocusState | null> {
  const activeMs = activeAt(f, at);
  tx.closeSegment(at);
  tx.run(f, at, outcome, { activeMs });
  const completed: CompletedPhase = { phase: "break", runId: f.runId!, breakKind: f.breakKind, activeMs, phaseMs: f.phaseMs, at, outcome, sessionId: tx.lastClosed?.id ?? null, cycleDone: false, round: f.round, cycleId: f.cycleId };
  tx.event("breakEnd", at);
  const auto = opts.forceFocus || (!opts.noAuto && store.get().settings.focusAutoFocus);
  const long = f.kind === "pomodoro" && f.breakKind === "long";
  const base: FocusState = { ...f, completed, segStart: null, activeMs: 0, phaseMs: null, runId: null, phaseStart: at };
  if (auto) {
    const fresh = long ? { ...base, round: 0, cycleId: repo.newId() } : base;
    return openFocus(tx, fresh, at);
  }
  if (long) return { ...base, phase: "done" };
  return { ...base, phase: "ready" };
}

function pauseInTx(tx: Tx, f: FocusState, at: number): FocusState {
  const r = tx.running;
  tx.closeSegment(at);
  tx.paused = r ? { categoryId: r.categoryId, blockId: r.blockId, tagIds: r.tagIds, title: r.title, pausedAt: at, accumulatedMs: tx.acc + Math.max(0, at - r.startAt) } : null;
  const next = { ...f, activeMs: activeAt(f, at), segStart: null };
  tx.run(next, at, null);
  return next;
}

// ------------------------------------------------------------------------------- operations

async function startImpl(kind: FocusKind, t: Target = {}, preset: PomodoroPreset = presetFromSettings(), at = Date.now()): Promise<void> {
  const s = store.get();
  const tgt = await resolveTarget(t);
  if (!tgt) return A.toast("Create a category first");
  const tx = new Tx(at);
  const f0 = s.focus;
  // Starting again on the same block keeps it in progress; anything else ends the previous timer.
  await endActive(tx, f0, at, f0?.phase === "focus" && f0.kind !== "pomodoro" ? "completed" : "stopped");
  const f: FocusState = {
    kind,
    phase: "focus",
    preset,
    cycleId: repo.newId(),
    runId: null,
    rev: f0?.rev ?? 0,
    round: 0,
    breakKind: null,
    phaseStart: at,
    phaseMs: null,
    activeMs: 0,
    segStart: at,
    phaseEnd: null,
    pausedRemaining: null,
    suggestedBreakMin: null,
    recorded: true,
    completed: null,
    ...tgt,
  };
  await tx.commit(await openFocus(tx, f, at));
}
export const start = (kind: FocusKind, t: Target = {}, preset: PomodoroPreset = presetFromSettings(), at = Date.now()) => serial(() => startImpl(kind, t, preset, at));

export const startPomodoro = (t: Target = {}, preset: PomodoroPreset = presetFromSettings()) => start("pomodoro", t, preset);
export const startFlowtime = (t: Target = {}) => start("flowtime", t);
export const startStopwatch = (t: Target = {}) => start("stopwatch", t);

async function pauseImpl(at = Date.now()): Promise<void> {
  const f = store.get().focus;
  const tx = new Tx(at);
  if (!f) {
    // A session started by an older version with no timer state: pause it as a stopwatch.
    const r = tx.running;
    if (!r) return;
    const legacy: FocusState = { ...legacyStopwatch(r.startAt, r), activeMs: tx.acc, segStart: r.startAt };
    return void (await tx.commit(pauseInTx(tx, legacy, at)));
  }
  if (!isActivePhase(f) || f.segStart === null) return;
  await tx.commit(pauseInTx(tx, f, at));
}
export const pause = (at = Date.now()) => serial(() => pauseImpl(at));

async function resumeImpl(at = Date.now()): Promise<void> {
  const s = store.get();
  let f = s.focus;
  const tx = new Tx(at);
  if (!f && s.paused) f = { ...legacyStopwatch(at, s.paused), activeMs: s.paused.accumulatedMs, segStart: null };
  if (!f || !isActivePhase(f) || f.segStart !== null) return;
  const acc = s.paused?.accumulatedMs ?? f.activeMs;
  if (f.phase === "focus") tx.openSegment(at, { ...target(f), mode: f.kind });
  else if (f.recorded) {
    const cat = s.paused?.categoryId ?? breakCategoryId();
    if (cat) tx.openSegment(at, { categoryId: cat, tagIds: [], title: null, blockId: null, mode: f.kind });
  }
  tx.paused = null;
  tx.acc = acc;
  const next = { ...f, segStart: at };
  tx.run(next, at, null);
  await tx.commit(next);
}
export const resume = (at = Date.now()) => serial(() => resumeImpl(at));

function legacyStopwatch(at: number, src: { categoryId: Id; tagIds: Id[]; title: string | null; blockId: Id | null }): FocusState {
  return {
    kind: "stopwatch",
    phase: "focus",
    preset: presetFromSettings(),
    cycleId: repo.newId(),
    runId: repo.newId(),
    rev: 0,
    round: 0,
    breakKind: null,
    phaseStart: at,
    phaseMs: null,
    activeMs: 0,
    segStart: at,
    phaseEnd: null,
    pausedRemaining: null,
    suggestedBreakMin: null,
    recorded: true,
    completed: null,
    categoryId: src.categoryId,
    tagIds: src.tagIds,
    title: src.title,
    blockId: src.blockId,
  };
}

/** Stop: Flowtime suggests a break; everything else ends and records the time so far. */
async function stopImpl(at = Date.now()): Promise<void> {
  const s = store.get();
  const f = s.focus;
  const tx = new Tx(at);
  if (f?.phase === "focus" && f.kind === "flowtime") {
    return void (await tx.commit(await completeFocus(tx, f, at, "completed")));
  }
  const recorded = f && isActivePhase(f) && f.phase === "focus" ? activeAt(f, at) : !f && s.running ? s.runAccumulatedMs + (at - s.running.startAt) : null;
  const outcome = f?.phase === "focus" && f.kind === "stopwatch" ? "completed" : "stopped";
  if (!f && !s.running && !s.paused) return;
  await endActive(tx, f, at, outcome);
  await tx.commit(null);
  if (recorded !== null && recorded >= 30_000) A.toast(`Recorded ${Math.round(recorded / MINUTE)} min`);
}
export const stop = (at = Date.now()) => serial(() => stopImpl(at));

/**
 * Abandon: throw the current focus phase or break away as if it never ran. Its sessions (every segment
 * since the phase started, across pauses) and its focus-history row are deleted, and a linked block goes
 * back to planned. Earlier rounds of the cycle stay recorded.
 */
async function abandonImpl(at = Date.now()): Promise<void> {
  const s = store.get();
  const f = s.focus;
  const tx = new Tx(at);
  if (f && isActivePhase(f)) {
    const db = s.db;
    const mode: SessionMode = f.kind;
    const inPhase = db ? (await repo.listSessions(db, f.phaseStart, at + 1)).filter((x) => x.startAt >= f.phaseStart && x.mode === mode) : [];
    for (const x of inPhase) tx.deleteSession(x);
    if (tx.running && tx.running.startAt >= f.phaseStart) tx.deleteSession(tx.running);
    tx.deleteRun(f.runId);
    if (f.phase === "focus") await tx.blockStatus(f.blockId, "planned");
  } else if (!f && (s.running || s.paused)) {
    if (s.running) tx.deleteSession(s.running);
    await tx.blockStatus(s.running?.blockId ?? s.paused?.blockId ?? null, "planned");
  } else return;
  tx.running = null;
  tx.paused = null;
  tx.acc = 0;
  await tx.commit(null);
  A.toast("Session discarded · nothing recorded");
}
export const abandon = (at = Date.now()) => serial(() => abandonImpl(at));

/** Set the length of the running countdown phase (or of the next Pomodoro focus round when idle). */
async function setLengthImpl(minutes: number, at = Date.now()): Promise<void> {
  const m = Math.max(1, Math.min(600, Math.round(minutes)));
  const f = store.get().focus;
  if (f && isActivePhase(f) && f.phaseMs !== null) {
    const tx = new Tx(at);
    const next = { ...f, phaseMs: m * MINUTE };
    tx.run(next, at, null);
    await tx.commit(next);
    return;
  }
  if (!f || !isActivePhase(f)) await A.updateSettings({ pomodoroFocus: m });
}
export const setLength = (minutes: number, at = Date.now()) => serial(() => setLengthImpl(minutes, at));

/** Restart the current phase from its full length (time so far stays recorded). Idle/waiting: clear the cycle. */
async function resetImpl(at = Date.now()): Promise<void> {
  const f = store.get().focus;
  if (!f) return;
  const tx = new Tx(at);
  if (!isActivePhase(f)) {
    await tx.blockStatus(f.blockId, "completed");
    return void (await tx.commit(null));
  }
  tx.run(f, at, "stopped");
  tx.closeSegment(at);
  const length = f.phase === "focus" ? (f.kind === "pomodoro" ? f.preset.focus * MINUTE : null) : (f.breakKind === "long" ? f.preset.long : f.preset.brk) * MINUTE;
  const next: FocusState = { ...f, runId: repo.newId(), phaseStart: at, phaseMs: f.kind === "flowtime" && f.phase === "break" ? f.phaseMs : length, activeMs: 0, segStart: at };
  if (f.phase === "focus") tx.openSegment(at, { ...target(f), mode: f.kind });
  else if (f.recorded) {
    const cat = breakCategoryId();
    if (cat) tx.openSegment(at, { categoryId: cat, tagIds: [], title: null, blockId: null, mode: f.kind });
  }
  tx.paused = null;
  tx.acc = 0;
  tx.run(next, at, null);
  await tx.commit(next);
}
export const reset = (at = Date.now()) => serial(() => resetImpl(at));

/** Skip the current phase: focus -> break, break -> next focus round, waiting -> next phase now. */
async function skipImpl(at = Date.now()): Promise<void> {
  const f = store.get().focus;
  if (!f || f.kind === "stopwatch") return;
  const tx = new Tx(at);
  if (f.phase === "focus") return void (await tx.commit(await completeFocus(tx, f, at, f.kind === "flowtime" ? "completed" : "skipped")));
  if (f.phase === "break") return void (await tx.commit(await completeBreak(tx, f, at, "skipped", { forceFocus: true })));
  if (f.phase === "suggest") return void (await tx.commit(await nextRoundInTx(tx, f, at)));
  await tx.commit(await nextRoundInTx(tx, f, at));
}
export const skip = (at = Date.now()) => serial(() => skipImpl(at));

async function nextRoundInTx(tx: Tx, f: FocusState, at: number) {
  const newCycle = f.phase === "done" || (f.phase === "ready" && f.breakKind === "long" && f.kind === "pomodoro");
  return openFocus(tx, newCycle ? { ...f, round: 0, cycleId: repo.newId(), completed: null } : f, at);
}

/** Add minutes to the running (or paused) countdown. */
async function extendImpl(minutes: number, at = Date.now()): Promise<void> {
  const f = store.get().focus;
  if (!f || !isActivePhase(f) || f.phaseMs === null) return;
  const tx = new Tx(at);
  const next = { ...f, phaseMs: f.phaseMs + minutes * MINUTE };
  tx.run(next, at, null);
  await tx.commit(next);
}
export const extend = (minutes: number, at = Date.now()) => serial(() => extendImpl(minutes, at));

/**
 * "Extend focus by 5 minutes" after a focus round ended, or "Extend break" after a break ended.
 * Continues the finished phase. If the next phase already started by itself and nothing happened in
 * it yet, it is withdrawn and the finished phase continues seamlessly from where it ended.
 */
async function extendCompletedImpl(minutes: number, at = Date.now()): Promise<void> {
  const f = store.get().focus;
  const c = f?.completed;
  if (!f || !c) return;
  const tx = new Tx(at);
  const autoStarted = isActivePhase(f) && f.phase !== c.phase && f.phaseStart === c.at && f.activeMs === 0;
  if (isActivePhase(f) && !autoStarted) return;
  let resumeAt = at;
  if (autoStarted) {
    if (tx.running && tx.running.startAt === c.at) tx.deleteSession(tx.running);
    else tx.closeSegment(at);
    tx.deleteRun(f.runId);
    resumeAt = c.at;
  }
  const reopened: FocusState = {
    ...f,
    phase: c.phase,
    runId: c.runId,
    cycleId: c.cycleId,
    round: c.phase === "focus" ? c.round - 1 : c.round,
    breakKind: c.phase === "focus" ? null : c.breakKind,
    phaseStart: c.at - c.activeMs,
    phaseMs: c.activeMs + minutes * MINUTE,
    activeMs: c.activeMs,
    segStart: resumeAt,
    suggestedBreakMin: null,
    completed: null,
    recorded: c.phase === "focus" ? true : store.get().settings.focusRecordBreaks && !!breakCategoryId(),
  };
  if (c.phase === "focus") {
    tx.openSegment(resumeAt, { ...target(f), mode: f.kind });
    await tx.blockStatus(f.blockId, "in_progress");
  } else if (reopened.recorded) {
    tx.openSegment(resumeAt, { categoryId: breakCategoryId()!, tagIds: [], title: null, blockId: null, mode: f.kind });
  }
  tx.paused = null;
  tx.acc = c.activeMs;
  tx.run(reopened, at, null, { endsCycle: false });
  await tx.commit(reopened);
}
export const extendCompleted = (minutes: number, at = Date.now()) => serial(() => extendCompletedImpl(minutes, at));

/** Start the suggested break (auto-start breaks off, or after a Flowtime stop). */
async function startBreakImpl(at = Date.now()): Promise<void> {
  const f = store.get().focus;
  if (!f || f.phase !== "suggest") return;
  const tx = new Tx(at);
  await tx.commit(openBreak(tx, { ...f, breakKind: f.breakKind ?? "short" }, at, f.suggestedBreakMin ?? 5));
}
export const startBreak = (at = Date.now()) => serial(() => startBreakImpl(at));

/** Start the next focus round (after a break, or skipping the break). */
async function nextRoundImpl(at = Date.now()): Promise<void> {
  const f = store.get().focus;
  if (!f || isActivePhase(f)) return;
  const tx = new Tx(at);
  await tx.commit(await nextRoundInTx(tx, f, at));
}
export const nextRound = (at = Date.now()) => serial(() => nextRoundImpl(at));

/**
 * Finish the session / cycle. A break that started by itself a moment ago (under a minute, never paused)
 * is withdrawn instead of being recorded.
 */
async function finishImpl(at = Date.now()): Promise<void> {
  const f = store.get().focus;
  if (!f) return;
  const tx = new Tx(at);
  const freshBreak = f.phase === "break" && f.completed?.at === f.phaseStart && f.activeMs === 0 && f.segStart !== null && at - f.segStart < MINUTE;
  if (freshBreak) {
    if (tx.running) tx.deleteSession(tx.running);
    tx.deleteRun(f.runId);
    await tx.blockStatus(f.blockId, "completed");
    tx.paused = null;
    tx.acc = 0;
  } else {
    await endActive(tx, f, at, f.phase === "focus" && f.kind === "pomodoro" ? "stopped" : "completed");
  }
  await tx.commit(null);
}
export const finish = (at = Date.now()) => serial(() => finishImpl(at));

/** Clear a waiting/completed state without starting anything. */
async function dismissImpl(): Promise<void> {
  const f = store.get().focus;
  if (!f || isActivePhase(f)) return;
  const tx = new Tx(Date.now());
  await tx.blockStatus(f.blockId, "completed");
  await tx.commit(null);
}
export const dismiss = () => serial(() => dismissImpl());

/** Change what the timer is about (category, tags, name, block) for the running phase and later rounds. */
type TargetPatch = { categoryId?: Id; tagIds?: Id[]; title?: string | null; blockId?: Id | null };
export const setTarget = (patch: TargetPatch) => serial(() => setTargetImpl(patch));
function setTargetImpl(patch: TargetPatch): Promise<void> {
  return (async () => {
    const s = store.get();
    const f = s.focus;
    const r = s.running;
    const current: Resolved | null = f ? target(f) : r ? { categoryId: r.categoryId, tagIds: r.tagIds, title: r.title, blockId: r.blockId } : null;
    if (!current) return;
    const tx = new Tx(Date.now());
    const merged: Resolved = { ...current, ...patch };
    if (patch.blockId !== undefined && patch.blockId !== current.blockId) {
      const b = patch.blockId ? await findBlock(patch.blockId) : null;
      if (b) Object.assign(merged, { categoryId: patch.categoryId ?? b.categoryId, tagIds: patch.tagIds ?? b.tagIds, title: patch.title !== undefined ? patch.title : b.title });
      const old = current.blockId ? await findBlock(current.blockId) : null;
      if (old?.status === "in_progress") await tx.blockStatus(old.id, "planned");
      if (b && (!f || isActivePhase(f))) await tx.blockStatus(b.id, "in_progress");
    }
    if (tx.running && (!f || f.phase === "focus")) tx.updateRunning(merged);
    const next = f ? { ...f, ...merged } : null;
    if (next && isActivePhase(next)) tx.run(next, tx.at, null);
    await tx.commit(next);
  })();
}

// ------------------------------------------------------------------------- old entry points

export const startSuggestedBreak = startBreak;
/** Skip or cut short a break. Pomodoro and Flowtime go straight into the next round. */
export const skipBreak = (at = Date.now()) => skip(at);
/** End the whole cycle. */
export const endFocus = (at = Date.now()) => finish(at);
export const focusUserStop = (at: number) => stop(at);

export async function setFocusState(f: FocusState | null) {
  const d = store.get().db;
  if (d) await d.batch([repo.setSettingStmt("timer.focus", f)]);
  store.set({ focus: f });
}

// ------------------------------------------------------------------------------------- tick

const reminded = new Set<Id>();
let lastHeartbeatWrite = 0;

/**
 * Applies every transition due at `now` (idempotent; safe to call any number of times, from any
 * trigger: the 1-second interval, a wake-up from the desktop shell, startup).
 */
export function tick(now = Date.now()) {
  return serial(async () => {
    const s0 = store.get();
    if (!s0.ready || !s0.db) return;
    try {
      const last = s0.lastAlive ?? now;
      store.set({ lastAlive: Math.max(last, now) });
      let f = s0.focus;
      let woke = false;

      // Sleep, a closed app, or a frozen machine: pause focus at the last moment we were alive.
      if (now - last > SLEEP_GAP && f && isActivePhase(f) && f.segStart !== null && f.kind !== "stopwatch") {
        const at = Math.max(last, f.segStart);
        const due = deadlineOf(f);
        woke = true;
        if (f.phase === "focus" && (due === null || due > at)) {
          const tx = new Tx(at, true, false);
          f = await tx.commit(pauseInTx(tx, f, at));
          A.toast(`Paused while you were away (${fmtDuration(now - at)}). Resume when you’re back.`);
        }
      }

      for (let guard = 0; guard < 64; guard++) {
        f = store.get().focus;
        const due = deadlineOf(f);
        if (!f || due === null || now < due) break;
        const tx = new Tx(due, true, now - due < MINUTE && !woke);
        if (f.phase === "focus") await tx.commit(await completeFocus(tx, f, due, "completed"));
        else await tx.commit(await completeBreak(tx, f, due, "completed", { noAuto: woke }));
      }

      const s = store.get();
      if ((s.running || isActivePhase(s.focus)) && Math.abs(now - lastHeartbeatWrite) >= 30_000) {
        lastHeartbeatWrite = now;
        await s.db!.batch([repo.setSettingStmt(HEARTBEAT_KEY, now)]);
      }

      // Stopwatch: a gentle reminder after a long unbroken stretch.
      const mins = s.settings.breakReminderMinutes;
      const r = s.running;
      if (r && (!s.focus || s.focus.kind === "stopwatch") && mins > 0 && !reminded.has(r.id)) {
        const cat = s.categories.find((c) => c.id === r.categoryId);
        const worked = s.focus ? activeAt(s.focus, now) : s.runAccumulatedMs + (now - r.startAt);
        if (!cat?.isBreak && worked >= mins * MINUTE) {
          reminded.add(r.id);
          notify(`${Math.round(worked / MINUTE)} minutes in`, "A short break keeps the next stretch sharp.");
        }
      }
    } catch (e) {
      A.reportError(e);
    }
  });
}

/** Kept for callers of the Phase 2 name. */
export const tickFocus = tick;

/** Startup: continue from the last heartbeat so time while the app was closed is handled like sleep. */
export async function initEngine() {
  const s = store.get();
  if (!s.db) return;
  const hb = await repo.getSetting<number>(s.db, HEARTBEAT_KEY);
  store.set({ lastAlive: hb ?? Date.now() });
}

/**
 * Stopwatch sleep gap (the banner): keep the time, remove the gap, or stop at the last heartbeat.
 */
export function resolveStopwatchGap(choice: "keep" | "exclude" | "stop", gap: { from: number; to: number }) {
  if (choice === "keep") return Promise.resolve();
  if (choice === "stop") return stop(gap.from);
  return serial(async () => {
    const s = store.get();
    const r = s.running;
    if (!r) return;
    const now = Date.now();
    const tx = new Tx(now);
    const f = s.focus;
    const done = s.runAccumulatedMs + Math.max(0, gap.from - r.startAt);
    tx.closeSegment(gap.from);
    tx.openSegment(now, { categoryId: r.categoryId, tagIds: r.tagIds, title: r.title, blockId: r.blockId, mode: r.mode });
    tx.acc = done;
    const next = f && isActivePhase(f) ? { ...f, activeMs: f.activeMs + Math.max(0, gap.from - (f.segStart ?? gap.from)), segStart: now } : f;
    if (next) tx.run(next, now, null);
    await tx.commit(next);
  });
}

// ----------------------------------------------------------------------- cross-window commands

export type TimerCommand =
  | "toggle"
  | "pause"
  | "resume"
  | "stop"
  | "reset"
  | "skip"
  | "extend5"
  | "extend10"
  | "startBreak"
  | "nextRound"
  | "finish"
  | "extendFocus5"
  | "extendBreak5"
  | "dismiss"
  | "abandon"
  | { type: "target"; categoryId?: Id; title?: string | null }
  | { type: "length"; minutes: number }
  | { type: "onTop"; on: boolean }
  | { type: "start"; kind?: FocusKind; categoryId?: Id; title?: string | null };

/**
 * Runs a command sent by another window, the tray or a global shortcut. `rev` is the state revision the
 * sender saw; if the timer has moved on since, the command is dropped (prevents double actions).
 */
export function runCommand(cmd: TimerCommand, rev?: number | null): Promise<void> {
  return serial(async () => {
    const f = store.get().focus;
    if (rev != null && f && rev !== f.rev) return;
    switch (cmd) {
      case "toggle":
        return toggleImpl();
      case "pause":
        return pauseImpl();
      case "resume":
        return resumeImpl();
      case "stop":
        return stopImpl();
      case "reset":
        return resetImpl();
      case "skip":
        return skipImpl();
      case "extend5":
        return extendImpl(5);
      case "extend10":
        return extendImpl(10);
      case "startBreak":
        return startBreakImpl();
      case "nextRound":
        return nextRoundImpl();
      case "finish":
        return finishImpl();
      case "extendFocus5":
      case "extendBreak5":
        return extendCompletedImpl(5);
      case "dismiss":
        return dismissImpl();
      case "abandon":
        return abandonImpl();
    }
    if (typeof cmd === "object") {
      if (cmd.type === "target") return setTargetImpl({ ...(cmd.categoryId ? { categoryId: cmd.categoryId } : {}), ...(cmd.title !== undefined ? { title: cmd.title?.trim() || null } : {}) });
      if (cmd.type === "length") return setLengthImpl(cmd.minutes);
      if (cmd.type === "onTop") return void (await A.updateSettings({ miniOnTop: cmd.on }));
      if (cmd.type === "start") {
        if (f && isActivePhase(f)) return;
        return startImpl(cmd.kind ?? store.get().settings.focusTimerMode, { ...(cmd.categoryId ? { categoryId: cmd.categoryId } : {}), ...(cmd.title ? { title: cmd.title.trim() } : {}) });
      }
    }
  });
}

/** Start / pause / resume / continue, whichever fits. Starts the panel's selected mode when idle. */
async function toggleImpl(): Promise<void> {
  const s = store.get();
  const f = s.focus;
  if (f && isActivePhase(f)) return f.segStart === null ? resumeImpl() : pauseImpl();
  if (!f && s.running) return pauseImpl();
  if (!f && s.paused) return resumeImpl();
  if (f?.phase === "suggest") return startBreakImpl();
  if (f && (f.phase === "ready" || f.phase === "done")) return nextRoundImpl();
  return startImpl(s.settings.focusTimerMode, {});
}
export const toggle = () => serial(() => toggleImpl());
