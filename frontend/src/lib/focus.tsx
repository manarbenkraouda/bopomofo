"use client";
// "Focus" filters from the stats screen: /listening?tones=3,2 or /dictation?syms=ㄗ,ㄘ,ㄙ.
// Every practice mode reads them, so a weak spot opens as a short, targeted drill.
// The coach adds more: ?items= (the exact syllables of a deck, Bopomofo with tone mark), ?ids= (sentence ids for Speaking),
// and ?rules= (tone change rules: 3-3, bu, yi) for the tone rule exercises.
// Numbers read ?nums= (exact numbers) and ?bands= (number sizes, lib/numbers.ts).
// Characters read ?chars= (the Chinese words to repeat).
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useHotkeys } from "./hotkeys";
import { BANDS, MAX, type Band } from "./numbers";
import { splitZhuyin } from "./zhuyin";
import type { RuleId } from "./api";

export type Focus = {
  tones: number[];
  syms: string[];
  items: string[];
  ids: number[];
  rules: RuleId[];
  nums: number[];
  bands: Band[];
  chars: string[];
  active: boolean;
  label: string;
};
const RULE_IDS: RuleId[] = ["3-3", "bu", "yi"];
const RULE_LABEL: Record<RuleId, string> = { "3-3": "3-3 rule", bu: "不 rule", yi: "一 rule" };

export function useFocus(): Focus {
  const q = useSearchParams();
  const t = q.get("tones") ?? "";
  const s = q.get("syms") ?? "";
  const it = q.get("items") ?? "";
  const id = q.get("ids") ?? "";
  const ru = q.get("rules") ?? "";
  const nu = q.get("nums") ?? "";
  const ba = q.get("bands") ?? "";
  const ch = q.get("chars") ?? "";
  return useMemo(() => {
    const tones = t
      .split(",")
      .map(Number)
      .filter((n) => n >= 1 && n <= 5);
    const syms = s
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x && x !== "∅");
    const items = it
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const ids = id
      .split(",")
      .map(Number)
      .filter((n) => n > 0);
    const rules = RULE_IDS.filter((r) => ru.split(",").includes(r));
    const nums = [
      ...new Set(
        nu
          .split(",")
          .filter((x) => /^\d+$/.test(x.trim()))
          .map(Number)
          .filter((n) => n <= MAX),
      ),
    ];
    const bands = BANDS.filter((b) => ba.split(",").includes(b));
    const chars = [
      ...new Set(
        ch
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    ];
    const label = [
      tones.map((n) => (n === 5 ? "neutral tone" : "tone " + n)).join(" / "),
      syms.join(" "),
      items.length ? items.length + " coach syllables" : "",
      ids.length ? ids.length + " coach sentences" : "",
      rules.map((r) => RULE_LABEL[r]).join(" / "),
      nums.length ? nums.length + (nums.length === 1 ? " number" : " numbers") : "",
      bands.join(" / "),
      chars.join(" "),
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      tones,
      syms,
      items,
      ids,
      rules,
      nums,
      bands,
      chars,
      active:
        tones.length +
          syms.length +
          items.length +
          ids.length +
          rules.length +
          nums.length +
          bands.length +
          chars.length >
        0,
      label,
    };
  }, [t, s, it, id, ru, nu, ba, ch]);
}

/** A syllable matches when it is in the coach deck; without a deck, when its tone is one of the tones and it contains one of the symbols. */
export function matches(z: string, f: Focus) {
  if (!f.active) return true;
  if (f.items.length) return f.items.includes(z);
  const { symbols, toneNum } = splitZhuyin(z);
  const str = symbols.join("");
  return (!f.tones.length || f.tones.includes(toneNum)) && (!f.syms.length || f.syms.some((s) => str.includes(s)));
}

/** The single symbols of the focus, for the reading and dictation quizzes. */
export const focusSymbols = (f: Focus) => [...new Set(f.syms.flatMap((s) => [...s]))];

function useClearHref() {
  const path = usePathname();
  const q = useSearchParams();
  const rest = new URLSearchParams(q.toString());
  for (const k of ["tones", "syms", "items", "ids", "rules", "nums", "bands", "chars", "step", "learn"]) rest.delete(k);
  return path + (rest.size ? "?" + rest.toString() : "");
}

/** Shows the active focus. Click it, or press X, to practice everything again. */
export function FocusChip({ focus, empty }: { focus: Focus; empty?: boolean }) {
  const href = useClearHref();
  const router = useRouter();
  useHotkeys("focus", [{ keys: ["KeyX"], label: "Clear focus", run: () => router.replace(href), when: focus.active }]);
  if (!focus.active) return null;
  return (
    <Link
      href={href}
      replace
      className="chip cjk flex items-center gap-1.5 !border-accent text-accent"
      title={empty ? "Nothing matches this focus, so all items are shown" : "Clear the focus (X)"}
    >
      <span aria-hidden>◎</span> {empty ? "No match: " : "Focus: "}
      {focus.label} <span className="text-muted">✕</span>
    </Link>
  );
}
