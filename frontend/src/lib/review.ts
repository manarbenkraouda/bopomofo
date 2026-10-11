"use client";
// The order of the cards in every practice mode, built for memory (spaced repetition with retrieval practice):
//
// - A small working set of new items (WORKING_SET, about what short-term memory holds). A new item comes in
//   only when there is room, so the same few items come back often enough to stick.
// - Inside a session, an item comes back after a gap of other cards. The gap grows after each right answer
//   (GAPS: 2, then 5 other cards), and the item leaves the working set after 3 right answers in a row.
//   A wrong answer brings it back after 1 other card and starts again.
// - Across days, every item has a level from its past tests. The level sets when the next review is due
//   (STEP_DAYS: 10 minutes, then 1, 3, 7, 16, 35... days). A right answer at the due time moves one level up,
//   a right answer much earlier keeps the level, and a wrong answer goes back to level 0.
// - Each card: an item due again in this session, else a review due from earlier days, else a new item when
//   the working set has room, else the next working item, else extra practice on the item seen least.
//
// Research: Cepeda et al. 2006 (spacing), Roediger & Karpicke 2006 (testing effect),
// Landauer & Bjork 1978 (expanding retrieval), Cowan 2001 (working memory of about 4 items),
// Settles & Meeder 2016 (half-life regression, the spaced repetition of Duolingo).
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export const WORKING_SET = 5;
/** Other cards between two showings of a working item, after 1 and 2 right answers in a row. The 3rd right answer graduates it. */
export const GAPS = [2, 5];
const GAP_WRONG = 1;
const GAP_SKIP = 4;
const DAY = 86400_000;
/** Time until the next review, per level, in days. Level 0: due at once. */
export const STEP_DAYS = [0, 10 / 1440, 1, 3, 7, 16, 35, 80, 180];

/** Long-term memory of one item: its level and the time of its last test (ms). */
export type Mem = { level: number; last: number; n: number };
/** Past tests, oldest first: [time in seconds, 1 if right on the first try without help]. */
export type Past = [number, number][];
export type CardKind = "again" | "review" | "new" | "extra";

export const intervalMs = (level: number) => STEP_DAYS[Math.min(level, STEP_DAYS.length - 1)] * DAY;

/** The memory after one test at time ts (ms). */
export function grow(m: Mem | undefined, good: boolean, ts: number): Mem {
  const cur = m ?? { level: 0, last: 0, n: 0 };
  let level = cur.level;
  if (!good) level = 0;
  else if (level === 0 || ts - cur.last >= 0.5 * intervalMs(level)) level = Math.min(level + 1, STEP_DAYS.length - 1);
  return { level, last: ts, n: cur.n + 1 };
}

export const replay = (past: Past): Mem | undefined => past.reduce<Mem | undefined>((m, [ts, good]) => grow(m, !!good, ts * 1000), undefined);

/** How late the review is: 1 = due now, 2 = twice the planned interval. Level 0 items are always due. */
export const overdue = (m: Mem, now: number) => (m.level === 0 ? Infinity : (now - m.last) / intervalMs(m.level));

type Seen = { due: number; streak: number; n: number; done: boolean; review: boolean };

export type SchedulerOptions = {
  /** Order of new items: "pool" keeps the order of the pool (the alphabet, a coach deck), "shuffle" mixes them once. */
  order?: "pool" | "shuffle";
  size?: number;
  random?: () => number;
  now?: () => number;
};

export class Scheduler {
  mem = new Map<string, Mem>();
  seen = new Map<string, Seen>();
  card = 0;
  last: string | undefined;
  lastKind: CardKind = "new";
  private rank = new Map<string, number>();
  private opts: Required<SchedulerOptions>;

  constructor(opts: SchedulerOptions = {}) {
    this.opts = { order: "shuffle", size: WORKING_SET, random: Math.random, now: Date.now, ...opts };
  }

  /** The past tests from the server. Items already answered in this session keep their newer memory. */
  load(items: Record<string, Past>) {
    for (const [id, past] of Object.entries(items)) {
      if (this.seen.has(id)) continue;
      const m = replay(past);
      if (m) this.mem.set(id, m);
    }
  }

  private rankOf(id: string, i: number) {
    if (this.opts.order === "pool") return i;
    if (!this.rank.has(id)) this.rank.set(id, this.opts.random());
    return this.rank.get(id)!;
  }

  /** The next item of the pool (ids in pool order). */
  next(pool: string[]): string | undefined {
    if (!pool.length) return undefined;
    const ids = [...new Set(pool)];
    const now = this.opts.now();
    this.card += 1;
    const notLast = ids.length > 1 ? ids.filter((id) => id !== this.last) : ids;
    const pick = (id: string, kind: CardKind) => { this.last = id; this.lastKind = kind; return id; };
    const isWorking = (id: string) => { const s = this.seen.get(id); return !!s && !s.done; };
    const working = notLast.filter(isWorking);
    const byDue = (a: string, b: string) => this.seen.get(a)!.due - this.seen.get(b)!.due || this.seen.get(a)!.streak - this.seen.get(b)!.streak;

    // 1. A working item whose gap is over.
    const again = working.filter((id) => this.seen.get(id)!.due <= this.card).sort(byDue);
    if (again.length) return pick(again[0], "again");

    // 2. A review due from earlier days (most overdue first).
    const reviews = notLast.filter((id) => { const m = this.mem.get(id); return !this.seen.has(id) && !!m && m.level > 0 && overdue(m, now) >= 1; })
      .sort((a, b) => overdue(this.mem.get(b)!, now) - overdue(this.mem.get(a)!, now));
    if (reviews.length) return pick(reviews[0], "review");

    // 3. A new item when the working set has room: items missed before first (level 0), then never seen ones.
    if (ids.filter(isWorking).length < Math.min(this.opts.size, ids.length)) {
      const index = new Map(ids.map((id, i) => [id, i]));
      const fresh = notLast.filter((id) => !this.seen.has(id) && (this.mem.get(id)?.level ?? 0) === 0)
        .sort((a, b) => Number(this.mem.has(b)) - Number(this.mem.has(a)) || this.rankOf(a, index.get(a)!) - this.rankOf(b, index.get(b)!));
      if (fresh.length) return pick(fresh[0], "new");
    }

    // 4. The working item due soonest, a little early.
    if (working.length) return pick(working.sort(byDue)[0], "again");

    // 5. Extra practice: the item seen least in this session, then the one closest to its review.
    const late = (id: string) => (this.mem.has(id) ? overdue(this.mem.get(id)!, now) : Infinity);
    const extra = [...notLast].sort((a, b) => (this.seen.get(a)?.n ?? 0) - (this.seen.get(b)?.n ?? 0) || late(b) - late(a));
    return pick(extra[0], "extra");
  }

  /**
   * Save the result of the current card. good: right on the first try without help.
   * test = false for repetitions with the answer shown (learn mode): they move the item through the session
   * but do not change its long-term level.
   */
  answer(id: string, good: boolean, test = true) {
    const s = this.seen.get(id) ?? { due: 0, streak: 0, n: 0, done: false, review: this.last === id && this.lastKind === "review" };
    s.n += 1;
    if (good) {
      s.streak += 1;
      // A due review answered right at once is remembered: it waits for its next review. Other items need 3 right answers in a row.
      if ((s.review && s.n === 1) || s.streak > GAPS.length) s.done = true;
      else s.due = this.card + GAPS[s.streak - 1] + 1;
    } else {
      s.streak = 0;
      s.done = false;
      s.due = this.card + GAP_WRONG + 1;
    }
    this.seen.set(id, s);
    if (test) this.mem.set(id, grow(this.mem.get(id), good, this.opts.now()));
  }

  /** The card was left without an answer: show it again a little later, with no change to its memory. */
  skip(id: string) {
    const s = this.seen.get(id) ?? { due: 0, streak: 0, n: 0, done: false, review: false };
    s.due = this.card + GAP_SKIP + 1;
    this.seen.set(id, s);
  }
}

/**
 * One scheduler per practice mode of the page, filled with the learner's past tests from the server.
 * ready: the past tests are loaded (or failed to load), so the first card can be picked.
 */
export function useReview(area: string, mode = "", opts: SchedulerOptions = {}) {
  const all = useRef(new Map<string, Scheduler>());
  const key = area + "/" + mode;
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let live = true;
    if (!all.current.has(key)) all.current.set(key, new Scheduler(opts));
    const s = all.current.get(key)!;
    api.memory(area, mode).then((r) => s.load(r.items)).catch(() => {}).finally(() => { if (live) setLoaded((l) => ({ ...l, [key]: true })); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const review = useCallback(() => {
    if (!all.current.has(key)) all.current.set(key, new Scheduler(opts));
    return all.current.get(key)!;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { review, ready: !!loaded[key] };
}
