import { describe, expect, test } from "bun:test";
import { normalizePinyin, PINYIN_ANSWER, symbolOfPinyin } from "./pinyin";

describe("symbolOfPinyin", () => {
  test("every symbol is found from its own answer and its name", () => {
    for (const [sym, a] of Object.entries(PINYIN_ANSWER)) {
      expect(symbolOfPinyin(a.main)).toBe(sym);
      if (a.name) expect(symbolOfPinyin(a.name)).toBe(sym);
    }
  });
  test("near spellings map to the symbol they really stand for", () => {
    expect(symbolOfPinyin("z")).toBe("ㄗ"); // typed for ㄓ: saved as a ㄓ → ㄗ confusion
    expect(symbolOfPinyin("e")).toBe("ㄜ");
    expect(symbolOfPinyin("eh")).toBe("ㄝ");
    expect(symbolOfPinyin("eng")).toBe("ㄥ");
  });
  test("keyboard spellings of ü and ê, case, spaces and tone digits", () => {
    expect(symbolOfPinyin("v")).toBe("ㄩ");
    expect(symbolOfPinyin("u:")).toBe("ㄩ");
    expect(symbolOfPinyin("e^")).toBe("ㄝ");
    expect(symbolOfPinyin(" ZH ")).toBe("ㄓ");
    expect(symbolOfPinyin("yi1")).toBe("ㄧ");
    expect(normalizePinyin("u\u0308")).toBe("ü"); // ü typed as u + combining diaeresis
  });
  test("text that is no single symbol is refused", () => {
    for (const t of ["", "zz", "ba", "ing", "hello"]) expect(symbolOfPinyin(t)).toBeNull();
  });
});

