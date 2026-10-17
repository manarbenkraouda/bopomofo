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
        "sentence_level": LEVEL_TEXT[level][1] if level in LEVEL_TEXT else "beginner",
        "name": db.get_profile().get("name", ""),
    }
