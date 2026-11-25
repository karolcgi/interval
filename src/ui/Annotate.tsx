// "What did you get done?" after a focus round. Used by the completion popup (its own window: sends a
// command to the main window) and by the docked panel. Optional: ignoring it records nothing.
import { useState } from "react";
import { Check } from "lucide-react";
import { ENTRY_KINDS, type EntryKind } from "../domain/types";
import { KIND_ICON, KIND_LABEL } from "../domain/entries";
import type { CompletedPhase } from "../domain/focus";
import type { TimerCommand } from "../state/focus";

export function AnnotateBox({ completed, send, already = 0, className }: { completed: CompletedPhase; send: (cmd: TimerCommand) => void; already?: number; className?: string }) {
  const [kind, setKind] = useState<EntryKind>("accomplishment");
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(already);
  const save = () => {
    const t = text.trim();
    if (!t) return;
    send({ type: "annotate", text: t, kind, sessionId: completed.sessionId, at: completed.at });
    setSaved((n) => n + 1);
    setText("");
  };
  return (
    <div className={`annotate ${className ?? ""}`}>
      <div className="annotate-row">
        <input
          className="field sm annotate-input"
          placeholder={saved ? "Anything else?" : "What did you get done?"}
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.preventDefault(), save());
            e.stopPropagation(); // typing here must not trigger app shortcuts
          }}
          aria-label="What did you get done?"
        />
        <button className="btn btn-outline sm" onClick={save} disabled={!text.trim()}>
          Save
        </button>
      </div>
      <div className="annotate-kinds" role="radiogroup" aria-label="Note type">
        {ENTRY_KINDS.map((k) => (
          <button key={k} role="radio" aria-checked={k === kind} className={`annotate-kind ${k === kind ? "on" : ""}`} onClick={() => setKind(k)} title={KIND_LABEL[k]}>
            <span aria-hidden>{KIND_ICON[k]}</span>
            <span className="annotate-kind-label">{KIND_LABEL[k]}</span>
          </button>
        ))}
        {saved > 0 && (
          <span className="annotate-saved" role="status">
            <Check size={11} /> {saved === 1 ? "Saved" : `${saved} saved`}
          </span>
        )}
      </div>
    </div>
  );
}
