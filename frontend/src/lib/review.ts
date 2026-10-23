"use client";
// The order of the cards in every practice mode, built for memory (spaced repetition with retrieval practice).
// Every number below is a learner setting (lib/reviewSettings.ts). The defaults give this order:
//
// - A small working set of new items (newAtOnce: 5, about what short-term memory holds). A new item comes in
//   only when there is room, so the same few items come back often enough to stick.
// - Inside a session, an item comes back after a gap of other cards. The gap grows after each right answer
//   (repeatGap: 2, then 5 other cards), and the item leaves the working set after rightToLearn (3) right answers
//   in a row. A wrong answer brings it back after missGap (1) other card and starts again. When the item is missed
//   again and again, the gap grows (1, 3, 5 other cards), so one hard item does not come back every other card.
// - Across days, every item has a level from its past tests. The level sets when the next review is due
//   (STEP_DAYS: 10 minutes, then 1, 3, 7, 16, 35... days, times reviewTiming, at most longestWait). A right answer
//   after earlyCredit (50%) of the wait moves one level up, a right answer earlier keeps the level, and a wrong
//   answer goes back missCost levels (default: back to level 0).
// - Each card: an item due again in this session, else a review due from earlier days, else a new item when
//   the working set has room, else the next working item, else extra practice on the item seen least.
// - Variety: the weak items must not take every card. With a focus (a coach step, a "Train" link), about
//   focusMix (30%) of the cards come from the other items of the mode, and never more than hardRun (4) focus cards
//   come in a row. Without a focus, normalMix (20%) of the repeated cards go to another item already met, and never
//   more than hardRun cards in a row are items missed in this session. In both cases, when the last 2 × repeatGuard
//   cards hold fewer than repeatGuard (4) different items, the next card is another item.
//   Interleaving other items helps memory too (Rohrer & Taylor 2007, Kornell & Bjork 2008).
//
// Research: Cepeda et al. 2006 (spacing), Roediger & Karpicke 2006 (testing effect),
// Landauer & Bjork 1978 (expanding retrieval), Cowan 2001 (working memory of about 4 items),
// Settles & Meeder 2016 (half-life regression, the spaced repetition of Duolingo).
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import {
  DEFAULT_REVIEW,
  exerciseOf,
  intervalMs,
  loadReviewSettings,
  MISS_TO_START,
  missGapOf,
  repeatGap,
  resolveReview,
  type ReviewConfig,
  RUN_NO_LIMIT,
  SKIP_NEVER,
  topLevel,
} from "./reviewSettings";

export { intervalMs, STEP_DAYS } from "./reviewSettings";

/** Long-term memory of one item: its level and the time of its last test (ms). */
export type Mem = { level: number; last: number; n: number };
/**
 * One past test: [time in seconds, 1 if right on the first try without help, 1 if a hint or the cheat was used,
 * 1 if right on the first try (with or without help), the speaking score or null]. Old rows have only the first two.
 */
export type PastTest = [number, number, number?, number?, (number | null)?];
/** Past tests, oldest first. */
export type Past = PastTest[];
export type CardKind = "again" | "review" | "new" | "extra" | "variety";

/** Whether a past test counts as right with these settings: the speaking score against passScore, and help only when helpCounts is on. */
export function goodOf(t: PastTest, c: ReviewConfig = DEFAULT_REVIEW) {
  const [, good, help = 0, right = good, score = null] = t;
  const ok = score != null ? score >= c.passScore : !!right;
  return ok && (!help || c.helpCounts === 1);
}

/** The memory after one test at time ts (ms). */
export function grow(m: Mem | undefined, good: boolean, ts: number, c: ReviewConfig = DEFAULT_REVIEW): Mem {
  const cur = m ?? { level: 0, last: 0, n: 0 };
  const top = topLevel(c);
  let level = Math.min(cur.level, top);
  if (!good) level = c.missCost >= MISS_TO_START ? 0 : Math.max(0, level - c.missCost);
  else if (level === 0 || ts - cur.last >= (c.earlyCredit / 100) * intervalMs(level, c))
    level = Math.min(level + 1, top);
  return { level, last: ts, n: cur.n + 1 };
}

export const replay = (past: Past, c: ReviewConfig = DEFAULT_REVIEW): Mem | undefined =>
  past.reduce<Mem | undefined>((m, t) => grow(m, goodOf(t, c), t[0] * 1000, c), undefined);

/** How late the review is: 1 = due now, 2 = twice the planned wait. Level 0 items, and items with no wait, are always due. */
export const overdue = (m: Mem, now: number, c: ReviewConfig = DEFAULT_REVIEW) => {
  const wait = intervalMs(m.level, c);
  return m.level === 0 || wait <= 0 ? Infinity : (now - m.last) / wait;
};

/**
 * miss: misses in a row; hard: missed at least once in this session.
 * zero: the last gap was 0 other cards, so the item may come again right after itself.
 * parked: skipped with "never again in this session": extra practice takes it only when nothing else is left.
 */
type Seen = {
  due: number;
  streak: number;
  n: number;
  done: boolean;
  review: boolean;
  miss?: number;
  hard?: boolean;
  zero?: boolean;
  parked?: boolean;
};

export type SchedulerOptions = {
  /** Order of new items: "pool" keeps the order of the pool (the alphabet, a coach deck), "shuffle" mixes them once. The newOrder setting can change it. */
  order?: "pool" | "shuffle";
  settings?: ReviewConfig;
  random?: () => number;
  now?: () => number;
};

export class Scheduler {
  mem = new Map<string, Mem>();
  seen = new Map<string, Seen>();
  card = 0;
  last: string | undefined;
  lastKind: CardKind = "new";
  /** The last cards shown, newest last. */
  recent: string[] = [];
  /** Focus cards (or, without a focus, missed items) in a row. */
  run = 0;
  cfg: ReviewConfig;
  private past: Record<string, Past> = {};
  private rank = new Map<string, number>();
  private opts: Required<Omit<SchedulerOptions, "settings">>;

  constructor(opts: SchedulerOptions = {}) {
    const { settings, ...rest } = opts;
    this.opts = { order: "shuffle", random: Math.random, now: Date.now, ...rest };
    this.cfg = settings ?? DEFAULT_REVIEW;
  }

  /** New settings. The levels of the items not answered yet in this session are computed again from their past tests. */
  configure(cfg: ReviewConfig) {
    this.cfg = cfg;
    this.load(this.past);
  }

  /** The past tests from the server. Items already answered in this session keep their newer memory. */
  load(items: Record<string, Past>) {
    this.past = { ...this.past, ...items };
    for (const [id, past] of Object.entries(items)) {
      if (this.seen.has(id)) continue;
      const m = replay(past, this.cfg);
      if (m) this.mem.set(id, m);
      else this.mem.delete(id);
    }
  }

  private get order() {
    return this.cfg.newOrder === 1 ? "pool" : this.cfg.newOrder === 2 ? "shuffle" : this.opts.order;
  }

  private rankOf(id: string, i: number) {
    if (this.order === "pool") return i;
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
    this.recent = [...this.recent, id].slice(-Math.max(8, 2 * this.cfg.repeatGuard));
    const s = this.seen.get(id);
    const weak = rest.length ? inPool.has(id) : !!s?.hard && !s.done;
    this.run = weak ? this.run + 1 : 0;
    return id;
  }

  /** A card from elsewhere, when the focus or a loop needs one; else undefined. */
  private variety(ids: string[], rest: string[], kind: CardKind): string | undefined {
    const c = this.cfg;
    const focus = rest.length > 0;
    const window = c.repeatGuard > 0 ? this.recent.slice(-2 * c.repeatGuard) : [];
    const loop = c.repeatGuard > 0 && window.length >= 2 * c.repeatGuard && new Set(window).size < c.repeatGuard;
    const long = c.hardRun < RUN_NO_LIMIT && this.run >= c.hardRun;
    const chance = focus ? c.focusMix / 100 : kind === "again" || kind === "extra" ? c.normalMix / 100 : 0;
    const roll = chance > 0 && this.opts.random() < chance;
    if (!loop && !long && !roll) return undefined;
    const seenRecently = new Set(this.recent);
    const working = (id: string) => {
      const s = this.seen.get(id);
      return !!s && !s.done;
    };
    const from = (focus ? rest : ids).filter(
      (id) => id !== this.last && !seenRecently.has(id) && !this.seen.get(id)?.parked && (focus || !working(id)),
    );
    // With a focus, any other item of the mode. Without, prefer items already met: the variety is a quick check,
    // not a new lesson out of order. A loop takes any item.
    const met = from.filter((id) => this.mem.has(id) || this.seen.has(id));
    const list = focus ? from : met.length ? met : loop || long ? from : [];
    return list.length ? list[Math.floor(this.opts.random() * list.length) % list.length] : undefined;
  }

  /** The card of the plain schedule (steps 1 to 5 above). */
  private core(ids: string[]): [string, CardKind] {
    const c = this.cfg;
    const now = this.opts.now();
    const lastSeen = this.last === undefined ? undefined : this.seen.get(this.last);
    // A gap of 0 other cards is a choice of the learner: the same item may come again at once.
    const againAtOnce = !!lastSeen?.zero && !lastSeen.done;
    const notLast = ids.length > 1 && !againAtOnce ? ids.filter((id) => id !== this.last) : ids;
    const pick = (id: string, kind: CardKind): [string, CardKind] => [id, kind];
    const isWorking = (id: string) => {
      const s = this.seen.get(id);
      return !!s && !s.done;
    };
    const working = notLast.filter(isWorking);
    const byDue = (a: string, b: string) =>
      this.seen.get(a)!.due - this.seen.get(b)!.due || this.seen.get(a)!.streak - this.seen.get(b)!.streak;
    const late = (id: string) => overdue(this.mem.get(id)!, now, c);

    // 1. A working item whose gap is over.
    const again = working.filter((id) => this.seen.get(id)!.due <= this.card).sort(byDue);
    if (again.length) return pick(again[0], "again");

    // 2. A review due from earlier days (most overdue first).
    const reviews = notLast
      .filter((id) => {
        const m = this.mem.get(id);
        return !this.seen.has(id) && !!m && m.level > 0 && late(id) >= 1;
      })
      .sort((a, b) => late(b) - late(a) || 0);
    if (reviews.length) return pick(reviews[0], "review");

    // 3. A new item when the working set has room (newAtOnce 0: no limit): items missed before first (level 0),
    // then never seen ones.
    const room = c.newAtOnce === 0 ? ids.length : Math.min(c.newAtOnce, ids.length);
    if (ids.filter(isWorking).length < room) {
      const index = new Map(ids.map((id, i) => [id, i]));
      const fresh = notLast
        .filter((id) => !this.seen.has(id) && (this.mem.get(id)?.level ?? 0) === 0)
        .sort(
          (a, b) =>
            Number(this.mem.has(b)) - Number(this.mem.has(a)) ||
            this.rankOf(a, index.get(a)!) - this.rankOf(b, index.get(b)!),
        );
      if (fresh.length) return pick(fresh[0], "new");
    }

    // 4. The working item due soonest, a little early. When the working set is full and holds only the last item
    // (one new item at a time), that item comes again: a new item would break the learner's limit.
    const full = ids.filter(isWorking).length >= room;
    const soon = working.length ? working : full ? ids.filter(isWorking) : [];
    if (soon.length) return pick(soon.sort(byDue)[0], "again");

    // 5. Extra practice: the item seen least in this session, then the one closest to its review.
    // Cards skipped for the whole session come only when nothing else is left.
    const open = notLast.filter((id) => !this.seen.get(id)?.parked);
    const lateOrNew = (id: string) => (this.mem.has(id) ? late(id) : Infinity);
    const extra = [...(open.length ? open : notLast)].sort(
      (a, b) => (this.seen.get(a)?.n ?? 0) - (this.seen.get(b)?.n ?? 0) || lateOrNew(b) - lateOrNew(a) || 0,
    );
    return pick(extra[0], "extra");
  }

  /**
   * Save the result of the current card. good: right on the first try without help.
   * test = false for repetitions with the answer shown (learn mode): they move the item through the session
   * but do not change its long-term level.
   * helped: right on the first try, but with a hint or the cheat. It counts as right only when helpCounts is on.
   */
  answer(id: string, good: boolean, test = true, helped = false) {
    const c = this.cfg;
    const right = good || (helped && c.helpCounts === 1);
    // A due review or a variety card answered right at once needs no more repetitions in this session.
    const s = this.seen.get(id) ?? {
      due: 0,
      streak: 0,
      n: 0,
      done: false,
      review: this.last === id && (this.lastKind === "review" || this.lastKind === "variety"),
    };
    s.n += 1;
    s.parked = false;
    let gap = 0;
    if (right) {
      s.streak += 1;
      s.miss = 0;
      // A due review answered right at once is remembered: it waits for its next review. Other items need
      // rightToLearn right answers in a row.
      s.done = (s.review && s.n === 1) || s.streak >= c.rightToLearn;
      gap = repeatGap(s.streak, c);
    } else {
      s.streak = 0;
      s.miss = (s.miss ?? 0) + 1;
      s.hard = true;
      // rightToLearn 0: each item comes once, even after a miss.
      s.done = c.rightToLearn === 0;
      gap = missGapOf(s.miss, c);
    }
    if (!s.done) {
      s.due = this.card + gap + 1;
      s.zero = gap === 0;
    }
    this.seen.set(id, s);
    if (test) this.mem.set(id, grow(this.mem.get(id), right, this.opts.now(), c));
  }

  /** The card was left without an answer: show it again a little later (or not in this session), with no change to its memory. */
  skip(id: string) {
    const gap = this.cfg.skipGap;
    const s = this.seen.get(id) ?? { due: 0, streak: 0, n: 0, done: false, review: false };
    if (gap >= SKIP_NEVER) {
      s.done = true;
      s.parked = true;
    } else {
      s.due = this.card + gap + 1;
      s.zero = gap === 0;
    }
    this.seen.set(id, s);
  }
}

/**
 * One scheduler per practice mode of the page, filled with the learner's settings and past tests from the server.
 * ready: the settings and the past tests are loaded (or failed to load), so the first card can be picked.
 */
export function useReview(area: string, mode = "", opts: SchedulerOptions = {}) {
  const all = useRef(new Map<string, Scheduler>());
  const key = area + "/" + mode;
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let live = true;
    if (!all.current.has(key)) all.current.set(key, new Scheduler(opts));
    const s = all.current.get(key)!;
    Promise.allSettled([loadReviewSettings(), api.memory(area, mode)])
      .then(([saved, past]) => {
        // The settings first: the levels of the past tests depend on them.
        if (saved.status === "fulfilled") s.configure(resolveReview(saved.value, exerciseOf(area, mode)));
        if (past.status === "fulfilled") s.load(past.value.items);
      })
      .finally(() => {
        if (live) setLoaded((l) => ({ ...l, [key]: true }));
      });
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const review = useCallback(() => {
    if (!all.current.has(key)) all.current.set(key, new Scheduler(opts));
    return all.current.get(key)!;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { review, ready: !!loaded[key] };
}
