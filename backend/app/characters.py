"""Traditional characters: the course words in frontend/public/data/characters.json.

The exercise shows a character or word and asks for its meaning. The items come from this file (source "deck") and from the
words of the learner's own sentences (source "sentence"), so the backend reads the same file to check the coach's focus.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path

FILE = Path(__file__).resolve().parents[2] / "frontend" / "public" / "data" / "characters.json"
SOURCES = ("deck", "sentence")
MAX_LEN = 4  # longer words are phrases: the meaning test then measures guessing more than reading


@cache
def data() -> dict:
    try:
        return json.loads(FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"words": [], "lookalikes": []}


def deck() -> dict[str, dict]:
    """The course words by text."""
    return {w["text"]: w for w in data().get("words") or []}


def lookalike(text: str) -> list[str]:
    """The other words of the look-alike group of text (他 gives 她 and 它)."""
    for g in data().get("lookalikes") or []:
        if text in g:
            return [x for x in g if x != text]
    return []


def valid(text: str, sentence_texts: set[str] | list[str] = ()) -> bool:
    """A word the exercise can show: a course word, or 1 to 4 Chinese characters found in one of the learner's sentences."""
    if text in deck():
        return True
    if not text or len(text) > MAX_LEN or not all("\u4e00" <= c <= "\u9fff" for c in text):
        return False
    return any(text in s for s in sentence_texts)
