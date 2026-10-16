import { ttsUrl, type Sentence, type Syl } from "@/lib/api";
import { splitZhuyin } from "@/lib/zhuyin";

type Group = { char?: string; zhuyin: string };

export type Item = { key: string; groups: Group[]; audio: string; english?: string };

/** What is written for an item, as saved in the answer: the Bopomofo of each syllable, with spaces. */
export const itemKey = (it: Item) => it.groups.map((g) => g.zhuyin).join(" ");

/** The tokens of a syllable in writing order: the neutral dot first, the other marks last. */
export const tokensOf = (z: string, withTone: boolean) => {
  const { symbols, tone } = splitZhuyin(z);
  return [
    ...(withTone && tone === "˙" ? [{ sym: tone, mark: true }] : []),
    ...symbols.map((s) => ({ sym: s, mark: false })),
    ...(withTone && tone && tone !== "˙" ? [{ sym: tone, mark: true }] : []),
  ];
};

// Words of a sentence, with Bopomofo from the sentence context.
export function sentenceWords(s: Sentence): Item[] {
  const out: Item[] = [];
  let from = 0;
  for (const w of s.words) {
    const at = s.hanzi.indexOf(w.text, from);
    if (at < 0) continue;
    from = at + w.text.length;
    const sylls = s.items.slice(at, at + w.text.length).filter((x): x is Syl => x.type === "syllable");
    if (!sylls.length || sylls.length !== w.text.length || sylls.length > 4) continue;
    out.push({
      key: s.id + ":" + at,
      groups: sylls.map((x) => ({ char: x.char, zhuyin: x.zhuyin })),
      audio: ttsUrl(w.text, -10),
      english: w.english,
    });
  }
  return out;
}
