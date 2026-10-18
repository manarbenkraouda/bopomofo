import { expect, test } from "bun:test";
import data from "../../public/data/characters.json";
import { allWords, choices, pickWord, sentenceWords, type CharData } from "./characters";
import type { Sentence } from "./api";

const syl = (char: string, zhuyin: string) =>
  ({
    type: "syllable",
    char,
    zhuyin,
    initial: "",
    final: "",
    tone: 1,
    surface_tone: 1,
    pinyin: "",
    alt_tones: [],
  }) as const;

const sentence: Sentence = {
  id: 1,
  hanzi: "我喝咖啡。",
  english: "I drink coffee.",
  words: [
    { text: "我", english: "I" },
    { text: "喝", english: "to drink" },
    { text: "咖啡", english: "coffee" },
    { text: "。", english: "" },
  ],
  topic: "",
  level: "",
  created: 0,
  items: [syl("我", "ㄨㄛˇ"), syl("喝", "ㄏㄜ"), syl("咖", "ㄎㄚ"), syl("啡", "ㄈㄟ"), { type: "text", text: "。" }],
};

test("sentence words keep their Bopomofo and skip punctuation", () => {
  expect(sentenceWords([sentence])).toEqual([
    { text: "我", zhuyin: "ㄨㄛˇ", english: "I", source: "sentence" },
    { text: "喝", zhuyin: "ㄏㄜ", english: "to drink", source: "sentence" },
    { text: "咖啡", zhuyin: "ㄎㄚ ㄈㄟ", english: "coffee", source: "sentence" },
  ]);
});

test("a course word wins over the same word from a sentence", () => {
  const words = allWords(data as CharData, sentenceWords([sentence]));
  expect(words.filter((w) => w.text === "我")).toEqual([
    expect.objectContaining({ source: "deck", english: "I, me" }) as never,
  ]);
  expect(words.some((w) => w.text === "咖啡" && w.source === "sentence")).toBe(true);
});

test("choices start with the look-alikes and never repeat a meaning", () => {
  const words = allWords(data as CharData, []);
  for (let i = 0; i < 50; i++) {
    const ta = words.find((w) => w.text === "她")!;
    const c = choices(ta, words, (data as CharData).lookalikes);
    expect(c.length).toBe(4);
    expect(c.map((w) => w.text)).toEqual(expect.arrayContaining(["她", "他", "它"]));
    expect(new Set(c.map((w) => w.english)).size).toBe(4);
  }
});

test("the focus words come first", () => {
  const words = allWords(data as CharData, []);
  expect(pickWord(words, ["妳"], null, () => 0)?.text).toBe("妳");
  expect(pickWord(words, ["妳"], "妳", () => 0)?.text).not.toBe("妳");
});
