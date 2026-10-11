"""Limits for each user, so that one account cannot use up the AI credit, the CPU, or the disk of the server.

Each paid AI call and each new text-to-speech clip is a row in usage_log (with the cost in USD for an AI call).
A limit counts the user's rows of the last 24 hours. Rows older than two days are deleted.
Work without a user (tests, tools) is not counted: every API route that leads to this work needs a sign-in.
"""
from __future__ import annotations

import time

from . import db
from .config import AI_DAILY_CALLS, AI_DAILY_LIMIT_USD, TTS_DAILY_CLIPS

DAY = 86400


class LimitReached(RuntimeError):
    """The user reached a limit. The API answers 429 with this message."""


def _used(kind: str) -> tuple[int, float]:
    with db.conn() as c:
        n, cost = c.execute("SELECT COUNT(*), COALESCE(SUM(cost), 0) FROM usage_log WHERE kind=? AND ts>=?",
                            (kind, time.time() - DAY)).fetchone()
    return int(n), float(cost)


def check_ai() -> None:
    """Before a paid AI call."""
    if not db.current_user():
        return
    n, usd = _used("ai")
    if n >= AI_DAILY_CALLS or usd >= AI_DAILY_LIMIT_USD:
        raise LimitReached("You reached the daily AI limit. It resets within 24 hours.")


def check_tts() -> None:
    """Before a new text-to-speech clip."""
    if db.current_user() and _used("tts")[0] >= TTS_DAILY_CLIPS:
        raise LimitReached("You reached the daily audio limit. It resets within 24 hours.")


def record(kind: str, cost: float | None = None) -> None:
    if not db.current_user():
        return
    now = time.time()
    with db.conn() as c:
        c.execute("INSERT INTO usage_log(ts, kind, cost) VALUES (?,?,?)", (now, kind, cost))
        c.execute("DELETE FROM usage_log WHERE ts < ?", (now - 2 * DAY,))
