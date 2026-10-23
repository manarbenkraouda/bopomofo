import { expect, test } from "bun:test";
import { goodOf, grow, overdue, replay, Scheduler, STEP_DAYS } from "./review";
import {
  DEFAULT_REVIEW,
  exerciseOf,
  MISS_TO_START,
  missGapOf,
  repeatGap,
  resolveReview,
  REVIEW_STOPS,
  type ReviewConfig,
  RUN_NO_LIMIT,
  SKIP_NEVER,
  topLevel,
  WAIT_NO_LIMIT,
  waitDays,
} from "./reviewSettings";

const DAY = 86400_000;
/** No random variety: the plain schedule. */
const calm = () => 0.99;
/** A seeded random generator (mulberry32), so the variety tests give the same cards on every run. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};
const ids = (n: number) => Array.from({ length: n }, (_, i) => "s" + i);
const cfg = (c: Partial<ReviewConfig>): ReviewConfig => ({ ...DEFAULT_REVIEW, ...c });
/** Run n cards; answer each with good(id). Returns the ids shown. */
function run(
  s: Scheduler,
  pool: string[],
  n: number,
  good: (id: string, i: number) => boolean = () => true,
  others: string[] = [],
) {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = s.next(pool, others)!;
    out.push(id);
    s.answer(id, good(id, i));
  }
  return out;
}
const positions = (shown: string[], id: string) => shown.flatMap((x, i) => (x === id ? [i] : []));
const longestRepeat = (shown: string[]) => {
  let best = 1;
  for (let i = 1, row = 1; i < shown.length; i++)
    best = Math.max(best, (row = shown[i] === shown[i - 1] ? row + 1 : 1));
  return best;
};

// ---------- the defaults keep the order the app had before the settings ----------

test("new items come in only while the working set has room", () => {
  const s = new Scheduler({ order: "pool", random: calm, settings: cfg({ newAtOnce: 5 }) });
  const shown = run(s, ids(30), 15);
  // In the first 15 cards, the learner meets only a few items, each several times.
  expect(new Set(shown).size).toBeLessThanOrEqual(5 + 2);
  expect(shown.filter((x) => x === "s0").length).toBe(3);
  expect(shown.slice(0, 3)).toEqual(["s0", "s1", "s2"]);
});

test("a right answer brings the item back after 2, then 5 other cards, then it graduates", () => {
  const s = new Scheduler({ order: "pool", random: calm, settings: cfg({ newAtOnce: 5 }) });
  expect(positions(run(s, ids(30), 20), "s0")).toEqual([0, 3, 9]);
});

test("no limit: missed items never block new ones, so the session goes through the whole pool", () => {
  // Every answer is wrong, as with speaking scores under the pass score.
  const full = run(new Scheduler({ order: "pool", random: calm }), ids(40), 80, () => false);
  expect(new Set(full).size).toBe(40);
  for (let i = 1; i < 80; i++) expect(full[i] === full[i - 1]).toBe(false);
});

test("a wrong answer brings the item back after 1 other card", () => {
  const s = new Scheduler({ order: "pool", random: calm });
  const shown = run(s, ids(30), 6, (id, i) => !(id === "s0" && i === 0));
  expect(shown[0]).toBe("s0");
  expect(shown[2]).toBe("s0");
});

test("the same item never comes twice in a row", () => {
  const s = new Scheduler({ order: "pool", random: calm });
  const shown = run(s, ids(3), 40, (_, i) => i % 3 !== 0);
  expect(longestRepeat(shown)).toBe(1);
});

test("reviews due from earlier days come before new items, most overdue first", () => {
  const now = 100 * DAY;
  const s = new Scheduler({ order: "pool", now: () => now, random: calm });
  const t = (d: number) => (now - d * DAY) / 1000;
  s.load({
    s5: [
      [t(10), 1],
      [t(9), 1],
    ], // level 2 (1 day), 9 days ago: very late
    s6: [
      [t(3), 1],
      [t(2), 1],
    ], // level 2, 2 days ago: late
    s7: [
      [t(0.5), 1],
      [t(0.2), 1],
    ], // level 2, 5 hours ago: not due
  });
  expect(s.next(ids(10))).toBe("s5");
  s.answer("s5", true);
  expect(s.next(ids(10))).toBe("s6");
  s.answer("s6", true);
  expect(s.next(ids(10))).toBe("s0");
  // A due review answered right is done for this session.
  expect(s.seen.get("s5")!.done).toBe(true);
});

test("items missed before come before never seen items", () => {
  const s = new Scheduler({ order: "pool", now: () => 50 * DAY, random: calm });
  s.load({ s8: [[DAY / 1000, 0]] });
  expect(s.next(ids(10))).toBe("s8");
});

test("levels: up when right at the due time, same when right too early, back to 0 when wrong", () => {
  let m = grow(undefined, true, 0);
  expect(m.level).toBe(1);
  m = grow(m, true, STEP_DAYS[1] * DAY);
  expect(m.level).toBe(2);
  expect(grow(m, true, m.last + 60_000).level).toBe(2);
  expect(grow(m, true, m.last + DAY).level).toBe(3);
  expect(grow(m, false, m.last + DAY).level).toBe(0);
  expect(
    replay([
      [0, 1],
      [3600, 1],
      [3600 + 86400, 1],
    ])!.level,
  ).toBe(3);
});

test("the default waits are the old ladder: 10 minutes, then 1, 3, 7, 16, 35, 80, 180 days, and level 8 is the top", () => {
  expect(Array.from({ length: 9 }, (_, l) => waitDays(l))).toEqual(STEP_DAYS);
  expect(topLevel()).toBe(8);
  expect([1, 2].map((k) => repeatGap(k))).toEqual([2, 5]);
  expect([1, 2, 3, 4].map((k) => missGapOf(k))).toEqual([1, 3, 5, 5]);
});

test("learn mode repetitions move the session on but do not change the long-term level", () => {
  const s = new Scheduler({ order: "pool", random: calm });
  const id = s.next(ids(4))!;
  s.answer(id, true, false);
  expect(s.mem.has(id)).toBe(false);
  expect(s.seen.get(id)!.streak).toBe(1);
});

test("when every item is learned, extra practice keeps the repetitions even", () => {
  const s = new Scheduler({ order: "pool", random: calm });
  const shown = run(s, ids(4), 40);
  const counts = ids(4).map((id) => shown.filter((x) => x === id).length);
  expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
});

test("a skipped card comes back later with no change to its memory", () => {
  const s = new Scheduler({ order: "pool", random: calm });
  const id = s.next(ids(10))!;
  s.skip(id);
  expect(s.mem.has(id)).toBe(false);
  const later = run(s, ids(10), 6);
  expect(later.slice(0, 4)).not.toContain(id);
  expect(later).toContain(id);
});

test("two items always missed do not take every card: other items come between them", () => {
  const s = new Scheduler({ order: "pool", random: seeded(1) });
  const shown = run(s, ids(20), 120, (id) => id !== "s0" && id !== "s1");
  const late = shown.slice(20);
  const window = 2 * DEFAULT_REVIEW.repeatGuard;
  for (let i = window; i <= late.length; i++)
    expect(new Set(late.slice(i - window, i)).size).toBeGreaterThanOrEqual(DEFAULT_REVIEW.repeatGuard - 1);
  // The weak items still come more often than the others.
  const hard = late.filter((x) => x === "s0" || x === "s1").length / late.length;
  expect(hard).toBeGreaterThan(0.2);
  expect(hard).toBeLessThan(0.6);
});

test("a focus of 2 items gets most cards, with other items mixed in and never more than hardRun focus cards in a row", () => {
  const s = new Scheduler({ order: "pool", random: seeded(7) });
  const focus = ["s0", "s1"];
  const shown = run(s, focus, 200, (_, i) => i % 4 !== 0, ids(20));
  const inFocus = shown.map((x) => focus.includes(x));
  const share = inFocus.filter(Boolean).length / shown.length;
  expect(share).toBeGreaterThan(0.55);
  expect(share).toBeLessThan(0.8);
  let row = 0;
  for (const f of inFocus) {
    row = f ? row + 1 : 0;
    expect(row).toBeLessThanOrEqual(DEFAULT_REVIEW.hardRun);
  }
  expect(new Set(shown.filter((x) => !focus.includes(x))).size).toBeGreaterThan(8);
});

test("a variety card answered right does not join the working set", () => {
  const s = new Scheduler({ order: "pool", random: () => 0 });
  s.load({ s9: [[1, 1]] });
  const id = s.next(["s0", "s1"], ["s9"]);
  expect(id).toBe("s9");
  expect(s.lastKind).toBe("variety");
  s.answer(id!, true);
  expect(s.seen.get("s9")!.done).toBe(true);
});

// ---------- the settings, and their extremes ----------

test("each exercise uses its own changes, else the changes for all exercises, else the defaults", () => {
  const saved = { all: { newAtOnce: 9, missGap: 3 }, exercises: { speaking: { newAtOnce: 2, passScore: 95 } } };
  expect(resolveReview(saved, "speaking")).toEqual(cfg({ newAtOnce: 2, missGap: 3, passScore: 95 }));
  expect(resolveReview(saved, "reading")).toEqual(cfg({ newAtOnce: 9, missGap: 3 }));
  expect(resolveReview(saved)).toEqual(cfg({ newAtOnce: 9, missGap: 3 }));
  expect(resolveReview(undefined, "reading")).toEqual(DEFAULT_REVIEW);
  // Unknown keys and values that are not numbers are ignored.
  const bad = { all: { newAtOnce: "x", nope: 3 }, exercises: {} } as never;
  expect(resolveReview(bad, "reading")).toEqual(DEFAULT_REVIEW);
});

test("the tone rules quiz has its own settings; other listening quizzes use the listening ones", () => {
  expect(exerciseOf("listening", "rule")).toBe("rules");
  expect(exerciseOf("listening", "tone")).toBe("listening");
  expect(exerciseOf("speaking", "sentence")).toBe("speaking");
  expect(exerciseOf("numbers")).toBeUndefined();
});

test("every slider has the default among its stops and goes to the extremes", () => {
  for (const [k, stops] of Object.entries(REVIEW_STOPS)) {
    expect(stops).toContain(DEFAULT_REVIEW[k as keyof ReviewConfig]);
    expect([...stops].sort((a, b) => a - b)).toEqual(stops);
  }
  expect(REVIEW_STOPS.newAtOnce.at(-1)).toBe(100);
  expect(REVIEW_STOPS.longestWait.at(-1)).toBe(WAIT_NO_LIMIT);
  expect(REVIEW_STOPS.skipGap.at(-1)).toBe(SKIP_NEVER);
});

test("new items at a time 0: no limit, every item comes in before any repeat", () => {
  const s = new Scheduler({ order: "pool", random: calm, settings: cfg({ newAtOnce: 0, repeatSpacing: 10 }) });
  // The first repeat waits 20 other cards, so 20 new items come first.
  expect(run(s, ids(30), 20)).toEqual(ids(20));
});

test("new items at a time: a small number meets fewer items, a big number meets many", () => {
  const met = (newAtOnce: number) =>
    new Set(run(new Scheduler({ order: "pool", random: calm, settings: cfg({ newAtOnce }) }), ids(40), 20)).size;
  expect(met(1)).toBeLessThan(met(100));
  // One at a time: the item comes again at once until it is learned, before the next new item.
  const one = new Scheduler({ order: "pool", random: calm, settings: cfg({ newAtOnce: 1 }) });
  expect(run(one, ids(40), 6)).toEqual(["s0", "s0", "s0", "s1", "s1", "s1"]);
});

test("right answers to learn 0: each new item comes once, even after a miss", () => {
  const s = new Scheduler({ order: "pool", random: calm, settings: cfg({ rightToLearn: 0 }) });
  expect(run(s, ids(8), 8, (_, i) => i % 2 === 0)).toEqual(ids(8));
});

test("right answers to learn 20: an item stays in the working set for 20 right answers", () => {
  const s = new Scheduler({ order: "pool", random: calm, settings: cfg({ rightToLearn: 20, repeatSpacing: 0.5 }) });
  const shown = run(s, ids(5), 120);
  expect(shown.filter((x) => x === "s0").length).toBeGreaterThanOrEqual(20);
  s.answer("s0", true);
  expect(s.seen.get("s0")!.done).toBe(true);
});

test("space between repeats 0: the same item can come back as the next card", () => {
  const s = new Scheduler({ order: "pool", random: calm, settings: cfg({ repeatSpacing: 0, newAtOnce: 1 }) });
  const shown = run(s, ids(5), 6);
  expect(shown.slice(0, 3)).toEqual(["s0", "s0", "s0"]);
});

test("space between repeats grows the gaps, up to 1000 cards", () => {
  expect(repeatGap(1, cfg({ repeatSpacing: 3 }))).toBe(6);
  expect(repeatGap(2, cfg({ repeatSpacing: 3 }))).toBe(15);
  expect(repeatGap(19, cfg({ repeatSpacing: 10 }))).toBe(1000);
  const s = new Scheduler({ order: "pool", random: calm, settings: cfg({ repeatSpacing: 2 }) });
  expect(positions(run(s, ids(30), 20), "s0").slice(0, 2)).toEqual([0, 5]);
});

test("gap after a mistake: 0 brings the item back at once, a big gap keeps it away", () => {
  const now = cfg({ missGap: 0, newAtOnce: 2 });
  const s = new Scheduler({ order: "pool", random: calm, settings: now });
  expect(run(s, ids(5), 2, (_, i) => i !== 0)).toEqual(["s0", "s0"]);
  expect(missGapOf(3, cfg({ missGap: 50 }))).toBe(54);
  const far = new Scheduler({ order: "pool", random: calm, settings: cfg({ missGap: 10, newAtOnce: 0 }) });
  far.next(ids(30));
  far.answer("s0", false);
  expect(far.seen.get("s0")!.due).toBe(far.card + 11);
  expect(run(far, ids(30), 10)).not.toContain("s0");
});

test("skipped cards: 0 brings it back at once, the top of the slider puts it away for the session", () => {
  const soon = new Scheduler({ order: "pool", random: calm, settings: cfg({ skipGap: 0 }) });
  soon.next(ids(5));
  soon.skip("s0");
  expect(soon.next(ids(5))).toBe("s0");

  const never = new Scheduler({ order: "pool", random: calm, settings: cfg({ skipGap: SKIP_NEVER }) });
  never.next(ids(3));
  never.skip("s0");
  const shown = run(never, ids(3), 12);
  expect(shown).not.toContain("s0");
  // With only the skipped card left, it still comes, so the session does not stop.
  const alone = new Scheduler({ order: "pool", random: calm, settings: cfg({ skipGap: SKIP_NEVER }) });
  alone.next(["s0"]);
  alone.skip("s0");
  expect(alone.next(["s0"])).toBe("s0");
});

test("review timing scales every wait; 0 makes every known item always due", () => {
  expect(waitDays(3, cfg({ reviewTiming: 2 }))).toBe(6);
  expect(waitDays(3, cfg({ reviewTiming: 0.5 }))).toBe(1.5);
  const zero = cfg({ reviewTiming: 0 });
  const m = grow(grow(undefined, true, 0, zero), true, 1, zero);
  expect(overdue(m, 2, zero)).toBe(Infinity);
  const now = 10 * DAY;
  const s = new Scheduler({ order: "pool", now: () => now, random: calm, settings: zero });
  s.load({ s4: [[now / 1000 - 1, 1]] });
  expect(s.next(ids(10))).toBe("s4");
});

test("longest wait caps the waits; no limit lets them grow past 180 days", () => {
  const week = cfg({ longestWait: 7 });
  expect(waitDays(8, week)).toBe(7);
  expect(topLevel(week)).toBe(4);
  let m = grow(undefined, true, 0, week);
  for (let i = 0; i < 10; i++) m = grow(m, true, m.last + 400 * DAY, week);
  expect(m.level).toBe(4);

  const open = cfg({ longestWait: WAIT_NO_LIMIT });
  expect(waitDays(9, open)).toBeCloseTo(396);
  expect(topLevel(open)).toBe(40);
  expect(Number.isFinite(waitDays(40, open))).toBe(true);
});

test("a lower longest wait pulls old high levels down to the new top", () => {
  const past: [number, number][] = [0, 1, 2, 5, 12, 30, 70, 160, 400].map((d) => [d * 86400, 1]);
  expect(replay(past)!.level).toBe(8);
  expect(replay(past, cfg({ longestWait: 3 }))!.level).toBe(topLevel(cfg({ longestWait: 3 })));
});

test("what a mistake costs: 0 keeps the level, 2 goes back 2 levels, the top goes back to the start", () => {
  const at5: { level: number; last: number; n: number } = { level: 5, last: 0, n: 5 };
  expect(grow(at5, false, DAY, cfg({ missCost: 0 })).level).toBe(5);
  expect(grow(at5, false, DAY, cfg({ missCost: 2 })).level).toBe(3);
  expect(grow(at5, false, DAY, cfg({ missCost: 10 })).level).toBe(0);
  expect(grow(at5, false, DAY, cfg({ missCost: MISS_TO_START })).level).toBe(0);
});

test("early credit: 0 moves up on any right answer, 100 only when the full wait has passed", () => {
  const at3 = { level: 3, last: 0, n: 3 };
  expect(grow(at3, true, 60_000, cfg({ earlyCredit: 0 })).level).toBe(4);
  expect(grow(at3, true, 2.9 * DAY, cfg({ earlyCredit: 100 })).level).toBe(3);
  expect(grow(at3, true, 3 * DAY, cfg({ earlyCredit: 100 })).level).toBe(4);
});

test("focus mix: 0 with no other guard keeps every card in the focus, 100 takes every card from the others", () => {
  const focus = ["s0", "s1"];
  const settings = cfg({ focusMix: 0, hardRun: RUN_NO_LIMIT, repeatGuard: 0 });
  const none = new Scheduler({ order: "pool", random: seeded(3), settings });
  expect(run(none, focus, 60, () => true, ids(20)).every((x) => focus.includes(x))).toBe(true);
  const all = new Scheduler({ order: "pool", random: seeded(3), settings: cfg({ focusMix: 100 }) });
  const shown = run(all, focus, 15, () => true, ids(20));
  expect(shown.filter((x) => focus.includes(x)).length).toBeLessThanOrEqual(1);
});

test("hard run 1: never two hard cards in a row while other items are open", () => {
  const s = new Scheduler({ order: "pool", random: seeded(5), settings: cfg({ hardRun: 1, focusMix: 0 }) });
  const focus = ["s0", "s1"];
  const shown = run(s, focus, 60, () => true, ids(20));
  for (let i = 1; i < shown.length; i++) expect(focus.includes(shown[i]) && focus.includes(shown[i - 1])).toBe(false);
});

test("repeat guard alone still mixes other items into a small focus", () => {
  const focus = ["s0", "s1"];
  const settings = cfg({ focusMix: 0, hardRun: RUN_NO_LIMIT, repeatGuard: 4 });
  const s = new Scheduler({ order: "pool", random: seeded(2), settings });
  const shown = run(s, focus, 60, () => true, ids(20)).slice(8);
  for (let i = 8; i <= shown.length; i++) expect(new Set(shown.slice(i - 8, i)).size).toBeGreaterThanOrEqual(3);
});

test("repeat guard 10: the last 20 cards hold at least 9 different items", () => {
  const s = new Scheduler({ order: "pool", random: seeded(4), settings: cfg({ repeatGuard: 10 }) });
  const shown = run(s, ids(40), 200, (id) => id !== "s0" && id !== "s1").slice(40);
  for (let i = 20; i <= shown.length; i++) expect(new Set(shown.slice(i - 20, i)).size).toBeGreaterThanOrEqual(9);
});

test("order of new items: course order or random, whatever the exercise asks", () => {
  const wide = { newAtOnce: 0, repeatSpacing: 10 };
  const course = new Scheduler({ order: "shuffle", random: seeded(9), settings: cfg({ newOrder: 1, ...wide }) });
  expect(run(course, ids(10), 10)).toEqual(ids(10));
  const mixed = new Scheduler({ order: "pool", random: seeded(9), settings: cfg({ newOrder: 2, ...wide }) });
  const shown = run(mixed, ids(10), 10);
  expect(new Set(shown).size).toBe(10);
  expect(shown).not.toEqual(ids(10));
});

test("pass score and help decide which past tests count as right", () => {
  expect(goodOf([0, 0, 0, 0, 72])).toBe(false);
  expect(goodOf([0, 0, 0, 0, 72], cfg({ passScore: 70 }))).toBe(true);
  expect(goodOf([0, 1, 0, 1, 72], cfg({ passScore: 95 }))).toBe(false);
  // Right with a hint: wrong by default, right when help counts.
  expect(goodOf([0, 0, 1, 1, null])).toBe(false);
  expect(goodOf([0, 0, 1, 1, null], cfg({ helpCounts: 1 }))).toBe(true);
  expect(goodOf([0, 0, 1, 0, null], cfg({ helpCounts: 1 }))).toBe(false);
  // Old rows with two values keep their meaning.
  expect(goodOf([0, 1])).toBe(true);
  expect(goodOf([0, 0])).toBe(false);
});

test("help counts: a right answer with help moves the item on only when the setting is on", () => {
  const off = new Scheduler({ order: "pool", random: calm });
  off.next(ids(5));
  off.answer("s0", false, true, true);
  expect(off.seen.get("s0")!.streak).toBe(0);
  expect(off.mem.get("s0")!.level).toBe(0);

  const on = new Scheduler({ order: "pool", random: calm, settings: cfg({ helpCounts: 1 }) });
  on.next(ids(5));
  on.answer("s0", false, true, true);
  expect(on.seen.get("s0")!.streak).toBe(1);
  expect(on.mem.get("s0")!.level).toBe(1);
});

test("new settings compute the levels of the past tests again", () => {
  const now = 100 * DAY;
  const s = new Scheduler({ order: "pool", now: () => now, random: calm });
  s.load({ s3: [[now / 1000 - 3600, 0, 0, 0, 75]] });
  expect(s.mem.get("s3")!.level).toBe(0);
  s.configure(cfg({ passScore: 70 }));
  expect(s.mem.get("s3")!.level).toBe(1);
});
