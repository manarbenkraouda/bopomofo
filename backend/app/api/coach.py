"""The coach: the current plan and its steps, a new plan on request, the plan story, and the alphabet status."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import coach, limits, story

router = APIRouter()


@router.get("/coach")
def coach_get():
    r = coach.refresh()
    return coach.state(r.get("levels"))


@router.get("/alphabet")
def alphabet_get():
    """Which of the 37 symbols the learner knows, for the Symbols screen. Read only: it does not refresh the plan."""
    return coach.alphabet_status()


class PlanIn(BaseModel):
    reason: str = Field(default="", max_length=300)


@router.post("/coach/plan")
def coach_plan(body: PlanIn):
    limits.check_ai()
    coach.start(body.reason.strip() or "The learner asked for a new plan now.")
    return coach.state()


@router.get("/coach/plan/{pid}/story")
def coach_story(pid: int):
    s = story.get(pid)
    if not s:
        raise HTTPException(404, "This plan has no story yet")
    return s


@router.post("/coach/plan/{pid}/story")
def coach_story_write(pid: int):
    """Write the headline and story of a saved plan again (older plans, or after a failure). Runs in the background."""
    if not coach._plan_row(pid):
        raise HTTPException(404, "No such plan")
    limits.check_ai()
    coach.start_story(pid)
    return coach.state()


class SkipIn(BaseModel):
    reason: str = "not_now"


@router.post("/coach/step/{sid}/skip")
def coach_skip(sid: int, body: SkipIn):
    return coach.skip(sid, body.reason)


@router.get("/coach/step/{sid}")
def coach_step(sid: int):
    coach.refresh()
    s = coach.step_state(sid)
    if not s:
        raise HTTPException(404, "No such step")
    return s
