// When a block made from a preset is started and that preset names a focus timer preset, offer it.
// Nothing starts until the user picks.
import { blockTitle } from "../state/blockName";
import { Timer, X } from "lucide-react";
import { useApp } from "../state/store";
import * as A from "../state/actions";
import * as L from "../state/library";
import { catVars } from "./bits";

export function FocusOfferCard() {
  const offer = useApp((s) => s.focusOffer);
  const block = useApp((s) => (offer ? (s.blocks.find((b) => b.id === offer.blockId) ?? s.today.blocks.find((b) => b.id === offer.blockId)) : undefined));
  const fp = useApp((s) => (offer ? s.settings.focusPresets.find((f) => f.id === offer.focusPresetId) : undefined));
  const cat = useApp((s) => (block ? s.categories.find((c) => c.id === block.categoryId) : undefined));
  if (!offer || !fp) return null;
  const go = (c: "preset" | "plain" | "cancel") => void L.answerFocusOffer(c).catch(A.reportError);
  return (
    <div className="focus-offer" role="dialog" aria-label="Focus timer for this block" style={catVars(cat?.color ?? "#888")} onKeyDown={(e) => e.key === "Escape" && go("cancel")}>
      <Timer size={15} className="fo-icon" aria-hidden />
      <div className="fo-text">
        <div className="fo-title">Start {(block && blockTitle(block)) || cat?.name || "this block"}</div>
        <div className="muted small">
          Its preset uses Pomodoro {fp.focus} / {fp.brk}.
        </div>
      </div>
      <button className="btn btn-cat sm" onClick={() => go("preset")} autoFocus>
        Use {fp.focus} / {fp.brk}
      </button>
      <button className="btn btn-ghost sm" onClick={() => go("plain")}>
        Start as usual
      </button>
      <button className="icon-btn sm" onClick={() => go("cancel")} aria-label="Cancel">
        <X size={13} />
      </button>
    </div>
  );
}
