// v0.12: the optional Task + Project pair for a focus session (Focus panel) or a recorded session (details panel,
// Day log). Choosing a task suggests its project and an activity; both stay optional and can be changed.
import { useApp } from "../state/store";
import { linksForProject, linksForTask, type Links } from "../state/links";
import type { Id } from "../domain/types";
import { LinkPicker } from "./LinkPicker";

export type LinkPatch = Partial<Links> & { categoryId?: Id };

export function SessionLinks({ value, onChange, compact, className = "ftp-links" }: { value: Partial<Links>; onChange: (patch: LinkPatch) => void; compact?: boolean; className?: string }) {
  const on = useApp((s) => s.settings.integration.enabled);
  if (!on) return null;
  return (
    <div className={className}>
      <LinkPicker
        kind="task"
        compact={compact}
        value={value.taskRef ?? null}
        title={value.taskTitle ?? null}
        onPick={(ref) => {
          if (!ref) return onChange({ taskRef: null, taskTitle: null });
          const l = linksForTask(ref);
          onChange({ taskRef: l.taskRef, taskTitle: l.taskTitle, ...(l.projectRef ? { projectRef: l.projectRef, projectTitle: l.projectTitle } : {}), ...(l.categoryId ? { categoryId: l.categoryId } : {}) });
        }}
      />
      <LinkPicker
        kind="project"
        compact={compact}
        value={value.projectRef ?? null}
        title={value.projectTitle ?? null}
        onPick={(ref) => {
          if (!ref) return onChange({ projectRef: null, projectTitle: null });
          const l = linksForProject(ref);
          onChange({ projectRef: l.projectRef, projectTitle: l.projectTitle, ...(l.categoryId && !value.taskRef ? { categoryId: l.categoryId } : {}) });
        }}
      />
    </div>
  );
}
