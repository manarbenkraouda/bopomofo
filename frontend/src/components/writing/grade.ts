import { correctSymbol, recognize, TONE_MARKS, type Pt, type SymbolResult, type Templates } from "@/lib/matcher";
import { splitZhuyin } from "@/lib/zhuyin";

export type Row =
  | { kind: "symbol"; expected: string; box: number; r: SymbolResult; tone?: boolean }
  | { kind: "missing"; expected: string; tone?: boolean }
  | { kind: "extra"; box: number; guess?: string; tone?: boolean }
  | { kind: "tone-ok" };

const SHORTHAND = new Set(["ㄓ", "ㄖ"]);

// Grade one syllable. boxes: 3 symbol boxes (index 0..2) + optional tone box (index 3).
export function gradeSyllable(zhuyin: string, boxes: Pt[][][], T: Templates, SYMBOLS: string[], withTone: boolean): { rows: Row[]; ok: boolean; nearly: boolean } {
  const { symbols, tone } = splitZhuyin(zhuyin);
  const rows: Row[] = [];
  const written = [0, 1, 2].filter((i) => boxes[i]?.length).map((i) => ({ box: i, guess: recognize(boxes[i], T, SYMBOLS)[0]?.ch }));
  // Edit-distance alignment between written boxes and expected symbols.
  const n = written.length, m = symbols.length;
  const d = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  const sub = (i: number, j: number) => (written[i].guess === symbols[j] ? 0 : 0.9);
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) d[i][j] = Math.min(d[i - 1][j - 1] + sub(i - 1, j - 1), d[i - 1][j] + 1, d[i][j - 1] + 1);
  const pairs: { w: (typeof written)[number] | null; e: string | null }[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + sub(i - 1, j - 1)) { pairs.unshift({ w: written[i - 1], e: symbols[j - 1] }); i--; j--; }
    else if (i > 0 && d[i][j] === d[i - 1][j] + 1) { pairs.unshift({ w: written[i - 1], e: null }); i--; }
    else { pairs.unshift({ w: null, e: symbols[j - 1] }); j--; }
  }
  for (const { w, e } of pairs) {
    if (w && e) {
      const r = correctSymbol(boxes[w.box], e, T, SYMBOLS);
      if (SHORTHAND.has(e) && !r.ok && !r.extras.length && r.strokes.some((s) => s.status === "joined") && r.strokes.every((s) => ["ok", "rough", "joined"].includes(s.status))) r.nearly = true;
      rows.push({ kind: "symbol", expected: e, box: w.box, r });
    } else if (e) rows.push({ kind: "missing", expected: e });
    else if (w) rows.push({ kind: "extra", box: w.box, guess: w.guess });
  }
  if (withTone) {
    const tb = boxes[3] ?? [];
    if (!tone && !tb.length) rows.push({ kind: "tone-ok" });
    else if (!tone) rows.push({ kind: "extra", box: 3, guess: recognize(tb, T, TONE_MARKS)[0]?.ch, tone: true });
    else if (!tb.length) rows.push({ kind: "missing", expected: tone, tone: true });
    else rows.push({ kind: "symbol", expected: tone, box: 3, r: correctSymbol(tb, tone, T, TONE_MARKS), tone: true });
  }
  const ok = rows.every((x) => x.kind === "tone-ok" || (x.kind === "symbol" && x.r.ok));
  const nearly = rows.every((x) => x.kind === "tone-ok" || (x.kind === "symbol" && (x.r.ok || x.r.nearly)));
  return { rows, ok, nearly };
}
