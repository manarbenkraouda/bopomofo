"""Limits for each user, so that one account cannot use up the AI credit, the CPU, or the disk of the server.

Each paid AI call and each new text-to-speech clip is a row in usage_log (with the cost in USD for an AI call).
AI energy refills at midnight in the user's time zone. The audio limit uses the last 24 hours.
Rows older than two days are deleted.
Work without a user (tests, tools) is not counted: every API route that leads to this work needs a sign-in.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta

from . import db
from .config import AI_DAILY_CALLS, AI_DAILY_LIMIT_USD, TTS_DAILY_CLIPS

DAY = 86400


class LimitReached(RuntimeError):
    """The user reached a limit. The API answers 429 with this message."""

    def __init__(self, message: str, ai_quota: dict | None = None):
        super().__init__(message)
        self.ai_quota = ai_quota


def _used(kind: str) -> tuple[int, float]:
    with db.conn() as c:
        n, cost = c.execute("SELECT COUNT(*), COALESCE(SUM(cost), 0) FROM usage_log WHERE kind=? AND ts>=?",
                            (kind, time.time() - DAY)).fetchone()
    return int(n), float(cost)


def ai_quota() -> dict:
    """One server-clock snapshot for both admission and the visible energy meter. RLS scopes usage to this user."""
    now = time.time()
    tz = db.user_tz()
    today = datetime.fromtimestamp(now, tz).date()
    start = datetime.combine(today, datetime.min.time(), tzinfo=tz).timestamp()
    reset = datetime.combine(today + timedelta(days=1), datetime.min.time(), tzinfo=tz).timestamp()
    with db.conn() as c:
        n, cost = c.execute("SELECT COUNT(*), COALESCE(SUM(cost), 0) FROM usage_log WHERE kind='ai' AND ts>=? AND ts<?",
                            (start, reset)).fetchone()
    n, cost = int(n), float(cost)
    blocked = n >= AI_DAILY_CALLS or cost >= AI_DAILY_LIMIT_USD
    used = max(n / max(1, AI_DAILY_CALLS), cost / max(0.000001, AI_DAILY_LIMIT_USD))
    return {"user_id": db.current_user(), "blocked": blocked, "calls": n, "call_limit": AI_DAILY_CALLS,
            "cost": cost, "cost_limit": AI_DAILY_LIMIT_USD,
            "remaining_percent": 0 if blocked else max(1, round(100 * (1 - min(1, used)))),
            "server_now": now, "period_started_at": start, "resets_at": reset, "timezone": tz.key}


def check_ai() -> None:
    """Before a paid AI call."""
    if not db.current_user():
        return
    quota = ai_quota()
    if quota["blocked"]:
        raise LimitReached("You reached the daily AI limit. Your AI energy refills at midnight.", quota)


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
