"""Numbers in Taiwan Mandarin: the characters of a number, its size band, and the kind of error in a wrong answer.

The frontend has the same rules in frontend/src/lib/numbers.ts. Keep them the same."""

from __future__ import annotations

DIGITS = "零一二三四五六七八九"
MAX = 99_999_999
# The size bands are the context of every number answer: the errors change with the size (place words, 零, 萬).
BANDS = ("0-10", "11-99", "100-999", "1000-9999", "10000+")
ERRORS = {
    "teens": "a teen taken for a ten (14 and 40: 十四 and 四十)",
    "order": "the same digits in another order (41 and 14)",
    "place": "the right digits at the wrong place value (30 and 300, 零 missed)",
    "digit": "one digit wrong",
    "4-10": "4 and 10 taken for each other (四 sì and 十 shí sound close)",
    "other": "another number",
    "tone": "a tone said wrong",
    "sound": "an initial or a final said wrong",
    "missed": "a syllable not heard",
}


def _small(n: int, first: bool) -> str:
    """1 to 9999. first: the number starts here, so 10-19 is said 十… (not 一十…)."""
    out, zero = "", False
    for value, unit in ((1000, "千"), (100, "百"), (10, "十"), (1, "")):
        d = n // value % 10
        if d == 0:
            zero = zero or bool(out)
            continue
        if zero:
            out, zero = out + "零", False
        if value == 10 and d == 1 and not out and first:
            out += "十"
            continue
        # Taiwan usage: 兩 before 百 and 千 (兩百, 兩千), 二 in the tens and the units (二十二).
        out += ("兩" if d == 2 and value >= 100 else DIGITS[d]) + unit
    return out


def hanzi(n: int) -> str:
    """The characters said for a number from 0 to 99 999 999: 15 -> 十五, 205 -> 兩百零五, 20000 -> 兩萬."""
    if not 0 <= n <= MAX:
        raise ValueError(f"number out of range: {n}")
    if n == 0:
        return "零"
    hi, lo = divmod(n, 10000)
    if not hi:
        return _small(lo, True)
    out = ("兩" if hi == 2 else _small(hi, True)) + "萬"
    if lo:
        out += ("零" if lo < 1000 else "") + _small(lo, False)
    return out


def band(n: int) -> str:
    """The size band of a number (BANDS)."""
    if n <= 10:
        return "0-10"
    if n <= 99:
        return "11-99"
    if n <= 999:
        return "100-999"
    return "1000-9999" if n <= 9999 else "10000+"


def error_of(expected: int, picked: int) -> str | None:
    """The kind of a listening error (ERRORS), or None when the answer is right."""
    if expected == picked:
        return None
    e, p = str(expected), str(picked)
    lo, hi = sorted((expected, picked))
    if 11 <= lo <= 19 and hi == (lo - 10) * 10:
        return "teens"
    if len(e) == len(p) and sorted(e) == sorted(p):
        return "order"
    if e.replace("0", "") == p.replace("0", ""):
        return "place"
    if len(e) == len(p) and sum(a != b for a, b in zip(e, p, strict=True)) == 1:
        return "digit"
    if {expected, picked} == {4, 10}:
        return "4-10"
    return "other"
