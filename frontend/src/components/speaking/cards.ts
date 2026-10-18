import { type FxStatus } from "@/components/quiz/Feedback";
import { ttsUrl, type RulePhrase, type Sentence, type SpeechResult, type Syl, type TextItem } from "@/lib/api";
import { type Focus } from "@/lib/focus";

export type Source = "rule" | "sentence" | "word" | "syllable" | "custom";

export type Card = {
  text: string;
  items: TextItem[];
  english?: string;
  audio: string;
  slow?: string;
  rule?: RulePhrase;
};

export const SOURCES: Source[] = ["rule", "sentence", "word", "syllable", "custom"];

export const SOURCE_LABEL: Record<Source, string> = {
  rule: "Tone rules",
  sentence: "Sentences",
  word: "Words",
  syllable: "Syllables",
  custom: "My own text",
};

export const RULE_NAME: Record<string, string> = { "3-3": "3-3 rule", bu: "不 rule", yi: "一 rule" };

export const grade = (score: number): FxStatus => (score >= 85 ? "right" : score >= 60 ? "close" : "wrong");

export const verdict = (score: number) =>
  (score >= 85 ? "Excellent! " : score >= 60 ? "Almost: " : "Keep practicing: ") + score;

/** The score of a right recording, as the backend saves it (stats.log_speaking). */
export const RIGHT = 80;

/** Misses of a one-syllable card before the app asks what the learner said: the model can mix up close sounds (b and p). */
export const CHECK_AFTER = 3;

/** The typed Pinyin check: not asked yet, open, closed with Esc (it can open again), or answered. */
export type Check = "none" | "open" | "closed" | "done";

/** A recording where the model heard another initial or final (or nothing). */
export const soundMiss = (r: SpeechResult) =>
  r.syllables.some((s) => !s.heard || s.initial_ok === false || s.final_ok === false);

/** For speaking, a tone focus means the tone as said (after tone changes). */
export const sylMatch = (i: Syl, f: Focus) =>
  (!f.tones.length || f.tones.includes(i.surface_tone)) &&
  (!f.syms.length || f.syms.some((x) => (i.initial + i.final).includes(x)));

/** The Pinyin of a text, with the punctuation kept next to the word before it. */
export const pinyinOf = (items: TextItem[]) =>
  items
    .map((i) => (i.type === "syllable" ? i.pinyin : i.text))
    .join(" ")
    .replace(/\s+([，。！？、；：,.!?;:])/g, "$1");

export const sentenceCard = (s: Sentence): Card => ({
  text: s.hanzi,
  items: s.items,
  english: s.english,
  audio: ttsUrl(s.hanzi),
  slow: ttsUrl(s.hanzi, -35),
});

export const ruleCard = (p: RulePhrase): Card => ({
  text: p.text,
  items: p.items,
  english: p.english,
  audio: ttsUrl(p.text),
  slow: ttsUrl(p.text, -35),
  rule: p,
});

/** A word of the learner's sentences. syls: its syllables as said in the sentence, for the focus filter. */
export type Word = { text: string; english: string; syls: Syl[] };

/** The words of 2 to 4 syllables in the sentences, each one once. One-syllable words are already the syllable cards. */
export function wordsOf(sentences: Sentence[]): Word[] {
  const out = new Map<string, Word>();
  for (const s of sentences) {
    let from = 0;
    for (const w of s.words ?? []) {
      const at = s.hanzi.indexOf(w.text, from);
      if (at < 0) continue;
      from = at + w.text.length;
      // The items of a sentence are one per character, so the word's characters are the same slice.
      const syls = s.items.slice(at, at + w.text.length).filter((x): x is Syl => x.type === "syllable");
      if (syls.length < 2 || syls.length > 4 || syls.length !== w.text.length || out.has(w.text)) continue;
      out.set(w.text, { text: w.text, english: w.english, syls });
    }
  }
  return [...out.values()];
}

/** items: the analysis of the word alone, as the backend grades it (a tone change can depend on the next word). */
export const wordCard = (w: Word, items: TextItem[]): Card => ({
  text: w.text,
  items,
  english: w.english,
  audio: ttsUrl(w.text),
  slow: ttsUrl(w.text, -35),
});

/** The syllables whose said tone is not the written tone, with the rule that changes them. */
export const changed = (items: TextItem[]) =>
  items.filter((i): i is Syl => i.type === "syllable" && i.surface_tone !== i.tone);

export const saidZhuyin = (s: Syl) =>
  s.zhuyin.replace(/[ˊˇˋ˙]/g, "") +
  ({ 1: "", 2: "ˊ", 3: "ˇ", 4: "ˋ", 5: "" } as Record<number, string>)[s.surface_tone];
