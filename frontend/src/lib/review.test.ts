import { expect, test } from "bun:test";
import { FOCUS_RUN, grow, LOOP_MIN, LOOP_WINDOW, replay, Scheduler, STEP_DAYS, WORKING_SET } from "./review";

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
/** Run n cards; answer each with good(id). Returns the ids shown. */
function run(s: Scheduler, pool: string[], n: number, good: (id: string, i: number) => boolean = () => true, others: string[] = []) {
  const out: string[] = [];
  for (let i = 0; i < n; i++) { const id = s.next(pool, others)!; out.push(id); s.answer(id, good(id, i)); }
  return out;
}

test("new items come in only while the working set has room", () => {
  const s = new Scheduler({ order: "pool", random: calm });
  const shown = run(s, ids(30), 15);
  // In the first 15 cards, the learner meets only a few items, each several times.
  const distinct = new Set(shown);
  expect(distinct.size).toBeLessThanOrEqual(WORKING_SET + 2);
  expect(shown.filter((x) => x === "s0").length).toBe(3);
  expect(shown.slice(0, 3)).toEqual(["s0", "s1", "s2"]);
});

test("a right answer brings the item back after 2, then 5 other cards, then it graduates", () => {
  const s = new Scheduler({ order: "pool", random: calm });
  const shown = run(s, ids(30), 20);
  const at = shown.flatMap((x, i) => (x === "s0" ? [i] : []));
  expect(at).toEqual([0, 3, 9]);
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
  for (let i = 1; i < shown.length; i++) expect(shown[i]).not.toBe(shown[i - 1]);
});

test("reviews due from earlier days come before new items, most overdue first", () => {
  const now = 100 * DAY;
  const s = new Scheduler({ order: "pool", now: () => now, random: calm });
  const t = (d: number) => (now - d * DAY) / 1000;
  s.load({
    s5: [[t(10), 1], [t(9), 1]],   // level 2 (1 day), 9 days ago: very late
    s6: [[t(3), 1], [t(2), 1]],    // level 2, 2 days ago: late
    s7: [[t(0.5), 1], [t(0.2), 1]], // level 2, 5 hours ago: not due
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
  expect(replay([[0, 1], [3600, 1], [3600 + 86400, 1]])!.level).toBe(3);
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
  const pool = ids(20);
  const shown = run(s, pool, 120, (id) => id !== "s0" && id !== "s1");
  const late = shown.slice(20);
  for (let i = LOOP_WINDOW; i <= late.length; i++) expect(new Set(late.slice(i - LOOP_WINDOW, i)).size).toBeGreaterThanOrEqual(LOOP_MIN - 1);
  // The weak items still come more often than the others.
  const hard = late.filter((x) => x === "s0" || x === "s1").length / late.length;
  expect(hard).toBeGreaterThan(0.2);
  expect(hard).toBeLessThan(0.6);
});

test("a focus of 2 items gets most cards, with other items mixed in and never more than FOCUS_RUN focus cards in a row", () => {
  const s = new Scheduler({ order: "pool", random: seeded(7) });
  const focus = ["s0", "s1"];
  const others = ids(20);
  const shown = run(s, focus, 200, (_, i) => i % 4 !== 0, others);
  const inFocus = shown.map((x) => focus.includes(x));
  const share = inFocus.filter(Boolean).length / shown.length;
  expect(share).toBeGreaterThan(0.55);
  expect(share).toBeLessThan(0.8);
  let row = 0;
  for (const f of inFocus) { row = f ? row + 1 : 0; expect(row).toBeLessThanOrEqual(FOCUS_RUN); }
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
