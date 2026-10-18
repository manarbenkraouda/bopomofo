// Traditional characters: the course words (public/data/characters.json) and the words of the learner's sentences.
// The exercise shows a word and asks for its meaning; this file builds the word list and the 4 choices.
import type { Sentence, Syl } from "./api";

export type Source = "deck" | "sentence";
export type CharWord = { text: string; zhuyin: string; english: string; french?: string; source: Source };
export type CharData = { words: Omit<CharWord, "source">[]; lookalikes: string[][] };

// Longer words are phrases: their meaning is guessed from one known character more than read.
const MAX_LEN = 4;
const CJK = /^[\u4e00-\u9fff]+$/;

/** The words of the sentences with a meaning, 1 to 4 characters, each one once. The Bopomofo comes from the sentence. */
export function sentenceWords(sentences: Sentence[]): CharWord[] {
  const out = new Map<string, CharWord>();
  for (const s of sentences) {
    let from = 0;
    for (const w of s.words ?? []) {
      const at = s.hanzi.indexOf(w.text, from);
      if (at < 0) continue;
      from = at + w.text.length;
      const english = (w.english ?? "").trim();
      if (!english || !CJK.test(w.text) || w.text.length > MAX_LEN || out.has(w.text)) continue;
      // The items of a sentence are one per character, so the word's characters are the same slice.
      const syls = s.items.slice(at, at + w.text.length).filter((x): x is Syl => x.type === "syllable");
      if (syls.length !== w.text.length) continue;
      out.set(w.text, { text: w.text, zhuyin: syls.map((x) => x.zhuyin).join(" "), english, source: "sentence" });
    }
  }
  return [...out.values()];
}

/** The course words first, then the sentence words that are not course words. */
export function allWords(data: CharData, fromSentences: CharWord[]): CharWord[] {
  const deck = data.words.map((w) => ({ ...w, source: "deck" as const }));
  const have = new Set(deck.map((w) => w.text));
  return [...deck, ...fromSentences.filter((w) => !have.has(w.text))];
}

export const lookalikesOf = (text: string, groups: string[][]) =>
  (groups.find((g) => g.includes(text)) ?? []).filter((x) => x !== text);

const meaning = (w: CharWord) => w.english.trim().toLowerCase();

function shuffle<T>(a: T[], rnd: () => number): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** 4 choices: the word, its look-alikes (他 for 她), then other words. No two choices share a meaning. */
export function choices(word: CharWord, words: CharWord[], groups: string[][], rnd = Math.random): CharWord[] {
  const out = [word];
  const seen = new Set([meaning(word)]);
  const add = (w: CharWord | undefined) => {
    if (!w || out.length >= 4 || out.some((x) => x.text === w.text) || seen.has(meaning(w))) return;
    out.push(w);
    seen.add(meaning(w));
  };
  const byText = new Map(words.map((w) => [w.text, w]));
  for (const t of shuffle(lookalikesOf(word.text, groups), rnd)) add(byText.get(t));
  // Then words of the same length, so the length of the meaning does not give the answer away as often.
  const others = shuffle(
    words.filter((w) => w.text !== word.text),
    rnd,
  );
  for (const w of others) if (w.text.length === word.text.length) add(w);
  for (const w of others) add(w);
  return shuffle(out, rnd);
}

/** The next word: from the focus words first; without a focus, about 30% from the learner's sentences. */
export function pickWord(words: CharWord[], focus: string[], last: string | null, rnd = Math.random): CharWord | null {
  const pool = words.filter((w) => w.text !== last);
  if (!pool.length) return words[0] ?? null;
  const inFocus = pool.filter((w) => focus.includes(w.text));
  // With a focus, some words still come from outside it, so a short list does not loop.
  if (inFocus.length && rnd() < 0.75) return inFocus[Math.floor(rnd() * inFocus.length)];
  const mine = pool.filter((w) => w.source === "sentence");
  const deck = pool.filter((w) => w.source === "deck");
  const from = mine.length && (!deck.length || rnd() < 0.3) ? mine : deck;
  return from[Math.floor(rnd() * from.length)];
}
