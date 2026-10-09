import { test, expect } from "bun:test";
import { buildTemplates, correctSymbol, recognize, resample, TONE_MARKS } from "./matcher.js";
import data from "../../public/data/strokes.json";

const T = buildTemplates(data);
const SYMBOLS = Object.keys(T).filter((c) => !TONE_MARKS.includes(c));

function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Simulate a hand: global scale/shift/rotation + smooth wobble on each point.
function hand(strokes, seed, amount = 1) {
  const r = rng(seed);
  const s = 1 + (r() - 0.5) * 0.3 * amount, a = (r() - 0.5) * 0.12 * amount;
  const dx = (r() - 0.5) * 200 * amount, dy = (r() - 0.5) * 200 * amount;
  return strokes.map((st) => {
    const ph = r() * 6, w = 25 * amount;
    return resample(st, 30).map(([x, y], k) => {
      const X = x - 1075, Y = y - 1075;
      return [1075 + s * (X * Math.cos(a) - Y * Math.sin(a)) + dx + w * Math.sin(k / 3 + ph),
              1075 + s * (X * Math.sin(a) + Y * Math.cos(a)) + dy + w * Math.cos(k / 4 + ph)];
    });
  });
}
const moe = (ch) => T[ch][0].strokes;

test("every correctly written symbol is accepted and recognized", () => {
  const fails = [];
  for (const ch of SYMBOLS) for (let seed = 1; seed <= 6; seed++) {
    const r = correctSymbol(hand(moe(ch), seed * 97 + ch.charCodeAt(0)), ch, T, SYMBOLS);
    if (!r.ok || r.recognized !== ch) fails.push(ch + "#" + seed + " rec=" + r.recognized + " " + r.messages.join(" | "));
  }
  console.log("correct-writing failures:", fails.length, "of", SYMBOLS.length * 6, fails.slice(0, 8));
  expect(fails.length).toBeLessThanOrEqual(Math.ceil(SYMBOLS.length * 6 * 0.03));
});

test("recognition picks the written symbol among all 37", () => {
  let hit = 0, n = 0;
  for (const ch of SYMBOLS.filter((c) => c !== "ㄧ" || true)) for (let seed = 1; seed <= 4; seed++) {
    n++; if (recognize(hand(moe(ch), seed * 31 + 7, 1.3), T, SYMBOLS)[0].ch === ch) hit++;
  }
  console.log("recognition", hit, "/", n);
  expect(hit / n).toBeGreaterThan(0.95);
});

test("reversed stroke direction is reported", () => {
  const s = moe("ㄊ").map((x) => [...x]); s[0] = [...s[0]].reverse();
  const r = correctSymbol(hand(s, 5), "ㄊ", T, SYMBOLS);
  expect(r.ok).toBe(false);
  expect(r.strokes[0].status).toBe("reversed");
  console.log(r.messages);
});

test("wrong stroke order is reported", () => {
  const s = moe("ㄆ");
  const r = correctSymbol(hand([s[1], s[0]], 9), "ㄆ", T, SYMBOLS);
  expect(r.ok).toBe(false);
  expect(r.strokes.some((x) => x.orderError)).toBe(true);
  console.log(r.messages);
});

test("missing stroke is reported", () => {
  const r = correctSymbol(hand(moe("ㄊ").slice(0, 2), 3), "ㄊ", T, SYMBOLS);
  expect(r.strokes[2].status).toBe("missing");
  console.log(r.messages);
});

test("two strokes written as one are reported as joined", () => {
  const s = moe("ㄏ");
  const r = correctSymbol(hand([[...s[0], ...s[1]]], 4), "ㄏ", T, SYMBOLS);
  expect(r.strokes[0].status).toBe("joined");
  console.log(r.messages);
});

test("a different symbol is named", () => {
  const r = correctSymbol(hand(moe("ㄆ"), 2), "ㄅ", T, SYMBOLS);
  expect(r.ok).toBe(false);
  expect(r.recognized).toBe("ㄆ");
  console.log(r.messages);
});

test("tone marks are recognized", () => {
  for (const m of TONE_MARKS) for (let seed = 1; seed <= 4; seed++) {
    expect(recognize(hand(moe(m), seed, 0.8), T, TONE_MARKS)[0].ch).toBe(m);
  }
});

test("vertical ㄧ is accepted", () => {
  const r = correctSymbol(hand([[[1075, 300], [1075, 1800]]], 1), "ㄧ", T, SYMBOLS);
  expect(r.ok).toBe(true);
});
