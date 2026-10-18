import { expect, test } from "bun:test";
import { band, BANDS, choices, errorOf, hanzi, randomIn } from "./numbers";

// The same cases as backend/tests/test_numbers.py: the two copies of the rules must agree.
const SAID: [number, string][] = [
  [0, "零"],
  [10, "十"],
  [15, "十五"],
  [20, "二十"],
  [22, "二十二"],
  [110, "一百一十"],
  [200, "兩百"],
  [205, "兩百零五"],
  [2000, "兩千"],
  [2022, "兩千零二十二"],
  [10005, "一萬零五"],
  [10500, "一萬零五百"],
  [20000, "兩萬"],
  [150000, "十五萬"],
  [2000000, "兩百萬"],
  [99999999, "九千九百九十九萬九千九百九十九"],
];

test("characters follow Taiwan usage, like the backend", () => {
  for (const [n, said] of SAID) expect(hanzi(n)).toBe(said);
});

test("bands and error kinds match the backend", () => {
  expect([0, 10, 11, 99, 100, 9999, 10000].map(band)).toEqual([
    "0-10",
    "0-10",
    "11-99",
    "11-99",
    "100-999",
    "1000-9999",
    "10000+",
  ]);
  expect(errorOf(14, 40)).toBe("teens");
  expect(errorOf(41, 14)).toBe("order");
  expect(errorOf(205, 25)).toBe("place");
  expect(errorOf(7, 7000)).toBe("place");
  expect(errorOf(123, 124)).toBe("digit");
  expect(errorOf(4, 10)).toBe("4-10");
  expect(errorOf(7, 52)).toBe("other");
  expect(errorOf(5, 5)).toBeNull();
});

test("a random number stays in its band and has four different choices", () => {
  for (const b of BANDS)
    for (let i = 0; i < 50; i++) {
      const n = randomIn(b);
      expect(band(n)).toBe(b);
      const c = choices(n);
      expect(c).toHaveLength(4);
      expect(new Set(c).size).toBe(4);
      expect(c).toContain(n);
    }
});
