// Diary notes on a recorded session or a planned block, in the details panel: what got done, what was
// learned, ideas, milestones. Add, edit (click), change type, delete.
import { useState } from "react";
import { X } from "lucide-react";
import { ENTRY_KINDS, type EntryKind, type Id, type JournalEntry } from "../domain/types";
import { KIND_ICON, KIND_LABEL } from "../domain/entries";
import { Icon } from "./icons";
import { fmtTime } from "../domain/format";
import { useApp } from "../state/store";
import * as J from "../state/journal";
import { reportError } from "../state/actions";

export function DiaryNotes({ sessionId, blockId, at }: { sessionId?: Id; blockId?: Id; at: number }) {
  const entries = J.useEntries(sessionId ? { sessionId } : { blockId });
  const tf = useApp((s) => s.settings.timeFormat);
  const [kind, setKind] = useState<EntryKind>("accomplishment");
  const [text, setText] = useState("");
  const add = () => {
    if (!text.trim()) return;
    void J.addEntry({ text, kind, at: Math.min(at, Date.now()), sessionId: sessionId ?? null, blockId: blockId ?? null, source: "manual" }).catch(reportError);
    setText("");
  };
  return (
    <div className="diary-notes" aria-label="Diary notes">
      {entries.length > 0 && (
        <ul className="diary-list">
          {entries.map((e) => (
            <EntryRow key={e.id} entry={e} tf={tf} />
          ))}
        </ul>
      )}
      <div className="diary-add">
        <KindPicker value={kind} onChange={setKind} />
        <input
          className="field sm"
          placeholder="What got done, learned, an idea…"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.preventDefault(), add());
            e.stopPropagation();
          }}
          aria-label="Add a diary note"
        />
      </div>
    </div>
  );
}

function KindPicker({ value, onChange }: { value: EntryKind; onChange: (k: EntryKind) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="kind-picker">
      <button className="kind-btn" onClick={() => setOpen((v) => !v)} aria-label={`Note type: ${KIND_LABEL[value]}`} aria-expanded={open} title={KIND_LABEL[value]}>
        <Icon name={KIND_ICON[value]} size={14} />
      </button>
      {open && (
        <ul className="popover kind-menu" role="listbox" aria-label="Note type" onMouseLeave={() => setOpen(false)}>
          {ENTRY_KINDS.map((k) => (
            <li key={k} role="option" aria-selected={k === value} className={k === value ? "on" : ""} onClick={() => (onChange(k), setOpen(false))}>
              <Icon name={KIND_ICON[k]} size={13} /> {KIND_LABEL[k]}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

function EntryRow({ entry, tf }: { entry: JournalEntry; tf: "24h" | "12h" }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(entry.text);
  const commit = () => {
    setEditing(false);
    if (text.trim() !== entry.text) void J.updateEntry(entry, { text }).catch(reportError);
  };
  return (
    <li className={`diary-item kind-${entry.kind}`}>
      <KindPicker value={entry.kind} onChange={(kind) => void J.updateEntry(entry, { kind }).catch(reportError)} />
      {editing ? (
        <input
          className="field sm"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") (setText(entry.text), setEditing(false));
            e.stopPropagation();
          }}
          aria-label="Edit note"
        />
      ) : (
        <button className="diary-text" onClick={() => (setText(entry.text), setEditing(true))} title="Click to edit">
          {entry.text}
        </button>
      )}
      <span className="diary-time muted small">{fmtTime(entry.at, tf)}</span>
      <button className="icon-btn sm diary-del" onClick={() => void J.deleteEntry(entry).catch(reportError)} aria-label="Delete note" title="Delete note">
        <X size={12} />
      </button>
    </li>
  );
}
