"""Bopomofo (Zhuyin) helpers: text to syllables, Taiwan readings, tone sandhi."""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict, field

from pypinyin import Style, pinyin

INITIALS = set("ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ")
TONE_MARK_TO_NUM = {"ˊ": 2, "ˇ": 3, "ˋ": 4, "˙": 5}
TONE_NUM_TO_MARK = {1: "", 2: "ˊ", 3: "ˇ", 4: "ˋ", 5: "˙"}
CJK = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")

# Readings where the Taiwan standard (MOE) differs from the mainland reading that pypinyin returns.
TW_CHAR = {
    "期": "ㄑㄧˊ", "危": "ㄨㄟˊ", "微": "ㄨㄟˊ", "究": "ㄐㄧㄡˋ", "企": "ㄑㄧˋ", "髮": "ㄈㄚˇ",
    "質": "ㄓˋ", "液": "ㄧˋ", "擊": "ㄐㄧˊ", "綜": "ㄗㄨㄥˋ", "帆": "ㄈㄢˊ", "暫": "ㄓㄢˋ",
    "骰": "ㄊㄡˊ", "播": "ㄅㄛˋ", "誰": "ㄕㄟˊ", "跡": "ㄐㄧ", "穴": "ㄒㄩㄝˋ", "癌": "ㄞˊ",
    "息": "ㄒㄧ", "惜": "ㄒㄧ", "昔": "ㄒㄧ", "夕": "ㄒㄧ", "細": "ㄒㄧˋ",
}
TW_WORD = {"垃圾": ["ㄌㄜˋ", "ㄙㄜˋ"], "認識": ["ㄖㄣˋ", "ㄕˋ"], "頭髮": ["ㄊㄡˊ", "ㄈㄚˇ"], "一起": ["ㄧ", "ㄑㄧˇ"], "不是": ["ㄅㄨˋ", "ㄕˋ"]}


@dataclass
class Syllable:
    char: str
    zhuyin: str          # citation form, e.g. "ㄋㄧˇ"
    initial: str
    final: str
    tone: int            # citation tone 1-5
    surface_tone: int    # tone after sandhi (what a native speaker says)
    pinyin: str
    alt_tones: list[int] = field(default_factory=list)  # other tones a native speaker may also use here

    def dict(self):
        return asdict(self)


def split_zhuyin(z: str) -> tuple[str, str, int]:
    tone = 1
    for m, n in TONE_MARK_TO_NUM.items():
        if m in z:
            tone = n
            z = z.replace(m, "")
    initial = z[0] if z and z[0] in INITIALS else ""
    return initial, z[len(initial):], tone


def zhuyin_of(initial: str, final: str, tone: int) -> str:
    mark = TONE_NUM_TO_MARK.get(tone, "")
    return ("˙" if tone == 5 else "") + initial + final + (mark if tone != 5 else "")


def _readings(text: str) -> list[str | None]:
    chars = list(text)
    raw = pinyin(text, style=Style.BOPOMOFO, errors=lambda s: [None] * len(s))
    out: list[str | None] = [r[0] if r else None for r in raw]
    # pypinyin returns one entry per CJK char and one per non-CJK char run; realign to chars.
    if len(out) != len(chars):
        out = [pinyin(c, style=Style.BOPOMOFO)[0][0] if CJK.match(c) else None for c in chars]
    for i, c in enumerate(chars):
        if not CJK.match(c):
            out[i] = None
        elif c in TW_CHAR:
            out[i] = TW_CHAR[c]
    for w, zs in TW_WORD.items():
        for m in re.finditer(re.escape(w), text):
            for k, z in enumerate(zs):
                out[m.start() + k] = z
    # Show the citation tones of 一 and 不 (sandhi is applied separately).
    for i, c in enumerate(chars):
        if c == "一" and out[i]:
            out[i] = "ㄧ"
        if c == "不" and out[i]:
            out[i] = "ㄅㄨˋ"
        if out[i] and "˙" in out[i]:
            out[i] = "˙" + out[i].replace("˙", "")  # Taiwan writes the neutral-tone dot first
    return out


def _pinyin_marks(text: str) -> list[str | None]:
    raw = pinyin(text, style=Style.TONE, errors=lambda s: [None] * len(s))
    out = [r[0] if r else None for r in raw]
    if len(out) != len(text):
        out = [pinyin(c, style=Style.TONE)[0][0] if CJK.match(c) else None for c in text]
    return out


def apply_sandhi(sylls: list[Syllable]) -> None:
    """Set surface_tone: 3-3 sandhi, 一 and 不 sandhi. Runs on syllables of one phrase."""
    for s in sylls:
        s.surface_tone = s.tone
        s.alt_tones = []
    n = len(sylls)
    for i, s in enumerate(sylls):
        nxt = sylls[i + 1] if i + 1 < n else None
        if s.char == "不" and nxt and nxt.tone == 4:
            s.surface_tone = 2
        # 一 changes tone only as a number or "one ..." before a word, not at the end of words like 星期一, 第一, 唯一.
        if s.char == "一" and nxt and (i == 0 or sylls[i - 1].char not in "第初十期統唯萬之一"):
            s.surface_tone = 2 if nxt.tone == 4 else 4 if nxt.tone in (1, 2, 3) else 1
    # Third-tone sandhi: in a run of third tones, all but the last become tone 2.
    i = 0
    while i < n:
        if sylls[i].surface_tone == 3:
            j = i
            while j + 1 < n and sylls[j + 1].surface_tone == 3:
                j += 1
            for k in range(i, j):
                sylls[k].surface_tone = 2
            # In runs of 3+ third tones, the grouping is free: earlier syllables may stay tone 3.
            for k in range(i, j - 1):
                sylls[k].alt_tones = [3]
            i = j + 1
        else:
            i += 1


def analyze_text(text: str) -> list[dict]:
    """Return one entry per character: syllable info for Chinese characters, punctuation otherwise."""
    readings = _readings(text)
    py = _pinyin_marks(text)
    items: list[dict] = []
    phrase: list[Syllable] = []

    def flush():
        apply_sandhi(phrase)
        phrase.clear()

    for i, c in enumerate(text):
        z = readings[i]
        if z:
            ini, fin, tone = split_zhuyin(z)
            s = Syllable(c, z, ini, fin, tone, tone, py[i] or "")
            phrase.append(s)
            items.append({"type": "syllable", "syllable": s})
        else:
            flush()
            items.append({"type": "text", "text": c})
    flush()
    return [{"type": "syllable", **it["syllable"].dict()} if it["type"] == "syllable" else it for it in items]


def syllables_of(text: str) -> list[dict]:
    return [x for x in analyze_text(text) if x["type"] == "syllable"]
