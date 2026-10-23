import { expect, test } from "bun:test";
import { firstTry, firstTryResult } from "./attempts";

test("the first three attempts earn first-try credit without hints", () => {
  expect([0, 1, 2, 3].map((n) => firstTry(true, false, n))).toEqual([true, true, true, false]);
  expect([0, 1, 2, 3].map((n) => firstTry(true, true, n))).toEqual([false, false, false, false]);
});

test("misses do not end the attempt window before the third attempt", () => {
  expect([0, 1, 2, 3].map((n) => firstTryResult(false, false, n))).toEqual([null, null, false, false]);
  expect(firstTryResult(true, false, 1)).toBe(true);
  expect(firstTryResult(false, true, 0)).toBe(false);
  expect(firstTryResult(true, true, 1)).toBe(false);
});
