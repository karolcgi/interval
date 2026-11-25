import { Repeat } from "lucide-react";
import { useApp } from "../state/store";
import * as A from "../state/actions";
import * as P from "../state/planning";
import type { Block } from "../domain/types";
import { describeRule, formatRule, parseRule, rulePresets, WEEKDAYS, type Weekday } from "../domain/recurrence";
import { fmt } from "../domain/format";
import { parseDayKey, startOfDay } from "../domain/time";

const CHIP_DAYS: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const CHIP_LABEL: Record<Weekday, string> = { MO: "M", TU: "T", WE: "W", TH: "T", FR: "F", SA: "S", SU: "S" };

/** "Repeat" controls in the block inspector. Edits always apply to this block and the ones after it. */
export function RepeatSection({ block }: { block: Block }) {
  const rule = useApp((s) => s.rules.find((r) => r.id === block.recurrenceId) ?? null);
  const presets = rulePresets(startOfDay(block.startAt));
  const current = rule ? presets.find((p) => p.rrule === rule.rrule)?.rrule ?? "custom" : "none";
  const parsed = rule ? parseRule(rule.rrule) : null;
  const run = (p: Promise<unknown>) => void p.catch(A.reportError);

  const onSelect = (v: string) => {
    if (v === "none") return rule && run(P.stopRepeating(block.id));
    if (v === "custom") {
      const wd = WEEKDAYS[new Date(block.startAt).getDay()];
      return run(P.repeatFromBlock(block.id, `FREQ=WEEKLY;BYDAY=${wd}`));
    }
    run(P.repeatFromBlock(block.id, v));
  };

  const toggleDay = (d: Weekday) => {
    if (!parsed) return;
    const days = parsed.byDay.length ? parsed.byDay : [WEEKDAYS[parseDayKey(rule!.startsOn).getDay()]];
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    if (!next.length) return;
    run(P.repeatFromBlock(block.id, formatRule({ ...parsed, freq: "WEEKLY", byDay: next })));
  };

  const dirty = rule ? P.differsFromRule(block, rule) : false;
  const weeklyDays = parsed?.freq === "WEEKLY" ? (parsed.byDay.length ? parsed.byDay : [WEEKDAYS[parseDayKey(rule!.startsOn).getDay()]]) : null;

  return (
    <div className="repeat">
      <div className="repeat-row">
        <Repeat size={13} className="muted" />
        <select className="select sm repeat-select" value={current} onChange={(e) => onSelect(e.target.value)} aria-label="Repeat">
          <option value="none">Doesn’t repeat</option>
          {presets.map((p) => (
            <option key={p.rrule} value={p.rrule}>
              {p.label}
            </option>
          ))}
          <option value="custom">{rule && current === "custom" ? describeRule(rule.rrule, rule.startsOn) : "Custom days…"}</option>
        </select>
      </div>
      {weeklyDays && (
        <div className="day-chips" role="group" aria-label="Repeat on">
          {CHIP_DAYS.map((d) => (
            <button key={d} className={`day-chip ${weeklyDays.includes(d) ? "on" : ""}`} onClick={() => toggleDay(d)} aria-pressed={weeklyDays.includes(d)} title={d}>
              {CHIP_LABEL[d]}
            </button>
          ))}
        </div>
      )}
      {rule && (
        <>
          <div className="repeat-meta muted small">
            {describeRule(rule.rrule, rule.startsOn)} · since {fmt.shortDate(parseDayKey(rule.startsOn).getTime())}
            {rule.endsOn ? ` · until ${fmt.shortDate(parseDayKey(rule.endsOn).getTime())}` : ""}
          </div>
          {dirty && (
            <button className="btn btn-outline sm wide" onClick={() => run(P.repeatFromBlock(block.id, null))} title="Use this block's time, length, category, name and tags for this and all later occurrences">
              Apply changes to following
            </button>
          )}
          <div className="repeat-actions">
            <button className="link-btn" onClick={() => run(P.stopRepeating(block.id))}>
              Stop after this
            </button>
            <button className="link-btn danger" onClick={() => run(P.deleteFollowing(block.id))}>
              Delete this and following
            </button>
          </div>
        </>
      )}
    </div>
  );
}
