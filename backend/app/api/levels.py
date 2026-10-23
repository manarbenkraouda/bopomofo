"""The level path, the placement test, and the tone change rules that the rule exercises practice."""

from __future__ import annotations

from functools import cache

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import levels, placement
from ..zhuyin import RULES, rule_phrases
from .notices import refresh_notices

router = APIRouter()


@cache
def _rule_phrases() -> list[dict]:
    """Made once, on the first request."""
    return rule_phrases()


@router.get("/rules")
def rules_get():
    """The tone change rules (3-3, 不, 一) and the short phrases of the rule exercises, with the written and the said tone."""
    return {"rules": RULES, "phrases": _rule_phrases()}


@router.get("/levels")
def levels_get():
    """The level path: levels, goals, stars per exercise and item, known items that dropped, and unseen notices.
    Saves new unlocks (they are permanent), like every answer does."""
    return levels.check()


class SeenIn(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=100)


@router.post("/levels/seen")
def levels_seen(body: SeenIn):
    levels.mark_seen(body.ids)
    return {"ok": True}


@router.get("/placement")
def placement_get():
    """The placement test: what it asks (symbols, syllables, sentences), whether it is due, and the result when done."""
    return placement.content()


class PlacementIn(BaseModel):
    # 37 symbols; up to three recordings per voice card, with room for content changes.
    alphabet_ids: list[int] = Field(default_factory=list, max_length=120)
    voice_ids: list[int] = Field(default_factory=list, max_length=360)
    voice_skipped: bool = False


@router.post("/placement/finish")
def placement_finish(body: PlacementIn):
    """Score the saved answers of the test, open the levels it proves, and save the result. Only once."""
    if not placement.due():
        raise HTTPException(409, "The placement test is already done.")
    res = placement.finish(body.alphabet_ids, body.voice_ids, body.voice_skipped)
    return {"result": res, "notices": refresh_notices()}
