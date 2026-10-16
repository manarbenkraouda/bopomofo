"""The coach state that the API sends to the app."""

from __future__ import annotations

import json
from collections import Counter

from .. import db, levels, limits, llm
from ..config import COACH_MODEL
from . import jobs, planner, store
from .gates import alphabet_status
from .progress import href, milestone_progress, step_progress
from .settings import STALE_UNITS, TYPES, VISIBLE_NOTES


def _step_view(s: dict) -> dict:
    """One step for the app: its fields, progress, URL, and the last note the learner sees."""
    meta = s["params"].get("meta") or {}
    note = store.query(
        f"SELECT kind, text, ts FROM coach_notes WHERE step_id=? AND {VISIBLE_NOTES} ORDER BY id DESC LIMIT 1",
        (s["id"],),
    )
    return {
        **{
            k: s[k]
            for k in (
                "id",
                "plan_id",
                "pos",
                "type",
                "title",
                "why",
                "target",
                "minutes",
                "status",
                "skip_reason",
                "done_ts",
            )
        },
        "params": {k: v for k, v in s["params"].items() if k != "meta"},
        "area": TYPES[s["type"]],
        "href": href(s),
        "finding_ids": meta.get("finding_ids") or [],
        "review": meta.get("review") or "",
        "note": note[0] if note else None,
        **step_progress(s),
    }


def _calls(plan_id: int) -> dict:
    """The count, cost, and tokens of the model calls of a plan."""
    rows = store.query("SELECT ts, stage, model, ms, cost, tokens, ok FROM coach_calls WHERE plan_id=?", (plan_id,))
    build_rows = [r for r in rows if not r["stage"].startswith(("checkpoint", "debrief"))]
    return {
        "count": len(rows),
        "build_count": len(build_rows),
        "failed": sum(1 for r in rows if not r["ok"]),
        "cost": round(sum(r["cost"] or 0 for r in rows), 4),
        "tokens": sum(r["tokens"] or 0 for r in rows),
        "seconds": round(max(r["ts"] for r in build_rows) - min(r["ts"] - (r["ms"] or 0) / 1000 for r in build_rows))
        if build_rows
        else None,
        "models": dict(Counter(r["model"] for r in rows if r["ok"] and r["model"])),
        "stages": dict(Counter(r["stage"].split(":")[0].split("#")[0] for r in rows)),
    }


def state(lv: dict | None = None) -> dict:
    """lv: the level status from refresh(), to avoid reading every answer twice."""
    plan = (
        store.plan() or (store.query("SELECT * FROM plans WHERE status!='next' ORDER BY id DESC LIMIT 1") or [None])[0]
    )
    # The first plan waits for the onboarding and the full profile, so its sentences use the learner's real life.
    # A learner who does not want to wait asks for it on Home (POST /api/coach/plan).
    job = jobs.current()
    if (
        not plan
        and not job["running"]
        and db.get_settings().get("onboarded_at")
        and not llm.profile_missing(db.get_profile())
    ):
        planner.start("First plan for this learner, with the full profile.")
        job = jobs.current()
    midnight = db.day_start(db.local_today())
    lv = lv or levels.status()
    use = store.query(
        "SELECT COUNT(*) AS n, SUM(cost) AS cost, COUNT(*) FILTER (WHERE ts>=?) AS today_n, SUM(CASE WHEN ts>=? THEN cost END) AS today_cost FROM coach_calls",
        (midnight, midnight),
    )[0]
    out: dict = {
        "generating": job["running"],
        "stage": job["stage"],
        "building_next": job["running"] and job["next"],
        "error": job["error"],
        "writing_story": job["story"],
        "started": job["started"],
        "plan": None,
        "steps": [],
        "milestones": [],
        "history": [],
        "notes": [],
        "next_ready": bool(store.query("SELECT id FROM plans WHERE status='next'")),
        "coach_model": COACH_MODEL,
        "alphabet": alphabet_status(),
        "levels": {k: v for k, v in lv.items() if k != "stars"},
        "ai_quota": limits.ai_quota(),
        "usage": {
            "calls": use["n"] or 0,
            "cost": round(use["cost"] or 0, 4),
            "today_calls": use["today_n"] or 0,
            "today_cost": round(use["today_cost"] or 0, 4),
        },
    }
    if plan:
        raw = json.loads(plan["raw"] or "{}")
        new_answers = store.query("SELECT COUNT(*) AS n FROM units WHERE ts>=?", (plan["ts"],))[0]["n"]
        out["plan"] = {
            k: plan[k]
            for k in ("id", "ts", "status", "source", "model", "diagnosis", "headline", "reason", "error", "done_ts")
        } | {
            "has_story": bool(plan.get("story")),
            "new_answers": new_answers,
            "stale": plan["status"] == "active" and new_answers >= STALE_UNITS,
            "findings": raw.get("findings") or [],
            "strengths": raw.get("strengths") or [],
            "unknown": raw.get("unknown") or [],
            "too_advanced": raw.get("too_advanced") or [],
            "pace": raw.get("pace"),
            "calls": _calls(plan["id"]),
        }
        out["steps"] = [_step_view(s) for s in store.steps(plan["id"])]
        out["notes"] = store.query(
            f"SELECT id, ts, step_id, kind, text FROM coach_notes WHERE plan_id=? AND {VISIBLE_NOTES} ORDER BY id DESC LIMIT 30",
            (plan["id"],),
        )
    for m in store.query(
        "SELECT * FROM milestones WHERE status IN ('active','achieved') ORDER BY status='achieved', id DESC LIMIT 20"
    ):
        c = json.loads(m["criterion"])
        out["milestones"].append(
            {k: m[k] for k in ("id", "ts", "title", "why", "status", "done_ts")}
            | {"criterion": c, **milestone_progress(c, lv)}
        )
    for p in store.query(
        "SELECT id, ts, status, source, diagnosis, headline, done_ts FROM plans WHERE status!='next' ORDER BY id DESC LIMIT 12"
    ):
        st = store.query("SELECT status FROM steps WHERE plan_id=?", (p["id"],))
        out["history"].append(
            {
                **p,
                "steps": len(st),
                "done": sum(1 for s in st if s["status"] == "done"),
                "skipped": sum(1 for s in st if s["status"] == "skipped"),
            }
        )
    return out


def step_state(step_id: int) -> dict | None:
    """The state of one step for the practice screen: the step, its plan, the next open step, and the job."""
    s = store.step(step_id)
    if not s:
        return None
    plan = store.plan(s["plan_id"])
    steps = store.steps(plan["id"])
    nxt = next((x for x in steps if x["status"] == "open" and x["id"] != step_id), None)
    if not nxt and plan["status"] != "active":
        cur = store.plan()
        nxt = next((x for x in store.steps(cur["id"]) if x["status"] == "open"), None) if cur else None
    job = jobs.current()
    return {
        "step": _step_view(s),
        "plan": {"id": plan["id"], "status": plan["status"]},
        "count": len(steps),
        "done": sum(1 for x in steps if x["status"] != "open"),
        "next": _step_view(nxt) if nxt else None,
        "generating": job["running"],
        "stage": job["stage"],
    }
