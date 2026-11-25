// Realistic demonstration data. Only ever written to the separate demo database
// (see bootstrap.ts), never to the user's real records.

import type { DbDriver, Statement } from "./driver";
import * as repo from "./repo";
import type { Block, Category, Session, Tag } from "../domain/types";
import { addDays, atMinute, startOfDay } from "../domain/time";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Plan {
  cat: string;
  from: number; // minute of day
  to: number;
  title?: string;
  tags?: string[];
}

export async function generateDemoData(db: DbDriver, opts: { days?: number; now?: number; seed?: number } = {}) {
  const days = opts.days ?? 420;
  const now = opts.now ?? Date.now();
  const rand = rng(opts.seed ?? 42);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const jitter = (n: number) => Math.round((rand() - 0.5) * 2 * n / 5) * 5;

  await repo.seedDefaults(db);
  const cats = await repo.listCategories(db);
  const catId = (name: string) => (cats.find((c) => c.name === name) as Category).id;

  const tagNames = ["Houdini", "VEX", "Particles", "Cinema 4D", "Redshift", "After Effects", "Unreal Engine", "Drawing", "Anatomy", "Reading", "Tutorials", "Personal website", "Filmmaking", "Material library", "Client A", "Client B"];
  const ts = Date.now();
  const tags: Tag[] = tagNames.map((name) => ({ id: repo.newId(), name, color: null, archivedAt: null, createdAt: ts }));
  const tagId = (n: string) => tags.find((t) => t.name === n)!.id;
  const stmts: Statement[] = tags.map(repo.upsertTagStmt);

  const today = startOfDay(now);
  for (let i = -days; i <= 7; i++) {
    const day = addDays(today, i);
    const dow = new Date(day).getDay();
    const weekend = dow === 0 || dow === 6;
    if (i < 0 && rand() < 0.06) continue; // occasional day off / holiday
    const client = pick(["Client A", "Client B"]);
    const plans: Plan[] = [];
    if (!weekend) {
      plans.push({ cat: "Freelance work", from: 600, to: 750, title: "Client production", tags: [client, pick(["Cinema 4D", "Redshift", "After Effects", "Houdini"])] });
      plans.push({ cat: "Breaks", from: 750, to: 780, title: "Lunch" });
      plans.push({ cat: "Freelance work", from: 780, to: 900, title: "Client production", tags: [client] });
      if (rand() < 0.8) plans.push({ cat: "Studying", from: 300, to: 420, title: "Houdini studying", tags: ["Houdini", pick(["VEX", "Particles", "Tutorials"])] });
      if (dow === 5) plans.push({ cat: "Administration", from: 900, to: 960, title: "Invoices & email" });
      else if (rand() < 0.5) plans.push({ cat: "Creative research", from: 900, to: 960, tags: [pick(["Reading", "Filmmaking"])] });
    } else {
      if (rand() < 0.7) plans.push({ cat: "Personal art", from: 420, to: 600, title: "Personal piece", tags: [pick(["Drawing", "Anatomy", "Unreal Engine"])] });
      if (rand() < 0.4) plans.push({ cat: "Asset development", from: 660, to: 780, tags: ["Material library"] });
      if (rand() < 0.3) plans.push({ cat: "Personal time", from: 840, to: 960 });
    }
    for (const p of plans) {
      const blockId = repo.newId();
      const startAt = atMinute(day, p.from);
      const endAt = atMinute(day, p.to);
      const isPast = endAt < now;
      const skipped = isPast && rand() < 0.08;
      const block: Block = {
        id: blockId,
        startAt,
        endAt,
        tz: "Europe/Warsaw",
        categoryId: catId(p.cat),
        title: p.title ?? null,
        notes: null,
        link: null,
        status: isPast ? (skipped ? "skipped" : "completed") : "planned",
        recurrenceId: null,
        tagIds: (p.tags ?? []).map(tagId),
        createdAt: startAt - 86_400_000,
        updatedAt: startAt,
      };
      stmts.push(...repo.upsertBlockStmts(block));
      if (isPast && !skipped) {
        const sStart = atMinute(day, p.from + Math.max(0, jitter(15)));
        const sEnd = Math.max(sStart + 10 * 60_000, atMinute(day, p.to + jitter(25)));
        const session: Session = {
          id: repo.newId(),
          startAt: sStart,
          endAt: Math.min(sEnd, now),
          tz: "Europe/Warsaw",
          categoryId: block.categoryId,
          blockId,
          title: block.title,
          notes: null,
          mode: rand() < 0.7 ? "stopwatch" : "manual",
          tagIds: block.tagIds,
          createdAt: sStart,
          updatedAt: sEnd,
        };
        stmts.push(...repo.upsertSessionStmts(session));
      }
    }
    // Some unscheduled actual work
    if (i < 0 && rand() < 0.25) {
      const from = pick([1020, 1080, 1260]);
      const s: Session = {
        id: repo.newId(),
        startAt: atMinute(day, from),
        endAt: atMinute(day, from + 30 + Math.floor(rand() * 4) * 15),
        tz: "Europe/Warsaw",
        categoryId: catId(pick(["Creative research", "Personal art", "Studying"])),
        blockId: null,
        title: null,
        notes: null,
        mode: "stopwatch",
        tagIds: [tagId(pick(["Reading", "Drawing", "Houdini", "Filmmaking"]))],
        createdAt: atMinute(day, from),
        updatedAt: atMinute(day, from),
      };
      stmts.push(...repo.upsertSessionStmts(s));
    }
  }
  await db.batch(stmts);
  return { statements: stmts.length };
}
