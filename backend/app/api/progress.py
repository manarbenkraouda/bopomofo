"""Answers and practice time: every answer is saved as one event with its units (see db.py and stats.py)."""

from __future__ import annotations

import time

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .. import db, typed_fix
from .notices import refresh_notices

router = APIRouter()


class AttemptIn(BaseModel):
    area: str
    item: str
    ok: bool
    score: float | None = None
    details: dict | None = None


@router.post("/progress/attempt")
def progress_attempt(body: AttemptIn):
    """Old format, kept for compatibility. New clients send /api/progress/event."""
    db.add_event(db.legacy_event(body.area, body.item, body.ok, body.score, body.details))
    return {"ok": True}


# One part of an answer that can be right or wrong (a tone, an initial, a symbol...). db.UNIT_KINDS lists the kinds.
class UnitIn(BaseModel):
    kind: str = Field(max_length=16)
    expected: str | int = Field()
    actual: str | int | None = None
    ok: bool | None = None
    pos: int = 0
    try_n: int = 0
    help: bool = False
    ctx: str | None = None
    lex: str | int | None = None
    prev: str | int | None = None
    next: str | int | None = None
    source: str | None = None
    uncertain: bool = False
    extra: dict | None = None


# One answer. details.step is the coach step it belongs to, if any.
class EventIn(BaseModel):
    area: str = Field(max_length=16)
    mode: str | None = Field(default=None, max_length=16)
    item: str = Field(max_length=400)
    ok: bool
    first_try: bool | None = None
    score: float | None = None
    ms: int | None = Field(default=None, ge=0, le=3_600_000)
    tries: int | None = None
    help: bool = False
    replays: int | None = None
    details: dict | None = None
    units: list[UnitIn] = Field(default_factory=list, max_length=300)


@router.post("/progress/event")
def progress_event(body: EventIn):
    ev = body.model_dump()
    details = ev.get("details") or {}
    if "step" in details:
        step = str(details["step"])
        details["step"] = int(step) if step.isdigit() else None
    eid = db.add_event(ev)
    # A card the learner fixed by typing the Pinyin (Reading): older misses of a pair confirmed often enough are fixed too.
    if any(u.get("source") == "typed" and u.get("ok") for u in ev.get("units") or []):
        typed_fix.apply_pairs()
    # Level notices (an unlock, a known item that dropped) go back with the answer, so the app can show them at once.
    return {"ok": True, "id": eid, "notices": refresh_notices()}


class DayIn(BaseModel):
    day: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    seconds: int = Field(ge=0, le=86400)
    goal_min: int | None = None


@router.put("/progress/day")
def progress_day(body: DayIn):
    db.save_day(body.day, body.seconds, body.goal_min)
    return {"ok": True}


@router.get("/progress/summary")
def progress_summary():
    return db.summary()


@router.get("/progress/memory")
def progress_memory(area: str, mode: str = ""):
    """Past tests per item of one practice mode, for the review schedule of the practice picks."""
    return {"now": time.time(), "items": db.memory(area[:16], mode[:16] or None)}
