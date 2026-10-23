"""The learner's settings as the app reads them, and the onboarding answers written as profile text.

The profile gets the onboarding answers as text, so the sentence writer (llm.py) and the coach read them.
"""

from __future__ import annotations

from . import db, levels
from .config import DEFAULT_TIMEZONE

# Onboarding answer → the sentence of the profile.
REASON_TEXT = {
    "travel": "to travel in Taiwan",
    "family": "to talk with family and friends",
    "live": "because I live in Taiwan or plan to",
    "work": "for work or studies",
    "culture": "to enjoy shows, music, and games",
    "fun": "for fun and to keep my mind sharp",
}
# Onboarding answer → (the sentence of the profile, the level of the generated sentences).
LEVEL_TEXT = {
    "new": ("I am new to Mandarin", "beginner"),
    "words": ("I know some common words", "beginner"),
    "everyday": ("I can talk about everyday topics", "intermediate"),
    "fluent": ("I can talk about most topics", "advanced"),
}
BOPOMOFO_TEXT = {
    "none": "I do not know Bopomofo yet",
    "some": "I know some Bopomofo symbols",
    "reads": "I can read Bopomofo",
}

# The learner's settings for the card order: key → (lowest, highest). The same keys and slider ends as
# frontend/src/lib/reviewSettings.ts (REVIEW_STOPS). The top values of skipGap, longestWait, missCost, and hardRun
# mean "never", "no limit", "back to the start", and "no limit".
REVIEW_RANGES: dict[str, tuple[float, float]] = {
    "newAtOnce": (0, 100),
    "rightToLearn": (0, 20),
    "repeatSpacing": (0, 10),
    "missGap": (0, 50),
    "skipGap": (0, 51),
    "reviewTiming": (0, 10),
    "longestWait": (1, 3651),
    "missCost": (0, 11),
    "earlyCredit": (0, 100),
    "focusMix": (0, 100),
    "normalMix": (0, 100),
    "hardRun": (1, 21),
    "repeatGuard": (0, 20),
    "passScore": (0, 100),
    "helpCounts": (0, 1),
    "newOrder": (0, 2),
}
REVIEW_EXERCISES = ("reading", "recognize", "writing", "dictation", "listening", "rules", "speaking")


def _clean_part(part: object) -> dict[str, float]:
    """Known keys with numbers only, pulled into their range. Other keys and values are dropped."""
    if not isinstance(part, dict):
        return {}
    out: dict[str, float] = {}
    for k, v in part.items():
        if k not in REVIEW_RANGES or isinstance(v, bool) or not isinstance(v, int | float) or v != v:
            continue
        lo, hi = REVIEW_RANGES[k]
        out[k] = round(min(max(float(v), lo), hi), 1)
    return out


def clean_review(raw: object) -> dict:
    """The saved shape of the card order settings: {"all": {...}, "exercises": {exercise: {...}}}."""
    raw = raw if isinstance(raw, dict) else {}
    exercises = raw.get("exercises") if isinstance(raw.get("exercises"), dict) else {}
    return {
        "all": _clean_part(raw.get("all")),
        "exercises": {e: p for e in REVIEW_EXERCISES if (p := _clean_part(exercises.get(e)))},
    }


def state() -> dict:
    """The signed-in learner's settings, and whether the onboarding is done (GET /api/me)."""
    s = db.get_settings()
    level = s.get("level")
    return {
        "onboarded": bool(s.get("onboarded_at")),
        "timezone": s.get("timezone") or DEFAULT_TIMEZONE,
        "timezone_set": bool(s.get("timezone")),
        "goal_min": s.get("goal_min"),
        "level": level,
        "bopomofo": s.get("bopomofo"),
        "reasons": s.get("reasons") or [],
        "placement": (s.get("placement") or {}).get("status") or "none",
        "open_level": levels.manual_level(),
        "review": clean_review(s.get("review")),
        "sentence_level": LEVEL_TEXT[level][1] if level in LEVEL_TEXT else "beginner",
        "name": db.get_profile().get("name", ""),
    }
