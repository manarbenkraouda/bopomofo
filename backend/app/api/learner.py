"""The learner: profile, settings, onboarding, and the daily AI energy."""

from __future__ import annotations

import time
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .. import db, learner, levels, limits, llm, placement

router = APIRouter()

UNKNOWN_TIMEZONE = "Unknown time zone. Pick one from the list."


@router.get("/profile")
def profile_get():
    return db.get_profile()


@router.put("/profile")
def profile_put(body: dict[str, str]):
    clean = {k: v.strip()[:1000] for k, v in body.items() if k in llm.PROFILE_LABELS}
    return db.set_profile(clean)


@router.get("/me")
def me_get():
    """The signed-in learner's settings, and whether the onboarding is done."""
    return learner.state()


@router.get("/ai/quota")
def ai_quota_get():
    """Daily energy and the next midnight, for the signed-in learner's countdown. No AI work is started."""
    return JSONResponse(limits.ai_quota(), headers={"Cache-Control": "no-store"})


class OnboardingIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    reasons: list[Literal["travel", "family", "live", "work", "culture", "fun"]] = Field(
        default_factory=list, max_length=6
    )
    level: Literal["new", "words", "everyday", "fluent"]
    bopomofo: Literal["none", "some", "reads"]
    goal_min: int = Field(ge=5, le=120)
    timezone: str = Field(max_length=64)


@router.post("/onboarding")
def onboarding(body: OnboardingIn):
    tz = db.valid_timezone(body.timezone)
    if not tz:
        raise HTTPException(400, UNKNOWN_TIMEZONE)
    p = db.get_profile()
    p["name"] = body.name.strip()
    p["level"] = learner.LEVEL_TEXT[body.level][0] + ". " + learner.BOPOMOFO_TEXT[body.bopomofo] + "."
    if body.reasons and not p.get("why_mandarin", "").strip():
        p["why_mandarin"] = "I learn Mandarin " + ", ".join(learner.REASON_TEXT[r] for r in body.reasons) + "."
    db.set_profile({k: str(v)[:1000] for k, v in p.items() if k in llm.PROFILE_LABELS})
    db.save_settings(
        {
            "timezone": tz,
            "goal_min": body.goal_min,
            "level": body.level,
            "bopomofo": body.bopomofo,
            "reasons": list(dict.fromkeys(body.reasons)),
            "onboarded_at": time.time(),
        }
    )
    # Intermediate and advanced learners take the placement test next (placement.py), before the first plan.
    placement.on_onboarding(body.level)
    # No plan yet: Home first asks for the rest of the profile, then the coach builds the first plan.
    return learner.state()


class SettingsIn(BaseModel):
    timezone: str | None = Field(default=None, max_length=64)
    goal_min: int | None = Field(default=None, ge=5, le=120)
    # Open the exercises up to this level without the level goals. 1 follows the progress only. Earned levels stay open.
    open_level: int | None = Field(default=None, ge=1, le=levels.MAX_LEVEL)
    # The card order settings (learner.REVIEW_RANGES). Unknown keys are dropped and values are pulled into range.
    review: dict | None = None


@router.put("/settings")
def settings_put(body: SettingsIn):
    changes: dict = {}
    if body.timezone is not None:
        if not (tz := db.valid_timezone(body.timezone)):
            raise HTTPException(400, UNKNOWN_TIMEZONE)
        changes["timezone"] = tz
    if body.goal_min is not None:
        changes["goal_min"] = body.goal_min
    if body.open_level is not None:
        changes["open_level"] = body.open_level
    if body.review is not None:
        changes["review"] = learner.clean_review(body.review)
    if changes:
        db.save_settings(changes)
    return learner.state()
