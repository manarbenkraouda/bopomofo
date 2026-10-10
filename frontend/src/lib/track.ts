// Helpers to describe an answer in units: what was expected, and what the learner actually produced.
import type { Unit } from "./api";
import type { SymbolResult } from "./matcher";
import { INITIALS, splitZhuyin } from "./zhuyin";

/** Initial, final (with the medial), and tone of a syllable, named as the backend names them. ∅ = none. */
export function parts(z: string) {
  const { symbols, toneNum } = splitZhuyin(z);
  const initial = symbols[0] && INITIALS.includes(symbols[0]) ? symbols[0] : "";
  return { initial: initial || "∅", final: symbols.slice(initial ? 1 : 0).join("") || "∅", tone: toneNum, base: symbols.join("") };
}

export const TONE_OF_MARK: Record<string, number> = { "": 1, "ˊ": 2, "ˇ": 3, "ˋ": 4, "˙": 5 };

/** Units for one handwritten symbol: what it looked like, the status of each stroke, and the stroke order. */
export function writtenUnits(expected: string, r: SymbolResult | null, base: Partial<Unit> = {}): Unit[] {
  const ok = !!r && (r.ok || !!r.nearly);
  const out: Unit[] = [{ ...base, kind: "symbol", expected, actual: ok ? expected : r?.recognized ?? null, ok }];
  if (!r || r.empty || !r.strokes.length) return out;
  for (const s of r.strokes) out.push({ ...base, kind: "stroke", expected, actual: s.status, ok: s.status === "ok", pos: s.index });
  for (let i = 0; i < r.extras.length; i++) out.push({ ...base, kind: "stroke", expected, actual: "extra", ok: false, pos: -1 });
  const order = r.strokes.some((s) => s.orderError);
  out.push({ ...base, kind: "order", expected, actual: order ? "order" : "ok", ok: !order });
  return out;
}

/** Milliseconds since a start time from now(). */
export const now = () => (typeof performance === "undefined" ? Date.now() : performance.now());
export const since = (t: number) => Math.max(0, Math.round(now() - t));

