// Calendar toolbar control for the weekly template overlay (v0.9: the template is a visual guide only;
// suggestions can't be applied, confirmed or dismissed any more, so this is just the show/hide toggle).
import { Layers } from "lucide-react";
import { useApp } from "../state/store";
import * as A from "../state/actions";

export function TemplateTools() {
  const mode = useApp((s) => s.calendarMode);
  const overlay = useApp((s) => s.settings.templateOverlay);
  const hasTemplate = useApp((s) => s.weekTemplate.length > 0);
  if (!hasTemplate || mode === "month") return null;
  return (
    <button
      className={`icon-btn tpl-toggle ${overlay ? "on" : ""}`}
      onClick={() => void A.updateSettings({ templateOverlay: !overlay }).catch(A.reportError)}
      aria-pressed={overlay}
      aria-label="Show template overlay"
      title={overlay ? "Hide the weekly template overlay" : "Show the weekly template overlay"}
    >
      <Layers size={15} />
    </button>
  );
}
