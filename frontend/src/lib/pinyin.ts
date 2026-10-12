// Pinyin answers for the recognize quiz: which Bopomofo symbol a typed pinyin spelling stands for.
// Each symbol accepts its bare pinyin letter(s) and the syllable it is named with when read alone (ㄅ = b or bo).
// No two symbols share a spelling, so a wrong answer always maps to the symbol the learner took it for.

/** The spelling shown as the answer, and the syllable the symbol is read as on its own when it differs. */
export const PINYIN_ANSWER: Record<string, { main: string; name?: string }> = {
  "ㄅ": { main: "b", name: "bo" }, "ㄆ": { main: "p", name: "po" }, "ㄇ": { main: "m", name: "mo" }, "ㄈ": { main: "f", name: "fo" },
  "ㄉ": { main: "d", name: "de" }, "ㄊ": { main: "t", name: "te" }, "ㄋ": { main: "n", name: "ne" }, "ㄌ": { main: "l", name: "le" },
  "ㄍ": { main: "g", name: "ge" }, "ㄎ": { main: "k", name: "ke" }, "ㄏ": { main: "h", name: "he" },
  "ㄐ": { main: "j", name: "ji" }, "ㄑ": { main: "q", name: "qi" }, "ㄒ": { main: "x", name: "xi" },
  "ㄓ": { main: "zh", name: "zhi" }, "ㄔ": { main: "ch", name: "chi" }, "ㄕ": { main: "sh", name: "shi" }, "ㄖ": { main: "r", name: "ri" },
  "ㄗ": { main: "z", name: "zi" }, "ㄘ": { main: "c", name: "ci" }, "ㄙ": { main: "s", name: "si" },
  "ㄚ": { main: "a" }, "ㄛ": { main: "o" }, "ㄜ": { main: "e" }, "ㄝ": { main: "ê" }, "ㄞ": { main: "ai" }, "ㄟ": { main: "ei" },
  "ㄠ": { main: "ao" }, "ㄡ": { main: "ou" }, "ㄢ": { main: "an" }, "ㄣ": { main: "en" }, "ㄤ": { main: "ang" }, "ㄥ": { main: "eng" },
  "ㄦ": { main: "er" }, "ㄧ": { main: "i", name: "yi" }, "ㄨ": { main: "u", name: "wu" }, "ㄩ": { main: "ü", name: "yu" },
};

// Other accepted spellings: y and w (the spelling at the start of a syllable), and "eh" for ê.
const EXTRA: Record<string, string[]> = { "ㄧ": ["y"], "ㄨ": ["w"], "ㄝ": ["eh"] };

const BY_SPELLING: Record<string, string> = {};
for (const [sym, a] of Object.entries(PINYIN_ANSWER)) {
  for (const s of [a.main, ...(a.name ? [a.name] : []), ...(EXTRA[sym] ?? [])]) BY_SPELLING[s] = sym;
}

/** Lower case, no spaces, tone digits, or tone marks, and the usual keyboard spellings of ü and ê (v, u:, e^). */
export function normalizePinyin(text: string): string {
  return text.normalize("NFD").replace(/[\u0300\u0301\u0304\u030C]/g, "").normalize("NFC").toLowerCase()
    .replace(/[\s1-5]/g, "").replace(/u:|v/g, "ü").replace(/e\^/g, "ê");
}

/** The symbol a typed spelling stands for, or null when it is not the pinyin of any one symbol. */
export function symbolOfPinyin(text: string): string | null {
  return BY_SPELLING[normalizePinyin(text)] ?? null;
}

/** The answer as shown after a card: "zh (zhi)". */
export const answerText = (sym: string) => {
  const a = PINYIN_ANSWER[sym];
  return a ? a.main + (a.name ? " (" + a.name + ")" : "") : "";
};

