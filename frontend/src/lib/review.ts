"use client";
// The order of the cards in every practice mode, built for memory (spaced repetition with retrieval practice):
//
// - A small working set of new items (WORKING_SET, about what short-term memory holds). A new item comes in
//   only when there is room, so the same few items come back often enough to stick.
// - Inside a session, an item comes back after a gap of other cards. The gap grows after each right answer
//   (GAPS: 2, then 5 other cards), and the item leaves the working set after 3 right answers in a row.
//   A wrong answer brings it back after 1 other card and starts again. When the item is missed again and again,
//   the gap grows (GAPS_WRONG: 1, 3, 5 other cards), so one hard item does not come back every other card.
// - Across days, every item has a level from its past tests. The level sets when the next review is due
//   (STEP_DAYS: 10 minutes, then 1, 3, 7, 16, 35... days). A right answer at the due time moves one level up,
//   a right answer much earlier keeps the level, and a wrong answer goes back to level 0.
// - Each card: an item due again in this session, else a review due from earlier days, else a new item when
//   the working set has room, else the next working item, else extra practice on the item seen least.
// - Variety: the weak items must not take every card. With a focus (a coach step, a "Train" link), about
//   FOCUS_VARIETY of the cards come from the other items of the mode, and never more than FOCUS_RUN focus cards
//   come in a row. Without a focus, VARIETY of the repeated cards go to another item already met, and never more
//   than FOCUS_RUN cards in a row are items missed in this session. In both cases, when the last LOOP_WINDOW cards
//   hold fewer than LOOP_MIN different items, the next card is another item.
//   Interleaving other items helps memory too (Rohrer & Taylor 2007, Kornell & Bjork 2008).
//
// Research: Cepeda et al. 2006 (spacing), Roediger & Karpicke 2006 (testing effect),
// Landauer & Bjork 1978 (expanding retrieval), Cowan 2001 (working memory of about 4 items),
// Settles & Meeder 2016 (half-life regression, the spaced repetition of Duolingo).
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export const WORKING_SET = 5;
/** Other cards between two showings of a working item, after 1 and 2 right answers in a row. The 3rd right answer graduates it. */
export const GAPS = [2, 5];
/** Other cards before a missed item comes back, after 1, 2, and 3 or more misses in a row. */
export const GAPS_WRONG = [1, 3, 5];
const GAP_SKIP = 4;
/** With a focus: the chance that a card comes from outside the focus. */
export const FOCUS_VARIETY = 0.3;
/** The most focus cards in a row (with a focus), or cards missed in this session in a row (without). */
export const FOCUS_RUN = 4;
/** Without a focus: the chance that a repeated card goes to another item already met. */
export const VARIETY = 0.2;
/** A loop: fewer than LOOP_MIN different items in the last LOOP_WINDOW cards. */
export const LOOP_WINDOW = 8;
export const LOOP_MIN = 4;
const DAY = 86400_000;
/** Time until the next review, per level, in days. Level 0: due at once. */
export const STEP_DAYS = [0, 10 / 1440, 1, 3, 7, 16, 35, 80, 180];

/** Long-term memory of one item: its level and the time of its last test (ms). */
export type Mem = { level: number; last: number; n: number };
/** Past tests, oldest first: [time in seconds, 1 if right on the first try without help]. */
export type Past = [number, number][];
export type CardKind = "again" | "review" | "new" | "extra" | "variety";

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

/** miss: misses in a row; hard: missed at least once in this session. */
type Seen = { due: number; streak: number; n: number; done: boolean; review: boolean; miss?: number; hard?: boolean };

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
  /** The last cards shown, newest last (at most LOOP_WINDOW). */
  recent: string[] = [];
  /** Focus cards (or, without a focus, missed items) in a row. */
  run = 0;
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

  /**
   * The next item of the pool (ids in pool order).
   * others: the other items of the mode when the pool is a focus. Some cards come from them, so a focus of
   * 2 or 3 items does not loop. The result can be one of them.
   */
  next(pool: string[], others: string[] = []): string | undefined {
    if (!pool.length) return undefined;
    const ids = [...new Set(pool)];
    const inPool = new Set(ids);
    const rest = [...new Set(others)].filter((id) => !inPool.has(id));
    this.card += 1;
    let [id, kind] = this.core(ids);
    const v = this.variety(ids, rest, kind);
    if (v) [id, kind] = [v, "variety"];
    this.last = id;
    this.lastKind = kind;
    this.recent = [...this.recent, id].slice(-LOOP_WINDOW);
    const s = this.seen.get(id);
    const weak = rest.length ? inPool.has(id) : !!s?.hard && !s.done;
    this.run = weak ? this.run + 1 : 0;
    return id;
  }

  /** A card from elsewhere, when the focus or a loop needs one; else undefined. */
  private variety(ids: string[], rest: string[], kind: CardKind): string | undefined {
    const focus = rest.length > 0;
    const seenRecently = new Set(this.recent);
    const loop = this.recent.length >= LOOP_WINDOW && seenRecently.size < LOOP_MIN;
    const long = this.run >= FOCUS_RUN;
    const chance = focus ? FOCUS_VARIETY : kind === "again" || kind === "extra" ? VARIETY : 0;
    const roll = chance > 0 && this.opts.random() < chance;
    if (!loop && !long && !roll) return undefined;
    const working = (id: string) => { const s = this.seen.get(id); return !!s && !s.done; };
    const from = (focus ? rest : ids).filter((id) => id !== this.last && !seenRecently.has(id) && (focus || !working(id)));
    // With a focus, any other item of the mode. Without, prefer items already met: the variety is a quick check,
    // not a new lesson out of order. A loop takes any item.
    const met = from.filter((id) => this.mem.has(id) || this.seen.has(id));
    const list = focus ? from : met.length ? met : loop || long ? from : [];
    return list.length ? list[Math.floor(this.opts.random() * list.length) % list.length] : undefined;
  }

  /** The card of the plain schedule (steps 1 to 5 above). */
  private core(ids: string[]): [string, CardKind] {
    const now = this.opts.now();
    const notLast = ids.length > 1 ? ids.filter((id) => id !== this.last) : ids;
    const pick = (id: string, kind: CardKind): [string, CardKind] => [id, kind];
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
    // A due review or a variety card answered right at once needs no more repetitions in this session.
    const s = this.seen.get(id) ?? { due: 0, streak: 0, n: 0, done: false, review: this.last === id && (this.lastKind === "review" || this.lastKind === "variety") };
    s.n += 1;
    if (good) {
      s.streak += 1;
      s.miss = 0;
      // A due review answered right at once is remembered: it waits for its next review. Other items need 3 right answers in a row.
      if ((s.review && s.n === 1) || s.streak > GAPS.length) s.done = true;
      else s.due = this.card + GAPS[s.streak - 1] + 1;
    } else {
      s.streak = 0;
      s.done = false;
      s.miss = (s.miss ?? 0) + 1;
      s.hard = true;
      s.due = this.card + GAPS_WRONG[Math.min(s.miss, GAPS_WRONG.length) - 1] + 1;
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
