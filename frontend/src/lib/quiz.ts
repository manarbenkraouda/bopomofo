// Shared by the reading and writing quizzes.

// How each symbol is said when you read it on its own, written in Bopomofo only (no pinyin: the quizzes
// build memory of the symbols themselves).
export const SYMBOL_NAME: Record<string, string> = {
  ...Object.fromEntries([..."ㄅㄆㄇㄈ"].map((s) => [s, s + "ㄛ"])),
  ...Object.fromEntries([..."ㄉㄊㄋㄌㄍㄎㄏ"].map((s) => [s, s + "ㄜ"])),
  ...Object.fromEntries([..."ㄐㄑㄒ"].map((s) => [s, s + "ㄧ"])),
  ...Object.fromEntries([..."ㄓㄔㄕㄖㄗㄘㄙㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ"].map((s) => [s, s])),
};

export type SymbolSet = "all" | "initials" | "finals";
export const SET_LABEL: Record<SymbolSet, string> = { all: "All 37", initials: "Initials ㄅ–ㄙ", finals: "Finals ㄚ–ㄩ" };
/** The MOE table lists the 21 initials first, then the 16 finals. */
export const inSet = <T,>(rows: T[], set: SymbolSet) => (set === "initials" ? rows.slice(0, 21) : set === "finals" ? rows.slice(21) : rows);

