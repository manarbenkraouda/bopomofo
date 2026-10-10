import { correctSymbol, recognize, TONE_MARKS, type Pt, type SymbolResult, type Templates } from "@/lib/matcher";
import { splitZhuyin } from "@/lib/zhuyin";

/**
 * The writing sheet: one canvas for a whole answer, in ruled lines. Each line is BOX units high (the size of one stroke-data glyph),
 * so a symbol written to fill a line has the size of its template.
 * segment() splits the ink into symbols and tone marks with the drawing order and the spaces between them.
 * gradeSheet() lines up what was written with the expected Bopomofo and checks each symbol stroke by stroke.
 */
export const BOX = 2150;
const S = 0.75 * BOX; // the usual height of a written symbol
/** The smallest space between two symbols, in symbol heights. */
export const GAP = 0.15;

export type Cluster = { strokes: number[]; row: number; x0: number; x1: number; y0: number; y1: number; mark: boolean };

type Box = { x0: number; x1: number; y0: number; y1: number };
const boxOf = (pts: Pt[]): Box => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
const size = (b: Box) => Math.max(b.x1 - b.x0, b.y1 - b.y0);
const overlap = (a: Box, b: Box) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);

/** The line of a stroke: the line that holds its center. */
export const rowOf = (pts: Pt[], rows: number) => {
  const b = boxOf(pts);
  return Math.max(0, Math.min(rows - 1, Math.floor((b.y0 + b.y1) / 2 / BOX)));
};

/** T (the stroke templates) lets ㄦ and ㄍ, whose two strokes stand apart, be joined when they read as one symbol. */
export function segment(strokes: Pt[][], rows: number, T?: Templates): Cluster[] {
  type C = { strokes: number[]; row: number; b: Box };
  const cs: C[] = [];
  let cur: C | null = null;
  strokes.forEach((pts, i) => {
    const row = rowOf(pts, rows);
    const b = boxOf(pts);
    const small = size(b) < 0.42 * S;
    const cx = (b.x0 + b.x1) / 2;
    let into: C | null = null;
    if (cur && cur.row === row) {
      const c = cur.b;
      if (small) {
        // A small stroke that starts past the right edge, or above the right half, is a tone mark. In the stroke data, the small
        // strokes of a symbol (ㄓ ㄖ ㄙ ㄠ ㄊ) always start at or before the right edge of the strokes drawn before them.
        const aboveRight = b.y1 < c.y0 + 0.12 * S && cx > (c.x0 + c.x1) / 2;
        if (!aboveRight && b.x0 <= c.x1 + 0.04 * S) into = cur;
      } else if (b.x0 - c.x1 < GAP * S && b.x1 > c.x0 - GAP * S) {
        // In the stroke data, the strokes of one symbol stand at most 0.08 S apart, except ㄦ and ㄍ (joined below).
        into = cur;
      }
    }
    // A stroke added later to an earlier symbol (a fix) goes back to it when it mostly overlaps it.
    if (!into) into = cs.find((c) => c.row === row && overlap(c.b, b) > 0.5 * Math.max(1, b.x1 - b.x0)) ?? null;
    if (into) {
      into.strokes.push(i);
      into.b = { x0: Math.min(into.b.x0, b.x0), x1: Math.max(into.b.x1, b.x1), y0: Math.min(into.b.y0, b.y0), y1: Math.max(into.b.y1, b.y1) };
    } else {
      into = { strokes: [i], row, b };
      cs.push(into);
    }
    cur = into;
  });
  // Symbols that grew into each other become one.
  for (let merged = true; merged; ) {
    merged = false;
    for (let a = 0; a < cs.length && !merged; a++) for (let c = a + 1; c < cs.length && !merged; c++) {
      const A = cs[a], B = cs[c];
      if (A.row === B.row && overlap(A.b, B.b) > 0.5 * Math.min(A.b.x1 - A.b.x0, B.b.x1 - B.b.x0)) {
        A.strokes.push(...B.strokes);
        A.b = { x0: Math.min(A.b.x0, B.b.x0), x1: Math.max(A.b.x1, B.b.x1), y0: Math.min(A.b.y0, B.b.y0), y1: Math.max(A.b.y1, B.b.y1) };
        cs.splice(c, 1);
        merged = true;
      }
    }
  }
  cs.sort((a, b) => a.row - b.row || a.b.x0 - b.b.x0);
  // ㄦ and ㄍ: two single strokes drawn one after the other, a little apart, that read together as ㄦ or ㄍ better than each alone.
  // Measured: a written ㄍ or ㄦ costs about 0.01 as one symbol and 0.07 to 0.18 per half; ㄅㄟ, ㄋㄟ, ㄑㄧ cost 0.01 per symbol and 0.2 as one.
  if (T) {
    const all = Object.keys(T).filter((c) => !TONE_MARKS.includes(c) && c !== "¯");
    const read = (st: Pt[][], row: number) => {
      const xs = st.flat().map((p) => p[0]);
      const dx = BOX / 2 - (Math.min(...xs) + Math.max(...xs)) / 2;
      return recognize(st.map((s) => s.map(([x, y]) => [x + dx, y - row * BOX] as Pt)), T, all)[0];
    };
    for (let a = 0; a + 1 < cs.length; a++) {
      const A = cs[a], B = cs[a + 1];
      if (A.row !== B.row || A.strokes.length !== 1 || B.strokes.length !== 1 || B.strokes[0] !== A.strokes[0] + 1) continue;
      if (B.b.x0 - A.b.x1 > 0.5 * S || A.b.y1 - A.b.y0 < 0.4 * S || B.b.y1 - B.b.y0 < 0.4 * S) continue;
      const sa = strokes[A.strokes[0]], sb = strokes[B.strokes[0]];
      const both = read([sa, sb], A.row);
      if (!both || (both.ch !== "ㄦ" && both.ch !== "ㄍ")) continue;
      if (both.score >= Math.min(read([sa], A.row)?.score ?? 1, read([sb], A.row)?.score ?? 1)) continue;
      A.strokes.push(B.strokes[0]);
      A.b = { x0: A.b.x0, x1: Math.max(A.b.x1, B.b.x1), y0: Math.min(A.b.y0, B.b.y0), y1: Math.max(A.b.y1, B.b.y1) };
      cs.splice(a + 1, 1);
    }
  }
  const big = cs.map((c) => size(c.b)).filter((s) => s >= 0.3 * S).sort((a, b) => a - b);
  const ref = big.length ? big[Math.floor(big.length / 2)] : S;
  return cs
    .map((c) => ({ strokes: c.strokes.sort((a, b) => a - b), row: c.row, ...c.b, mark: c.strokes.length === 1 && size(c.b) < 0.5 * ref }))
    .sort((a, b) => a.row - b.row || a.x0 - b.x0);
}

/** The shift that moves a cluster into one glyph box: centered across, kept on its line (marks are centered both ways). */
export function shiftOf(c: Cluster): [number, number] {
  const dx = BOX / 2 - (c.x0 + c.x1) / 2;
  const dy = c.mark ? 1000 - (c.y0 + c.y1) / 2 : -c.row * BOX;
  return [dx, dy];
}
export const clusterStrokes = (c: Cluster, strokes: Pt[][]): Pt[][] => {
  const [dx, dy] = shiftOf(c);
  return c.strokes.map((i) => strokes[i].map(([x, y]) => [x + dx, y + dy] as Pt));
};

export type Row =
  | { kind: "symbol"; expected: string; cluster: number; r: SymbolResult; tone?: boolean }
  | { kind: "missing"; expected: string; tone?: boolean }
  | { kind: "extra"; cluster: number; guess?: string; tone?: boolean }
  | { kind: "tone-ok" };
export type Graded = { rows: Row[]; ok: boolean; nearly: boolean };

const SHORTHAND = new Set(["ㄓ", "ㄖ"]);

/** Grade a whole answer. groups: the expected Bopomofo of each syllable. Returns one result per syllable. */
export function gradeSheet(groups: string[], strokes: Pt[][], clusters: Cluster[], T: Templates, SYMBOLS: string[], withTone: boolean): Graded[] {
  // Expected tokens in writing order. The neutral tone dot comes first (˙ㄇㄜ), the other marks come last. Tone 1 has no mark.
  const exp: { sym: string; g: number; tone: boolean }[] = [];
  groups.forEach((z, g) => {
    const { symbols, tone } = splitZhuyin(z);
    if (withTone && tone === "˙") exp.push({ sym: tone, g, tone: true });
    for (const s of symbols) exp.push({ sym: s, g, tone: false });
    if (withTone && tone && tone !== "˙") exp.push({ sym: tone, g, tone: true });
  });
  const norm = clusters.map((c) => clusterStrokes(c, strokes));
  const written = clusters.map((c, i) => ({ i, mark: c.mark, guess: recognize(norm[i], T, c.mark ? TONE_MARKS : SYMBOLS)[0]?.ch }));
  // Edit-distance alignment. A mark never pairs with a symbol when skipping both is cheaper.
  const n = written.length, m = exp.length;
  const sub = (i: number, j: number) => (written[i].guess === exp[j].sym ? 0 : written[i].mark === exp[j].tone ? 0.9 : 1.5);
  const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) d[i][j] = Math.min(d[i - 1][j - 1] + sub(i - 1, j - 1), d[i - 1][j] + 1, d[i][j - 1] + 1);
  const pairs: { w: number | null; e: number | null }[] = [];
  for (let i = n, j = m; i > 0 || j > 0; ) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + sub(i - 1, j - 1)) { pairs.unshift({ w: i - 1, e: j - 1 }); i--; j--; }
    else if (i > 0 && d[i][j] === d[i - 1][j] + 1) { pairs.unshift({ w: i - 1, e: null }); i--; }
    else { pairs.unshift({ w: null, e: j - 1 }); j--; }
  }
  const out: Row[][] = groups.map(() => []);
  let g = 0;
  for (const { w, e } of pairs) {
    if (e !== null) g = exp[e].g;
    if (w !== null && e !== null) {
      const x = exp[e];
      const r = correctSymbol(norm[w], x.sym, T, x.tone ? TONE_MARKS : SYMBOLS);
      if (SHORTHAND.has(x.sym) && !r.ok && !r.extras.length && r.strokes.some((s) => s.status === "joined") && r.strokes.every((s) => ["ok", "rough", "joined"].includes(s.status))) r.nearly = true;
      out[x.g].push({ kind: "symbol", expected: x.sym, cluster: w, r, tone: x.tone });
    } else if (e !== null) out[exp[e].g].push({ kind: "missing", expected: exp[e].sym, tone: exp[e].tone });
    else if (w !== null) out[g].push({ kind: "extra", cluster: w, guess: written[w].guess, tone: written[w].mark && withTone });
  }
  return out.map((rows, gi) => {
    const { tone } = splitZhuyin(groups[gi]);
    if (withTone && !tone && !rows.some((x) => x.kind === "extra" && x.tone)) rows.push({ kind: "tone-ok" });
    const ok = rows.every((x) => x.kind === "tone-ok" || (x.kind === "symbol" && x.r.ok));
    const nearly = rows.every((x) => x.kind === "tone-ok" || (x.kind === "symbol" && (x.r.ok || !!x.r.nearly)));
    return { rows, ok, nearly };
  });
}

