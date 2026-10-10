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

/**
 * Random pick without end. Symbols with a higher miss rate come up more often,
 * and the last few picks do not repeat.
 */
export function pickWeighted<T extends { sym: string }>(pool: T[], missRate: Record<string, number>, recent: string[]): T {
  const options = pool.filter((r) => !recent.includes(r.sym));
  const from = options.length ? options : pool;
  const weight = (r: T) => 1 + 4 * (missRate[r.sym] ?? 0.3);
  let x = Math.random() * from.reduce((a, r) => a + weight(r), 0);
  return from.find((r) => (x -= weight(r)) <= 0) ?? from[from.length - 1];
}

/** Update a miss rate after one card: a first-try success lowers it, anything else raises it. */
export const updateMiss = (rate: number | undefined, firstTry: boolean) => (rate ?? 0.3) * 0.6 + (firstTry ? 0 : 0.4);

/**
 * Learn mode: every symbol of the pool once per round, in a new random order each round, so the repetitions stay even.
 * order holds the symbols still to show in this round.
 */
export function cycleNext<T extends { sym: string }>(pool: T[], order: string[], last?: string): T {
  const syms = pool.map((r) => r.sym);
  if (!order.length || order.some((s) => !syms.includes(s))) {
    const round = [...syms].sort(() => Math.random() - 0.5);
    if (round.length > 1 && round[0] === last) round.push(round.shift()!);
    order.splice(0, order.length, ...round);
  }
  const sym = order.shift()!;
  return pool.find((r) => r.sym === sym) ?? pool[0];
}

