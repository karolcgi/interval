// Creative diary notes (v0.6): "what did you get done?" when a focus round ends, and notes added later
// to any recorded session or planned block. Stored in `journal_entries`; plain facts the user typed.
import { useEffect, useState } from "react";
import { store, useApp } from "./store";
import * as repo from "../db/repo";
import { reportError, toast } from "./actions";
import type { EntryKind, Id, JournalEntry } from "../domain/types";

const bump = () => store.set({ journalRev: store.get().journalRev + 1 });

export async function addEntry(p: { text: string; kind: EntryKind; at?: number; sessionId?: Id | null; blockId?: Id | null; source?: JournalEntry["source"] }): Promise<JournalEntry | null> {
  const db = store.get().db;
  const text = p.text.trim();
  if (!db || !text) return null;
  const now = Date.now();
  let blockId = p.blockId ?? null;
  if (!blockId && p.sessionId) blockId = (await db.select<{ block_id: string | null }>("SELECT block_id FROM sessions WHERE id = ?", [p.sessionId]))[0]?.block_id ?? null;
  const e: JournalEntry = { id: repo.newId(), at: p.at ?? now, kind: p.kind, text: text.slice(0, 2000), sessionId: p.sessionId ?? null, blockId, source: p.source ?? "manual", createdAt: now, updatedAt: now };
  await db.batch([repo.upsertEntryStmt(e)]);
  bump();
  return e;
}

/** A quick note (floating timer, v0.8): a timestamped line in the day log, linked to the running session if any. */
export async function addQuickNote(text: string, at = Date.now()): Promise<JournalEntry | null> {
  const running = store.get().running;
  const e = await addEntry({ text, kind: "note", at, sessionId: running?.id ?? null, source: "capture" });
  if (e) toast("Note added to the day log");
  return e;
}

export async function updateEntry(e: JournalEntry, patch: Partial<Pick<JournalEntry, "text" | "kind">>) {
  const db = store.get().db;
  if (!db) return;
  const text = (patch.text ?? e.text).trim();
  if (!text) return deleteEntry(e);
  await db.batch([repo.upsertEntryStmt({ ...e, ...patch, text, updatedAt: Date.now() })]);
  bump();
}

export async function deleteEntry(e: JournalEntry) {
  const db = store.get().db;
  if (!db) return;
  await db.batch([repo.deleteEntryStmt(e.id)]);
  bump();
  toast("Note deleted");
}

/** Notes on a session (by id), or on a block (its own notes plus those on sessions recorded against it). */
export function useEntries(target: { sessionId?: Id; blockId?: Id; sessionIds?: Id[] }): JournalEntry[] {
  const db = useApp((s) => s.db);
  const rev = useApp((s) => s.journalRev);
  const [list, setList] = useState<JournalEntry[]>([]);
  const key = JSON.stringify(target);
  useEffect(() => {
    if (!db) return;
    let alive = true;
    void repo
      .listEntriesFor(db, target)
      .then((l) => alive && setList(l))
      .catch(reportError);
    return () => {
      alive = false;
    };
  }, [db, rev, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return list;
}
