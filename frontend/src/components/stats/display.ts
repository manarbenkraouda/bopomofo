import { type Stats as Data } from "@/lib/api";
import { INITIALS } from "@/lib/zhuyin";
import { pct } from "./charts";

export const rangeTitle = (d: number) => (d === 1 ? "Today" : d === 0 ? "All time" : "Last " + d + " days");

export const SYMS = [...INITIALS, ..."ㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ"];

export const GRID_COLS = 7;

export const TONES = ["1", "2", "3", "4", "5"];

export const WEAK_SHOWN = 3;

export const toneName = (t: string) => (t === "5" ? "Neutral" : t === "?" ? "Unclear" : "Tone " + t);

export const toneShort = (t: string) => (t === "5" ? "N" : t === "?" ? "?" : t);

/** What was produced instead, in words. */
export const said = (kind: string, a: string) =>
  a === "?"
    ? kind === "tone"
      ? "unclear"
      : "not heard"
    : a === "∅"
      ? "nothing"
      : kind === "tone"
        ? toneName(a).toLowerCase()
        : a;

export const itemName = (it: { kind: string; expected: string }) =>
  it.kind === "tone"
    ? toneName(it.expected)
    : it.kind === "initial"
      ? "Initial " + it.expected
      : it.kind === "final"
        ? "Final " + it.expected
        : it.expected;

export const trainHref = (area: string, kind: string, vals: string[]) => {
  const v = encodeURIComponent(vals.filter((x) => x && x !== "∅" && x !== "?").join(","));
  if (kind === "tone")
    return area === "listening"
      ? "/listening?quiz=tone&tones=" + v
      : area === "writing"
        ? "/writing?mode=syllable&tones=" + v
        : "/speaking?source=syllable&tones=" + v;
  if (kind === "symbol")
    return area === "reading"
      ? "/reading?syms=" + v
      : area === "recognize"
        ? "/recognize?syms=" + v
        : area === "writing"
          ? "/writing?mode=symbol&syms=" + v
          : "/dictation?syms=" + v;
  return area === "listening" ? "/listening?quiz=zhuyin&syms=" + v : "/speaking?source=syllable&syms=" + v;
};

export const percent = (p: number | null | undefined) => (p == null ? "–" : Math.round(p) + "%");

// ---------- Tones ----------

export function confusionOf(data: Data, area: string, kind: string) {
  const m = new Map<string, number>();
  for (const c of data.confusion) if (c.area === area && c.kind === kind) m.set(c.expected + "|" + c.actual, c.n);
  return (r: string, c: string) => m.get(r + "|" + c) ?? 0;
}

/** The most frequent mix-ups of a kind, in words: expected, produced instead, count, and share of the expected item. */
export function mixups(data: Data, kind: string, area?: string) {
  const totals = new Map<string, number>();
  for (const c of data.confusion)
    if (c.kind === kind && (!area || c.area === area))
      totals.set(c.area + "|" + c.expected, (totals.get(c.area + "|" + c.expected) ?? 0) + c.n);
  return data.confusion
    .filter((c) => c.kind === kind && (!area || c.area === area) && c.actual !== c.expected)
    .map((c) => ({ ...c, share: pct(c.n, totals.get(c.area + "|" + c.expected) ?? 0) }))
    .sort((a, b) => b.n - a.n);
}
