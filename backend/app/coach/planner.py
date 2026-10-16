"""Build a plan: run the pipeline (or the fallback), apply the gates, and save the plan, its steps, and its story."""

from __future__ import annotations

import asyncio
import json
import time
import traceback
import uuid
from collections import Counter

from .. import db, levels, limits, llm
from . import jobs, settings, store, validate
from .cleaning import clean_milestone, clean_step
from .digest import digest
from .fallback import rules_plan
from .gates import (
    alphabet_gate,
    alphabet_sentence,
    alphabet_status,
    needs_alphabet,
    rules_gate,
    rules_sentence,
    rules_status,
)
from .pipeline import pipeline
from .progress import milestone_progress


def _run_pipeline(d: dict, reason: str, run: str) -> dict:
    """The default pipeline runner: run the async pipeline to its end."""
    return asyncio.run(pipeline(d, reason, run))


def build(reason: str, run_pipeline=None, as_next: bool = False) -> int:
    """Build and save a new plan. run_pipeline(digest, reason, run) -> result can replace the model pipeline in tests.
    as_next: the plan waits (status 'next') until the active plan is finished."""
    jobs.set_stage("Reading your answers")
    lv = levels.check()  # new unlocks and drops first, so the plan matches the level the learner sees
    d = digest(lv)
    op = d["_open"]
    run = uuid.uuid4().hex[:12]
    error = None
    try:
        out = (run_pipeline or _run_pipeline)(d, reason, run)
        source = "llm"
        if not out.get("steps"):
            raise llm.LLMError("The plan had no steps.")
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        out, source, error = rules_plan(d), "rules", f"{type(e).__name__}: {e}"[:400]
        known = {s["text"] for s in d["sentences"]["weak"]}
        out["steps"] = [c for c in (clean_step(s, known, 1.0, op) for s in out["steps"]) if c]
    # A rule of the app, whatever the model returned: no step of a locked exercise.
    out["steps"] = [s for s in out["steps"] if levels.step_allowed(s["type"], s["params"], op)]
    alpha = alphabet_status()
    out["steps"], removed = alphabet_gate(out["steps"], alpha, op)
    # The tone rules come before sentences: rule steps right after the alphabet steps, and no sentence steps until they are known.
    rs = rules_status(lv)
    n_alpha = sum(1 for s in out["steps"] if (s.get("meta") or {}).get("rule") == "alphabet")
    ruled, removed_r = rules_gate(out["steps"][n_alpha:], rs, op)
    out["steps"] = (out["steps"][:n_alpha] + ruled)[:7]
    removed += removed_r
    # Known items that dropped get a short review right after the alphabet steps.
    review = levels.remediation(lv)
    if review:
        n = sum(1 for s in out["steps"] if (s.get("meta") or {}).get("rule") in ("alphabet", "tone_rules"))
        out["steps"] = (out["steps"][:n] + review + out["steps"][n:])[:7]
        out["diagnosis"] = (
            "Review first: "
            + ", ".join(s["title"].removeprefix("Review: ") for s in review)
            + " slipped below your known level. "
            + (out.get("diagnosis") or "")
        )
    if source == "rules" and alpha["gate"]:
        out["diagnosis"] = (
            "Tone quizzes train your ear, but they do not show that you know the symbols. " + out["diagnosis"]
        )
    if alpha["gate"] and alpha["next_group"]:
        out["diagnosis"] = alphabet_sentence(alpha) + " " + (out.get("diagnosis") or "")
    if rs["gate"]:
        out["diagnosis"] = rules_sentence(rs) + " " + (out.get("diagnosis") or "")
    jobs.set_stage("Saving your plan")
    models = Counter(r["model"] for r in store.query("SELECT model FROM coach_calls WHERE run=? AND ok=1", (run,)))
    model = ", ".join(m for m, _ in models.most_common(3)) or None
    raw = {k: out.get(k) for k in ("findings", "strengths", "unknown", "too_advanced", "pace", "review")}
    raw["alphabet_rule"] = {
        "active": alpha["gate"],
        "known": alpha["known_count"],
        "next": alpha["next_group"],
        "removed_steps": removed,
    }
    raw["tone_rule"] = {
        "active": rs["gate"],
        "known": rs["known"],
        "missing": rs["missing"],
        "removed_steps": removed_r,
    }
    raw["level_rule"] = {
        "level": lv["level"],
        "exercises": lv["exercises"],
        "step_types": lv["step_types"],
        "review": [s["title"] for s in review],
        "drops": lv["drops"],
    }
    now = time.time()
    with db.conn() as c:
        has_active = c.execute("SELECT 1 FROM plans WHERE status='active'").fetchone()
        status = "next" if as_next and has_active else "active"
        c.execute(
            "UPDATE plans SET status='replaced', done_ts=? WHERE status IN "
            + ("('next')" if status == "next" else "('active','next')"),
            (now,),
        )
        pid = c.execute(
            "INSERT INTO plans(ts, status, source, model, diagnosis, reason, digest, raw, error) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id",
            (
                now,
                status,
                source,
                model,
                validate.text(out.get("diagnosis"), 1200),
                reason,
                json.dumps(d, ensure_ascii=False),
                json.dumps(raw, ensure_ascii=False),
                error,
            ),
        ).fetchone()["id"]
        for i, s in enumerate(out["steps"]):
            c.execute(
                "INSERT INTO steps(plan_id, pos, type, title, why, params, target, minutes) VALUES (?,?,?,?,?,?,?,?)",
                (
                    pid,
                    i,
                    s["type"],
                    s["title"],
                    s["why"],
                    json.dumps({**s["params"], "meta": s.get("meta") or {}}, ensure_ascii=False),
                    s["target"],
                    s["minutes"],
                ),
            )
        c.execute("UPDATE coach_calls SET plan_id=? WHERE run=?", (pid, run))
        ms = out.get("milestones")
        if source == "llm" and ms:
            keep = list(ms.get("keep") or [])
            c.execute(
                "UPDATE milestones SET status='dropped', done_ts=? WHERE status='active' AND criterion NOT LIKE '%\"alphabet\"%'"
                " AND criterion NOT LIKE '%\"level\"%'"
                f" AND id NOT IN ({','.join('?' * len(keep)) or 'NULL'})",
                (now, *keep),
            )
            for m in ms.get("new") or []:
                if (
                    m["criterion"]["unit"] in ("alphabet", "level")
                    or (alpha["gate"] and needs_alphabet(m["criterion"]))
                    or not levels.milestone_allowed(m["criterion"], op)
                ):
                    continue
                c.execute(
                    "INSERT INTO milestones(ts, plan_id, title, why, criterion) VALUES (?,?,?,?,?)",
                    (now, pid, m["title"], m["why"], json.dumps(m["criterion"], ensure_ascii=False)),
                )
        # While the alphabet is learned, milestones that test the symbols wait: the alphabet milestone tracks them.
        if alpha["gate"]:
            for mid, crit in c.execute("SELECT id, criterion FROM milestones WHERE status='active'").fetchall():
                if needs_alphabet(json.loads(crit)):
                    c.execute("UPDATE milestones SET status='dropped', done_ts=? WHERE id=?", (now, mid))
        # Milestones of locked exercises wait for their level.
        for mid, crit in c.execute("SELECT id, criterion FROM milestones WHERE status='active'").fetchall():
            if not levels.milestone_allowed(json.loads(crit), op):
                c.execute("UPDATE milestones SET status='dropped', done_ts=? WHERE id=?", (now, mid))
        # The next level is a milestone of the app from level 2 on (at level 1 the alphabet milestone is the same goal).
        nxt = lv["next"]
        if (
            nxt
            and lv["level"] >= 2
            and not c.execute(
                "SELECT 1 FROM milestones WHERE status='active' AND criterion LIKE ?",
                (f'%"unit": "level", "expected": ["{nxt["n"]}"]%',),
            ).fetchone()
        ):
            goals = lv["levels"][lv["level"] - 1]["goals"]
            crit = {
                "area": "reading",
                "unit": "level",
                "expected": [str(nxt["n"])],
                "min_acc": 100,
                "window": sum(g["need"] for g in goals),
            }
            c.execute(
                "INSERT INTO milestones(ts, plan_id, title, why, criterion) VALUES (?,?,?,?,?)",
                (
                    now,
                    pid,
                    f"Reach level {nxt['n']}: {nxt['title']}",
                    "Unlocks "
                    + ", ".join(o["label"] for o in nxt["opens"])
                    + ". Every item must be known: right on the first try, fast, on more than one day.",
                    json.dumps(crit, ensure_ascii=False),
                ),
            )
        # The alphabet milestone is a rule of the app: it stays until the 37 symbols are known.
        if (
            alpha["known_count"] < 37
            and not c.execute(
                "SELECT 1 FROM milestones WHERE status='active' AND criterion LIKE '%\"alphabet\"%'"
            ).fetchone()
        ):
            m = clean_milestone(
                {
                    "title": "Know the alphabet",
                    "area": "reading",
                    "unit": "alphabet",
                    "min_acc": 100,
                    "why": "Every Bopomofo drill needs the 37 symbols. A symbol counts as known when you say, type, or write it right, without help, several times in a row.",
                }
            )
            c.execute(
                "INSERT INTO milestones(ts, plan_id, title, why, criterion) VALUES (?,?,?,?,?)",
                (now, pid, m["title"], m["why"], json.dumps(m["criterion"], ensure_ascii=False)),
            )
    # The headline and the "How do we know?" story. A failure here never loses the plan: the story can be written again later.
    jobs.set_stage("Writing your story")
    try:
        from .. import story

        story.write(pid, run, live=settings.LIVE and run_pipeline is None)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
    return pid


def story_stats_now() -> dict:
    """The story numbers for a plan saved before the story existed: read from today's stats."""
    return digest()["story"]


def state_milestones() -> list[dict]:
    """The active milestones, each with its progress."""
    out = []
    for m in store.query("SELECT * FROM milestones WHERE status='active' ORDER BY id"):
        c = json.loads(m["criterion"])
        out.append({k: m[k] for k in ("id", "title", "why")} | {"criterion": c, **milestone_progress(c)})
    return out


def start_story(pid: int) -> bool:
    """Write the headline and story of a saved plan again, in the background. False when the coach is busy."""
    if not settings.LIVE or not store.plan(pid):
        return False
    if limits.ai_quota()["blocked"]:
        return False
    if not jobs.claim("Writing your story", story=pid):
        return False

    def run():
        from .. import story

        story.write(pid)

    jobs.run(run)
    return True


def start(reason: str, as_next: bool = False) -> bool:
    """Build a plan in the background. Returns False when one is already being built."""
    if not settings.LIVE:
        return False
    if limits.ai_quota()["blocked"]:
        return False
    if not jobs.claim("Starting", as_next=as_next):
        return False
    jobs.run(lambda: build(reason, as_next=as_next))
    return True
