"""Small validators for model output. Each one returns a safe value and never raises."""

from __future__ import annotations

import json

from .settings import BOPOMOFO


def tones(v, allow5=True) -> list[int]:
    """The distinct tones in v, from 1 to 5 (to 4 when allow5 is False). Other values are dropped."""
    out = []
    for t in v or []:
        try:
            t = int(t)
        except (TypeError, ValueError):
            continue
        if 1 <= t <= (5 if allow5 else 4) and t not in out:
            out.append(t)
    return out


def syms(v, single=False) -> list[str]:
    """The distinct Bopomofo items in v: 1 to 3 symbols each (1 when single is True). Other values are dropped."""
    out = []
    for s in v or []:
        s = str(s).strip()
        if s and all(c in BOPOMOFO for c in s) and len(s) <= (1 if single else 3) and s not in out:
            out.append(s)
    return out


def pairs(v) -> list[str]:
    """The distinct tone pairs in v, written "a-b". "3 - 3" gives "3-3"."""
    out = []
    for p in v or []:
        t = tones(str(p).replace(" ", "").split("-"))
        if len(t) == 1 and str(p).count("-") == 1 and str(p).split("-")[0].strip() == str(p).split("-")[1].strip():
            t = t * 2  # "3-3"
        if len(t) == 2 and f"{t[0]}-{t[1]}" not in out:
            out.append(f"{t[0]}-{t[1]}")
    return out


def integer(v, lo: int, hi: int, default: int) -> int:
    """v rounded and kept in lo..hi, or default when v is not a number."""
    try:
        return max(lo, min(hi, round(float(v))))
    except (TypeError, ValueError):
        return default


def number(v, lo: float, hi: float, default: float) -> float:
    """v kept in lo..hi, or default when v is not a number."""
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return default


def text(v, n: int) -> str:
    """v on one line with single spaces, cut to n characters."""
    return " ".join(str(v or "").split())[:n]


def texts(v, n: int, size: int = 200) -> list[str]:
    """The first n items of v as short texts (size characters each). An item that is not text is written as JSON."""
    return [text(x if isinstance(x, str) else json.dumps(x, ensure_ascii=False), size) for x in (v or []) if x][:n]
