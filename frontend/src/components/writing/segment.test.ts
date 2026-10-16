import { test, expect } from "bun:test";
import { buildTemplates, resample, TONE_MARKS, type Pt } from "@/lib/matcher";
import { splitZhuyin } from "@/lib/zhuyin";
import data from "../../../public/data/strokes.json";
import syllables from "../../../public/data/syllables.json";
import { BOX, gradeSheet, segment } from "./segment";

const T = buildTemplates(data as never);
const SYMBOLS = Object.keys(T).filter((c) => !TONE_MARKS.includes(c));
const S = 0.75 * BOX;

function rng(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
}
/** A hand: small wobble on each point, and a slight size change. */
function hand(strokes: Pt[][], seed: number, k: number): Pt[][] {
  const r = rng(seed);
  const s = k * (1 + (r() - 0.5) * 0.15);
  return strokes.map((st) => {
    const ph = r() * 6;
    return resample(st, 30).map(
      ([x, y], i) =>
        [1075 + s * (x - 1075) + 18 * Math.sin(i / 3 + ph), 1075 + s * (y - 1075) + 18 * Math.cos(i / 4 + ph)] as Pt,
    );
  });
}
const glyph = (ch: string) => (data as unknown as Record<string, { track: Pt[] }[]>)[ch].map((s) => s.track);

/** Write tokens on the sheet: "|" is a space between syllables, "/" goes to the next line. gap: the space between symbols, in S. */
function write(text: string, { gap = 0.4, markGap = 0.25, seed = 1 } = {}): Pt[][] {
  const out: Pt[][] = [];
  let x = 100,
    row = 0,
    n = seed;
  for (const ch of [...text]) {
    if (ch === "|") {
      x += 0.6 * S;
      continue;
    }
    if (ch === "/") {
      row++;
      x = 100;
      continue;
    }
    const mark = TONE_MARKS.includes(ch);
    const st = hand(glyph(ch), n++, mark ? 0.5 : 1);
    const xs = st.flat().map((p) => p[0]),
      ys = st.flat().map((p) => p[1]);
    const x0 = Math.min(...xs),
      w = Math.max(...xs) - x0,
      cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    if (mark) x += markGap * S - gap * S;
    const dy = mark ? row * BOX + 0.35 * BOX - cy : row * BOX;
    out.push(...st.map((s) => s.map(([px, py]) => [px - x0 + x, py + dy] as Pt)));
    x += w + gap * S;
  }
  return out;
}
const seq = (strokes: Pt[][], rows = 1) =>
  segment(strokes, rows, T)
    .map((c) => (c.mark ? "m" : "s") + c.strokes.length)
    .join(" ");
const grade = (groups: string[], strokes: Pt[][], rows = 1) =>
  gradeSheet(groups, strokes, segment(strokes, rows, T), T, SYMBOLS, true);
const summary = (g: ReturnType<typeof grade>) =>
  g.map((x) =>
    x.rows
      .map((r) =>
        r.kind === "symbol"
          ? r.expected + (r.r.ok || r.r.nearly ? "✓" : "✗")
          : r.kind === "missing"
            ? r.expected + "?"
            : r.kind === "extra"
              ? "+"
              : "1",
      )
      .join(" "),
  );

test("a word splits into symbols and tone marks", () => {
  const s = write("ㄋㄧˇ|ㄏㄠˇ");
  expect(seq(s)).toBe("s1 s1 m1 s2 s3 m1");
  const g = grade(["ㄋㄧˇ", "ㄏㄠˇ"], s);
  expect(summary(g)).toEqual(["ㄋ✓ ㄧ✓ ˇ✓", "ㄏ✓ ㄠ✓ ˇ✓"]);
  expect(g.every((x) => x.nearly)).toBe(true);
});

test("symbols whose strokes stand apart stay whole", () => {
  expect(seq(write("ㄍㄜ"))).toBe("s2 s2");
  expect(seq(write("ㄦˊ"))).toBe("s2 m1");
  expect(summary(grade(["ㄍㄜ"], write("ㄍㄜ")))).toEqual(["ㄍ✓ ㄜ✓ 1"]);
});

test("close symbols and a close tone mark", () => {
  expect(seq(write("ㄑㄧ", { gap: 0.32 }))).toBe("s1 s1");
  expect(seq(write("ㄑㄩ", { gap: 0.32 }))).toBe("s1 s2");
  expect(seq(write("ㄇㄚˇ", { markGap: 0.05 }))).toBe("s2 s3 m1");
});

test("many hands: every symbol stays whole between two others", () => {
  const bad: string[] = [];
  for (const ch of SYMBOLS)
    for (let seed = 1; seed <= 6; seed++) {
      const s = write("ㄇ" + ch + "ㄇ", { seed: seed * 7 });
      const got = segment(s, 1, T)
        .map((c) => c.strokes.length)
        .join(" ");
      const want = [2, (data as Record<string, unknown[]>)[ch].length, 2].join(" ");
      if (got !== want) bad.push(ch + " seed " + seed + ": " + got);
    }
  expect(bad).toEqual([]);
});

test("every syllable of the app splits right and grades right", () => {
  const bad: string[] = [];
  for (const s of syllables as { zhuyin: string }[]) {
    const { symbols, tone } = splitZhuyin(s.zhuyin);
    const text = (tone === "˙" ? "˙" : "") + symbols.join("") + (tone && tone !== "˙" ? tone : "");
    const st = write(text, { seed: s.zhuyin.length * 31 + 5 });
    const want = [...text]
      .map((c) => (TONE_MARKS.includes(c) ? "m1" : "s" + (data as Record<string, unknown[]>)[c].length))
      .join(" ");
    const got = seq(st);
    const g = grade([s.zhuyin], st)[0];
    if (got !== want || !g.nearly) bad.push(s.zhuyin + ": " + got + " / " + summary([g]));
  }
  expect(bad).toEqual([]);
});

test("a missing symbol and a missing mark are reported in place", () => {
  expect(summary(grade(["ㄋㄧˇ"], write("ㄋˇ")))).toEqual(["ㄋ✓ ㄧ? ˇ✓"]);
  expect(summary(grade(["ㄏㄠˇ"], write("ㄏㄠ")))).toEqual(["ㄏ✓ ㄠ✓ ˇ?"]);
  expect(summary(grade(["ㄇㄚ"], write("ㄇㄚˋ")))).toEqual(["ㄇ✓ ㄚ✓ +"]);
});

test("neutral tone dot and two lines", () => {
  expect(summary(grade(["ㄇㄚ", "˙ㄇㄚ"], write("ㄇㄚ|˙ㄇㄚ")))).toEqual(["ㄇ✓ ㄚ✓ 1", "˙✓ ㄇ✓ ㄚ✓"]);
  const two = write("ㄒㄧㄝˋ/ㄒㄧㄝ˙");
  expect(seq(two, 2)).toBe("s2 s1 s3 m1 s2 s1 s3 m1");
  expect(splitZhuyin("ㄒㄧㄝˋ").symbols.length).toBe(3);
  expect(summary(grade(["ㄒㄧㄝˋ", "ㄒㄧㄝ"], write("ㄒㄧㄝˋ/ㄒㄧㄝ"), 2))).toEqual([
    "ㄒ✓ ㄧ✓ ㄝ✓ ˋ✓",
    "ㄒ✓ ㄧ✓ ㄝ✓ 1",
  ]);
});
