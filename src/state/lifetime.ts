// All-time data for Progress, Reviews and Year in review: every session, loaded once and
// reloaded when recorded time changes. Derivations (ledger, achievements) are memoised.
import { useEffect, useMemo, useState } from "react";
import { store, useApp, useNow } from "./store";
import * as repo from "../db/repo";
import type { Session } from "../domain/types";
import { buildLedger, deriveAchievements, type Achievement, type Ledger } from "../domain/progression";
import { startOfDay } from "../domain/time";

const FAR = Date.UTC(2200, 0, 1);

export function useAllSessions(): Session[] | null {
  const db = useApp((s) => s.db);
  const runningId = useApp((s) => s.running?.id);
  const version = useApp((s) => s.sessions);
  const [all, setAll] = useState<Session[] | null>(null);
  useEffect(() => {
    if (!db) return;
    let alive = true;
    void repo.listSessions(db, 0, FAR).then((s) => alive && setAll(s));
    return () => {
      alive = false;
    };
  }, [db, runningId, version]);
  return all;
}

export interface Lifetime {
  sessions: Session[];
  ledger: Ledger;
  achievements: Achievement[];
  hidden: Set<string>;
}

export function useLifetime(): Lifetime | null {
  const sessions = useAllSessions();
  const categories = useApp((s) => s.categories);
  const tags = useApp((s) => s.tags);
  const settings = useApp((s) => s.settings);
  const now = useNow(5 * 60_000);
  const day = startOfDay(now);
  return useMemo(() => {
    if (!sessions) return null;
    const ledger = buildLedger(sessions, categories, now);
    const hidden = new Set(settings.progressionHidden);
    const achievements = deriveAchievements({
      ledger,
      categories,
      tags,
      ladder: settings.milestoneHours,
      workdayHours: settings.workdayHours,
      weekStartsOn: settings.weekStartsOn,
      now,
      hidden,
    });
    return { sessions, ledger, achievements, hidden };
    // `day` (not `now`) so the derivation reruns when sessions change or the day rolls over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, categories, tags, settings.progressionHidden, settings.milestoneHours, settings.workdayHours, settings.weekStartsOn, day]);
}

/** Non-hook variant for exports: load everything and derive once. */
export async function loadLifetime(now = Date.now()) {
  const s = store.get();
  if (!s.db) return null;
  const sessions = await repo.listSessions(s.db, 0, FAR);
  const ledger = buildLedger(sessions, s.categories, now);
  const achievements = deriveAchievements({
    ledger,
    categories: s.categories,
    tags: s.tags,
    ladder: s.settings.milestoneHours,
    workdayHours: s.settings.workdayHours,
    weekStartsOn: s.settings.weekStartsOn,
    now,
    hidden: new Set(s.settings.progressionHidden),
  });
  return { sessions, ledger, achievements };
}
