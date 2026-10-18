"""During practice: checkpoints, debriefs, and the refresh that ends steps and plans."""

from __future__ import annotations

import asyncio
import json
import threading
import time
import traceback
import uuid

from .. import db, levels, limits
from . import planner, settings, store, validate
from .cleaning import focus_of
from .decks import syllables
from .model import call
from .progress import baseline, milestone_progress, step_progress
from .prompts import CHECKPOINT, DEBRIEF
from .settings import CHECK_EVERY
from .views import state

_refresh_lock = threading.RLock()  # one refresh at a time in this process
_checking: set[int] = set()  # steps with a checkpoint or a debrief running in the background


def _brief(s: dict) -> dict:
    """The short view of a step that the checkpoint and debrief calls get."""
    return {"type": s["type"], "title": s["title"], "why": s["why"], "focus": focus_of(s), "target": s["target"]}


def _ask_sync(stage: str, task: str, payload: dict, step: dict) -> dict:
    """One model call for a step, from a worker thread."""
    return asyncio.run(call(stage, task, payload, uuid.uuid4().hex[:12], step["id"], step["plan_id"]))


def _linked_findings(s: dict) -> list[dict]:
    """The analysts' findings that the step was planned from."""
    plan = store.plan(s["plan_id"])
    ids = set((s["params"].get("meta") or {}).get("finding_ids") or [])
    raw = json.loads(plan["raw"] or "{}") if plan else {}
    return [f for f in raw.get("findings") or [] if isinstance(f, dict) and f.get("id") in ids]


def apply_checkpoint(s: dict, prog: dict, r: dict) -> dict:
    """Apply a checkpoint decision. The model can only shrink the focus to a subset, and the targets stay in bounds."""
    act = r.get("action") if r.get("action") in ("continue", "finish", "extend", "narrow", "easier") else "continue"
    p = dict(s["params"])
    target, status = s["target"], "open"
    sentences = s["type"] == "speak_sentences"
    if act == "finish":
        if prog["tried"] >= 10:
            status = "done"
        else:
            act = "continue"
    elif act == "extend":
        if sentences:
            p["reps"] = validate.integer(r.get("reps"), p["reps"], 10, min(10, p["reps"] + 1))
        else:
            target = validate.integer(r.get("target"), prog["progress"] + 3, 150, s["target"] + 10)
    if act in ("narrow", "easier"):
        tones = [t for t in validate.tones(r.get("tones")) if t in (p.get("tones") or [])]
        if tones:
            p["tones"] = tones
        syms = [x for x in validate.syms(r.get("syms")) if x in (p.get("syms") or [])]
        if syms:
            p["syms"] = syms
        rules = [x for x in dict.fromkeys(str(v) for v in (r.get("rules") or [])) if x in (p.get("rules") or [])]
        if rules:
            p["rules"] = rules
        bands = [x for x in dict.fromkeys(str(v) for v in (r.get("bands") or [])) if x in (p.get("bands") or [])]
        if bands:
            p["bands"] = bands
        nums = [
            x
            for x in dict.fromkeys(validate.integer(v, -1, 10**9, -1) for v in (r.get("nums") or []))
            if x in (p.get("nums") or [])
        ]
        if nums:
            p["nums"] = nums
        deck = [z for z in dict.fromkeys(str(x).strip() for x in r.get("deck") or []) if z in (p.get("deck") or [])]
        if len(deck) >= 4:
            p["deck"] = deck
        if sentences:
            keep = {validate.integer(x, 0, 10**9, 0) for x in r.get("sentence_ids") or []} & set(p["ids"])
            if keep:
                p["texts"] = [t for i, t in zip(p["ids"], p["texts"], strict=False) if i in keep]
                p["ids"] = [i for i in p["ids"] if i in keep]
        if s["type"] in ("listen_tones", "listen_sounds"):
            # A quiz with one answer is guessable: keep at least two tones or sounds, and a deck with at least two tones.
            if len(p.get("tones") or []) < 2 and s["type"] == "listen_tones":
                p["tones"] = s["params"].get("tones")
            if len(p.get("syms") or []) < 2 and s["type"] == "listen_sounds":
                p["syms"] = s["params"].get("syms")
            by_z = {x["z"]: x["tone"] for x in syllables()}
            if s["type"] == "listen_tones" and p.get("deck") and len({by_z.get(z) for z in p["deck"]}) < 2:
                p["deck"] = s["params"].get("deck")
    if act == "easier":
        if sentences:
            p["min_score"] = validate.integer(r.get("min_score"), 60, p["min_score"], max(60, p["min_score"] - 10))
        else:
            target = validate.integer(
                r.get("target"), max(5, prog["progress"] + 1), s["target"], max(5, s["target"] - 5)
            )
    if sentences:
        target = p["reps"] * len(p["ids"])
    note = validate.text(r.get("note"), 400)
    now = time.time()
    with db.conn() as c:
        cur = c.execute(
            "UPDATE steps SET params=?, target=?, status=?, done_ts=? WHERE id=? AND status='open'",
            (json.dumps(p, ensure_ascii=False), target, status, now if status == "done" else None, s["id"]),
        )
        if cur.rowcount == 0:  # the step ended while the model was thinking: its decision is too late
            return {"action": "late", "target": s["target"], "params": s["params"], "status": "late", "note": ""}
        if note:
            c.execute(
                "INSERT INTO coach_notes(ts, plan_id, step_id, kind, text) VALUES (?,?,?,?,?)",
                (now, s["plan_id"], s["id"], "checkpoint:" + act, note),
            )
    return {"action": act, "target": target, "params": p, "status": status, "note": note}


def checkpoint(step_id: int, ask=None) -> dict | None:
    """Mid-step decision from the answers so far. ask(stage, task, payload) -> reply can replace the model in tests."""
    s = store.step(step_id)
    if not s or s["status"] != "open":
        return None
    prog = step_progress(s, detail=True)
    payload = {
        "step": _brief(s),
        "progress": {k: prog[k] for k in ("progress", "tried", "right")},
        "last_answers": prog.get("last"),
        "accuracy_by_10": prog.get("blocks"),
        "by_item": prog.get("by_item") or prog.get("items"),
        "findings": _linked_findings(s),
    }
    r = (ask or (lambda st, task, pl: _ask_sync(st, task, pl, s)))("checkpoint", CHECKPOINT, payload)
    out = apply_checkpoint(s, prog, r)
    if out["status"] == "done":
        refresh(check=False)
        if settings.LIVE:
            debrief(step_id)
    return out


def debrief(step_id: int, ask=None) -> str | None:
    """Ask for a debrief of an ended step: the answers inside the step against the 30 days before the plan. Saves the note for the next plan and the line for the learner, and returns the note."""
    s = store.step(step_id)
    plan = store.plan(s["plan_id"]) if s else None
    if not plan:
        return None
    prog = step_progress(s, detail=True)
    payload = {
        "step": _brief(s),
        "inside_step": {k: prog.get(k) for k in ("progress", "tried", "right", "blocks", "by_item", "items")},
        "before_plan_30_days": baseline(s, plan["ts"]),
        "findings": _linked_findings(s),
    }
    r = (ask or (lambda st, task, pl: _ask_sync(st, task, pl, s)))("debrief", DEBRIEF, payload)
    note = validate.text(r.get("note"), 500)
    learner = validate.text(r.get("learner"), 300)
    if note:
        with db.conn() as c:
            c.execute(
                "INSERT INTO coach_notes(ts, plan_id, step_id, kind, text) VALUES (?,?,?,?,?)",
                (time.time(), s["plan_id"], s["id"], "debrief", note),
            )
    if learner:  # the line the learner sees; the note above stays for the next plan
        with db.conn() as c:
            c.execute(
                "INSERT INTO coach_notes(ts, plan_id, step_id, kind, text) VALUES (?,?,?,?,?)",
                (time.time(), s["plan_id"], s["id"], "debrief:learner", learner),
            )
    return note


def _bg(fn, sid: int):
    """Run a checkpoint or a debrief of a step in the background. The step leaves _checking when it ends."""

    def run():
        try:
            fn(sid)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        finally:
            _checking.discard(sid)

    db.spawn(run)


def _promote() -> int | None:
    """Make the plan built in advance the active one. Its steps count answers from now."""
    with db.conn() as c:
        r = c.execute("SELECT id FROM plans WHERE status='next' ORDER BY id DESC LIMIT 1").fetchone()
        if not r:
            return None
        c.execute("UPDATE plans SET status='active', ts=? WHERE id=?", (time.time(), r["id"]))
    return r["id"]


def refresh(check: bool = True) -> dict:
    """Update steps and milestones from the answers. Starts checkpoints, debriefs, and the next plan when needed."""
    done_now, to_check = [], []
    finished = want_next = False
    # Checkpoints and debriefs are AI calls. While AI energy is empty, a due checkpoint stays due until the refill.
    ai_ready = settings.LIVE and check and not limits.ai_quota()["blocked"]
    with _refresh_lock:
        # Levels first: new unlocks, drops, and notices. A failure here never blocks the plan.
        lv = None
        try:
            lv = levels.check()
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        op = {"exercises": lv["exercises"], "symbols": lv["symbols"]} if lv else None
        plan = store.plan()
        if plan:
            now = time.time()
            with db.conn() as c:
                for s in store.steps(plan["id"]):
                    if s["status"] != "open":
                        continue
                    # A step of an exercise the level has not unlocked (a plan from before the levels) is closed.
                    if op and not levels.step_allowed(s["type"], s["params"], op):
                        c.execute(
                            "UPDATE steps SET status='skipped', skip_reason='locked', done_ts=? WHERE id=?",
                            (now, s["id"]),
                        )
                        continue
                    pr = step_progress(s)
                    if pr["progress"] >= s["target"]:
                        c.execute("UPDATE steps SET status='done', done_ts=? WHERE id=?", (now, s["id"]))
                        done_now.append(s["id"])
                    elif ai_ready and pr["tried"] - (s["checked_n"] or 0) >= CHECK_EVERY and s["id"] not in _checking:
                        c.execute("UPDATE steps SET checked_n=? WHERE id=?", (pr["tried"], s["id"]))
                        to_check.append(s["id"])
                left, total = c.execute(
                    "SELECT COUNT(*) FILTER (WHERE status='open'), COUNT(*) FROM steps WHERE plan_id=?", (plan["id"],)
                ).fetchone()
                if total and not left:
                    c.execute("UPDATE plans SET status='done', done_ts=? WHERE id=?", (now, plan["id"]))
                    finished = True
                elif total > 1 and left == 1:
                    want_next = True
        with db.conn() as c:
            for m in c.execute("SELECT id, criterion FROM milestones WHERE status='active'").fetchall():
                if milestone_progress(json.loads(m["criterion"]), lv)["reached"]:
                    c.execute("UPDATE milestones SET status='achieved', done_ts=? WHERE id=?", (time.time(), m["id"]))
        if finished and not _promote():
            planner.start("The previous plan is finished. Build the next one from the new stats.")
    if ai_ready:
        for sid in done_now:
            _bg(debrief, sid)
        for sid in to_check:
            _checking.add(sid)
            _bg(checkpoint, sid)
    if want_next and not store.query("SELECT id FROM plans WHERE status='next'"):
        planner.start(
            "One step is left in the current plan. Build the next plan now, so it is ready when this one ends.",
            as_next=True,
        )
    return {"done_now": done_now, "checking": to_check, "finished": finished, "levels": lv}


def skip(step_id: int, reason: str) -> dict:
    """Skip an open step with a reason (too_hard, too_easy, or not_now), then refresh. Returns the coach state."""
    reason = reason if reason in ("too_hard", "too_easy", "not_now") else "not_now"
    s = store.step(step_id)
    with db.conn() as c:
        c.execute(
            "UPDATE steps SET status='skipped', skip_reason=?, done_ts=? WHERE id=? AND status='open'",
            (reason, time.time(), step_id),
        )
        if s:
            c.execute(
                "INSERT INTO coach_notes(ts, plan_id, step_id, kind, text) VALUES (?,?,?,?,?)",
                (time.time(), s["plan_id"], step_id, "skip", f'Skipped "{s["title"]}": {reason.replace("_", " ")}.'),
            )
    refresh()
    return state()
