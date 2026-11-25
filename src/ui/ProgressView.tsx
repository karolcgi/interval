// Progress: lifetime hours per skill (tag) and area (category), milestone levels, weekly streaks,
// achievements (automatic and personal) and records. All derived from recorded sessions.
import { useMemo, useState } from "react";
import { Award, EyeOff, Plus, Trash2 } from "lucide-react";
import { useApp, useNow } from "../state/store";
import * as A from "../state/actions";
import * as repo from "../db/repo";
import { useLifetime } from "../state/lifetime";
import {
  bestWeek,
  capped,
  deepSessions,
  longestSession,
  milestoneProgress,
  targetKey,
  weekStreak,
  type Achievement,
  type DaySeries,
  type Target,
} from "../domain/progression";
import { dayKey, parseDayKey, startOfDay, HOUR } from "../domain/time";
import { fmt, fmtDuration } from "../domain/format";
import type { PersonalAchievement } from "../domain/types";
import { CatDot, catVars } from "./bits";

const LIFETIME_LADDER = [100, 250, 500, 1000, 2500, 5000, 10000];
const h = (ms: number) => {
  const v = ms / HOUR;
  return v >= 100 ? Math.round(v).toLocaleString("en-GB") : (Math.round(v * 10) / 10).toLocaleString("en-GB");
};
const dayLabel = (k: string) => fmt.shortDate(parseDayKey(k).getTime()) + (k.slice(0, 4) !== String(new Date().getFullYear()) ? ` ${k.slice(0, 4)}` : "");

interface Item {
  target: Target;
  name: string;
  color: string;
  series: DaySeries;
}

export function ProgressView() {
  const life = useLifetime();
  const categories = useApp((s) => s.categories);
  const tags = useApp((s) => s.tags);
  const settings = useApp((s) => s.settings);
  const now = useNow(5 * 60_000);
  const [showAll, setShowAll] = useState(false);

  const { skills, areas, hiddenItems } = useMemo(() => {
    const skills: Item[] = [];
    const areas: Item[] = [];
    const hiddenItems: Item[] = [];
    if (!life) return { skills, areas, hiddenItems };
    for (const t of tags) {
      const s = life.ledger.byTag.get(t.id);
      if (!s) continue;
      const it = { target: { type: "tag" as const, id: t.id }, name: t.name, color: "var(--text-3)", series: s };
      (life.hidden.has(targetKey(it.target)) ? hiddenItems : skills).push(it);
    }
    for (const c of categories) {
      if (c.isBreak) continue;
      const s = life.ledger.byCategory.get(c.id);
      if (!s) continue;
      const it = { target: { type: "category" as const, id: c.id }, name: c.parentId ? `${categories.find((p) => p.id === c.parentId)?.name ?? ""} › ${c.name}` : c.name, color: c.color, series: s };
      (life.hidden.has(targetKey(it.target)) || c.archivedAt ? hiddenItems : areas).push(it);
    }
    const total = (x: Item) => [...x.series.values()].reduce((a, b) => a + b, 0);
    skills.sort((a, b) => total(b) - total(a));
    areas.sort((a, b) => total(b) - total(a));
    return { skills, areas, hiddenItems };
  }, [life, tags, categories]);

  if (!life) return <section className="page progress-page"><p className="muted small pad-top">Loading…</p></section>;

  const intentional = capped(life.ledger.intentional, settings.workdayHours * HOUR);
  const lp = milestoneProgress(intentional, LIFETIME_LADDER);
  const active = weekStreak(life.ledger.intentional, now, settings.weekStartsOn, 3 * HOUR);
  const deep = deepSessions(life.ledger).length;
  const hide = (t: Target) => void A.updateSettings({ progressionHidden: [...settings.progressionHidden, targetKey(t)] });
  const unhide = (t: Target) => void A.updateSettings({ progressionHidden: settings.progressionHidden.filter((k) => k !== targetKey(t)) });

  const earned = life.achievements.filter((a) => a.day).sort((a, b) => (a.day! < b.day! ? 1 : -1));
  const next = life.achievements
    .filter((a) => !a.day && a.progress && a.progress.value > 0)
    .sort((a, b) => b.progress!.value / b.progress!.goal - a.progress!.value / a.progress!.goal);

  return (
    <section className="page progress-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Long-term investment</div>
          <h1 className="page-title">Progress</h1>
        </div>
      </header>
      <p className="lede">
        Lifetime hours per skill (tag) and area (category), from your recorded time. Levels follow your milestone ladder ({settings.milestoneHours.join(", ")} h). Streaks count weeks, so rest days never break them.
      </p>

      <div className="kpis prog-kpis">
        <div className="kpi">
          <div className="eyebrow">Intentional hours</div>
          <div className="kpi-val">{h(lp.totalMs)}</div>
          <div className="kpi-sub muted">{lp.nextHours ? `${h(lp.nextHours * HOUR - lp.totalMs)}h to ${lp.nextHours.toLocaleString("en-GB")}` : "every milestone reached"}</div>
        </div>
        <div className="kpi">
          <div className="eyebrow">Consistent weeks</div>
          <div className="kpi-val">{active.current}</div>
          <div className="kpi-sub muted">3h+ a week · longest {active.longest}</div>
        </div>
        <div className="kpi">
          <div className="eyebrow">Deep work sessions</div>
          <div className="kpi-val">{deep.toLocaleString("en-GB")}</div>
          <div className="kpi-sub muted">50 min or longer</div>
        </div>
        <div className="kpi">
          <div className="eyebrow">Since</div>
          <div className="kpi-val">{life.ledger.firstDay ? dayLabel(life.ledger.firstDay) : "–"}</div>
          <div className="kpi-sub muted">{life.ledger.intentional.size} active days</div>
        </div>
      </div>
      <p className="muted small">Intentional hours count everything except breaks, at most {settings.workdayHours}h a day, so long days earn nothing extra.</p>

      <h2 className="section-title">Skills</h2>
      {skills.length === 0 ? <p className="muted small">Tag your sessions (Houdini, Drawing, VEX…) and each tag becomes a skill here.</p> : <SkillList items={skills} onHide={hide} />}

      <h2 className="section-title">Areas</h2>
      {areas.length === 0 ? <p className="muted small">Nothing recorded yet.</p> : <SkillList items={areas} onHide={hide} />}

      <h2 className="section-title">Achievements</h2>
      <div className="ach-grid">
        <div>
          <div className="eyebrow">Earned</div>
          {earned.length === 0 && <p className="muted small">None yet. The first ones arrive at 10 hours of a skill and after 4 consistent weeks.</p>}
          <ul className="ach-list">
            {(showAll ? earned : earned.slice(0, 10)).map((a) => (
              <AchievementRow key={a.id} a={a} />
            ))}
          </ul>
          {earned.length > 10 && (
            <button className="link-btn" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show fewer" : `Show all ${earned.length}`}
            </button>
          )}
        </div>
        <div>
          <div className="eyebrow">Next up</div>
          <ul className="ach-list">
            {next.slice(0, 8).map((a) => (
              <AchievementRow key={a.id} a={a} />
            ))}
          </ul>
        </div>
      </div>

      <PersonalAchievements />

      <Records />

      {hiddenItems.length > 0 && (
        <>
          <h2 className="section-title">Hidden</h2>
          <div className="chips">
            {hiddenItems.map((it) => (
              <button key={targetKey(it.target)} className="chip" onClick={() => unhide(it.target)} title="Show in Progress again">
                <CatDot color={it.color} size={6} /> {it.target.type === "tag" ? "#" : ""}
                {it.name}
              </button>
            ))}
          </div>
          <p className="muted small">Archived categories are always hidden here; their hours still count.</p>
        </>
      )}
    </section>
  );

  function Records() {
    const ls = longestSession(life!.ledger);
    const streaks = [...skills, ...areas].map((it) => ({ it, st: weekStreak(it.series, now, settings.weekStartsOn) })).sort((a, b) => b.st.longest - a.st.longest);
    const best = skills.slice(0, 3).map((it) => ({ it, w: bestWeek(it.series, settings.weekStartsOn) }));
    return (
      <>
        <h2 className="section-title">Records</h2>
        <div className="records">
          {ls && (
            <div className="record">
              <div className="eyebrow">Longest session</div>
              <div className="record-val">{fmtDuration(ls.ms, { compact: true })}</div>
              <div className="muted small">
                {ls.title || categories.find((c) => c.id === ls.categoryId)?.name} · {dayLabel(ls.day)}
              </div>
            </div>
          )}
          {streaks[0] && streaks[0].st.longest > 0 && (
            <div className="record">
              <div className="eyebrow">Longest weekly streak</div>
              <div className="record-val">{streaks[0].st.longest} weeks</div>
              <div className="muted small">
                {streaks[0].it.target.type === "tag" ? "#" : ""}
                {streaks[0].it.name}
                {streaks[0].st.longestEnd ? ` · until ${dayLabel(streaks[0].st.longestEnd)}` : ""}
              </div>
            </div>
          )}
          {best.map(
            ({ it, w }) =>
              w && (
                <div className="record" key={targetKey(it.target)}>
                  <div className="eyebrow">Best week of {it.name}</div>
                  <div className="record-val">{fmtDuration(w.ms, { compact: true })}</div>
                  <div className="muted small">week of {dayLabel(w.start)}</div>
                </div>
              ),
          )}
        </div>
      </>
    );
  }
}

function SkillList({ items, onHide }: { items: Item[]; onHide: (t: Target) => void }) {
  const ladder = useApp((s) => s.settings.milestoneHours);
  const weekStartsOn = useApp((s) => s.settings.weekStartsOn);
  const now = useNow(5 * 60_000);
  return (
    <ul className="skills">
      {items.map((it) => {
        const mp = milestoneProgress(it.series, ladder);
        const st = weekStreak(it.series, now, weekStartsOn);
        const recent = st.weeks.slice(-12);
        return (
          <li key={targetKey(it.target)} className="skill" style={catVars(it.color)}>
            <div className="skill-head">
              <span className="skill-name">
                <CatDot color={it.color} />
                {it.target.type === "tag" ? "#" : ""}
                {it.name}
              </span>
              <span className="skill-level" title={`Level ${mp.level} of ${ladder.length}`}>
                Lv {mp.level}
              </span>
              <span className="grow" />
              <span className="skill-hours">{h(mp.totalMs)}h</span>
              <button className="icon-btn hover-only" onClick={() => onHide(it.target)} title="Hide from Progress" aria-label={`Hide ${it.name}`}>
                <EyeOff size={13} />
              </button>
            </div>
            <div className="skill-bar" role="progressbar" aria-valuenow={Math.round(mp.pctToNext * 100)} aria-label={`${it.name} progress to ${mp.nextHours ?? mp.prevHours} hours`}>
              <span style={{ width: `${mp.pctToNext * 100}%` }} />
            </div>
            <div className="skill-meta muted small">
              <span>{mp.nextHours ? `${h(mp.nextHours * HOUR - mp.totalMs)}h to ${mp.nextHours.toLocaleString("en-GB")}h` : "Ladder complete"}</span>
              {st.current > 1 && <span>{st.current}-week streak</span>}
              <span className="grow" />
              <span className="weeks" title="Last 12 weeks (1h+ counts)">
                {recent.map((w) => (
                  <i key={w.start} className={w.ok ? "ok" : ""} title={`Week of ${dayLabel(w.start)}: ${fmtDuration(w.ms, { compact: true })}`} />
                ))}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AchievementRow({ a }: { a: Achievement }) {
  const p = a.progress;
  return (
    <li className={`ach ${a.day ? "earned" : "locked"}`} style={a.color ? catVars(a.color) : undefined}>
      <Award size={14} className="ach-icon" />
      <div className="ach-body">
        <div className="ach-title">{a.title}</div>
        <div className="muted small">
          {a.day ? dayLabel(a.day) : p ? `${p.unit === "h" ? h(p.value * HOUR) : p.value} of ${p.goal.toLocaleString("en-GB")}${p.unit === "h" ? "h" : ` ${p.unit}`}` : a.detail}
        </div>
        {!a.day && p && (
          <div className="ach-bar">
            <span style={{ width: `${Math.min(100, (p.value / p.goal) * 100)}%` }} />
          </div>
        )}
      </div>
    </li>
  );
}

function PersonalAchievements() {
  const list = useApp((s) => s.achievements);
  const tags = useApp((s) => s.tags);
  const categories = useApp((s) => s.categories);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [day, setDay] = useState(() => dayKey(startOfDay(Date.now())));
  const add = async () => {
    const [type, id] = target ? (target.split(":") as ["tag" | "category", string]) : [null, null];
    const a: PersonalAchievement = { id: repo.newId(), title, note: null, targetType: type, targetId: id, achievedOn: day, createdAt: Date.now() };
    await A.saveAchievement(a);
    setTitle("");
    A.toast("Achievement saved");
  };
  const targetLabel = (a: PersonalAchievement) =>
    a.targetType === "tag" ? `#${tags.find((t) => t.id === a.targetId)?.name ?? "?"}` : a.targetType === "category" ? categories.find((c) => c.id === a.targetId)?.name : null;
  return (
    <>
      <h2 className="section-title">Personal achievements</h2>
      <p className="muted small">Hours are not the same as skill. Record what you actually achieved: a first FLIP sim that held up, a finished short, a client you landed.</p>
      <div className="pa-form">
        <input className="field" placeholder="What did you achieve?" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Achievement" onKeyDown={(e) => e.key === "Enter" && title.trim() && void add().catch(A.reportError)} />
        <select className="field" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Skill or area">
          <option value="">No skill</option>
          <optgroup label="Skills">
            {tags.map((t) => (
              <option key={t.id} value={`tag:${t.id}`}>
                #{t.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Areas">
            {categories
              .filter((c) => !c.isBreak && !c.archivedAt)
              .map((c) => (
                <option key={c.id} value={`category:${c.id}`}>
                  {c.name}
                </option>
              ))}
          </optgroup>
        </select>
        <input className="field" type="date" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Date" />
        <button className="btn btn-outline sm" disabled={!title.trim()} onClick={() => void add().catch(A.reportError)}>
          <Plus size={13} /> Add
        </button>
      </div>
      {list.length > 0 && (
        <ul className="ach-list personal">
          {list.map((a) => (
            <li key={a.id} className="ach earned">
              <Award size={14} className="ach-icon" />
              <div className="ach-body">
                <div className="ach-title">{a.title}</div>
                <div className="muted small">
                  {dayLabel(a.achievedOn)}
                  {targetLabel(a) ? ` · ${targetLabel(a)}` : ""}
                </div>
              </div>
              <button className="icon-btn hover-only" onClick={() => void A.deleteAchievement(a.id).catch(A.reportError)} aria-label={`Delete ${a.title}`}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
