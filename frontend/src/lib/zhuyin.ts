export const TONE_MARKS = ["ˊ", "ˇ", "ˋ", "˙"];
export const TONE_MARK: Record<number, string> = { 1: "", 2: "ˊ", 3: "ˇ", 4: "ˋ", 5: "˙" };
export const TONE_NAME: Record<number, string> = {
  1: "Tone 1 (high, flat)",
  2: "Tone 2 (rising)",
  3: "Tone 3 (low, dipping)",
  4: "Tone 4 (falling)",
  5: "Neutral tone",
};
export const INITIALS = [..."ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ"];
export const MEDIALS = [..."ㄧㄨㄩ"];
export const FINALS = [..."ㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦ"];

export function splitZhuyin(z: string): { symbols: string[]; tone: string; toneNum: number } {
  const chars = [...z];
  const tone = chars.find((c) => TONE_MARKS.includes(c)) || "";
  const toneNum = tone === "" ? 1 : tone === "ˊ" ? 2 : tone === "ˇ" ? 3 : tone === "ˋ" ? 4 : 5;
  return { symbols: chars.filter((c) => !TONE_MARKS.includes(c)), tone, toneNum };
}

export type SyllableItem = { id: string; char: string; zhuyin: string };
export type MoeRow = { audio: string; sym: string; strokes: number; note: string };
export type StrokeData = Record<string, { path: string; track: [number, number][] }[]>;

let cache: Promise<{ strokes: StrokeData; table: MoeRow[]; syllables: SyllableItem[] }> | null = null;
export function loadData() {
  cache ??= Promise.all(
    ["/data/strokes.json", "/data/moe-table.json", "/data/syllables.json"].map((u) => fetch(u).then((r) => r.json())),
  ).then(([strokes, table, syllables]) => ({ strokes, table, syllables }));
  return cache;
}
export const symbolAudio = (row: MoeRow) => "/audio/symbols/F" + row.audio.slice(1) + ".wav";
export const syllableAudio = (id: string) => "/audio/syllables/" + id + ".mp3";

// English versions of the MOE handbook notes (國語注音符號手冊).
export const NOTES: Record<string, string> = {
  ㄆ: "Last stroke ends without a sweeping flick.",
  ㄇ: "Last stroke has no hook.",
  ㄈ: "Stroke 2 starts where stroke 1 starts.",
  ㄊ: "The middle stroke slants down through the symbol.",
  ㄏ: "Strokes 1 and 2 start at the same point.",
  ㄐ: "The vertical-and-flick of stroke 1 does not cross stroke 2.",
  ㄓ: "MOE also allows a 3-stroke form.",
  ㄕ: "Stroke 3 starts where stroke 2 starts.",
  ㄖ: "The middle is a dot. MOE also allows a 3-stroke form.",
  ㄘ: "Last stroke has no hook.",
  ㄝ: "Last stroke has no hook.",
  ㄞ: "No hook at the bottom right.",
  ㄡ: "Last stroke has no flick; leave the top left open.",
  ㄢ: "Last stroke has no hook.",
  ㄤ: "Last stroke has no hook.",
  ㄦ: "Last stroke has no hook.",
  ㄧ: "In horizontal text, write ㄧ as a horizontal line. A vertical line is also accepted.",
  ㄨ: "Stroke 2 ends without a sweeping flick.",
};
export const PINYIN_OF: Record<string, string> = {
  ㄅ: "b",
  ㄆ: "p",
  ㄇ: "m",
  ㄈ: "f",
  ㄉ: "d",
  ㄊ: "t",
  ㄋ: "n",
  ㄌ: "l",
  ㄍ: "g",
  ㄎ: "k",
  ㄏ: "h",
  ㄐ: "j",
  ㄑ: "q",
  ㄒ: "x",
  ㄓ: "zh",
  ㄔ: "ch",
  ㄕ: "sh",
  ㄖ: "r",
  ㄗ: "z",
  ㄘ: "c",
  ㄙ: "s",
  ㄚ: "a",
  ㄛ: "o",
  ㄜ: "e",
  ㄝ: "ê",
  ㄞ: "ai",
  ㄟ: "ei",
  ㄠ: "ao",
  ㄡ: "ou",
  ㄢ: "an",
  ㄣ: "en",
  ㄤ: "ang",
  ㄥ: "eng",
  ㄦ: "er",
  ㄧ: "i / y",
  ㄨ: "u / w",
  ㄩ: "ü / yu",
};
