"""The deep check queue: a second look at missed speaking answers, away from the live requests.

/api/speech/analyze gives a job to submit() when an answer is not fully right. One dispatcher thread sends the jobs one at
a time to one worker process with a low priority (deep_check_core.init_worker), so the speech checks of the learner stay
fast. The worker only does CTC alignments and pitch on the model output the live check already made: no second model.
The model output stays in memory and is discarded after the check; jobs are lost on a restart.

The mode is config.DEEP_CHECK. shadow: store the verdict in deep_checks only. apply: also correct the units, the score, and
the levels of a false miss, and tell the learner with a notice. Typed Pinyin checks always win over the deep check.
"""

from __future__ import annotations

import json
import multiprocessing
import queue
import threading
import time
import traceback
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from concurrent.futures.process import BrokenProcessPool
from contextlib import suppress

from . import config, db, deep_check_core, typed_fix

QUEUE_SIZE = 20
JOB_SECONDS = 30
DRAIN_SECONDS = 15
RIGHT = 80
NOTICE_TITLE = "Answer corrected"
NOTICE_ONE = "A previous answer was corrected after further analysis, good job!"
NOTICE_MANY = "{n} previous answers were corrected after further analysis, good job!"
# The coach stops planning drills for a pair the deep check corrected this often.
COACH_FIXES = 3

_q: queue.Queue = queue.Queue(maxsize=QUEUE_SIZE)
_stop = threading.Event()
_drain_until = 0.0
_thread: threading.Thread | None = None
_pool: ProcessPoolExecutor | None = None
_pool_lock = threading.Lock()
_vocab_fn = None
# Tests: run the check with this function instead of the worker process.
runner = None
counts = {"done": 0, "error": 0, "skipped": 0}


def mode() -> str:
    return config.DEEP_CHECK


# ---------- starting and stopping ----------


def start(vocab_fn) -> None:
    """Start the dispatcher. vocab_fn gives the model vocabulary {id: token} when the first job comes (the model loads late)."""
    global _thread, _vocab_fn
    _vocab_fn = vocab_fn
    if mode() == "off" or (_thread and _thread.is_alive()):
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="deep-check", daemon=True)
    _thread.start()


def stop(drain: float = DRAIN_SECONDS) -> int:
    """Finish the queued jobs for at most drain seconds, then stop the worker. Returns how many jobs were dropped."""
    global _drain_until, _thread
    _drain_until = time.monotonic() + drain
    _stop.set()
    if _thread:
        _thread.join(drain + 1)
        _thread = None
    dropped = 0
    while True:
        try:
            _q.get_nowait()
            dropped += 1
        except queue.Empty:
            break
    _reset_pool(kill=True)
    return dropped


def _new_pool() -> ProcessPoolExecutor:
    vocab = dict(_vocab_fn() or {}) if _vocab_fn else {}
    return ProcessPoolExecutor(
        max_workers=1,
        mp_context=multiprocessing.get_context("spawn"),
        initializer=deep_check_core.init_worker,
        initargs=(vocab,),
    )


def _get_pool() -> ProcessPoolExecutor:
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = _new_pool()
        return _pool


def _reset_pool(kill: bool = False) -> None:
    """Drop the worker process. kill: also end a process that is still busy (a job past its time, or a stop)."""
    global _pool
    with _pool_lock:
        p, _pool = _pool, None
    if p is None:
        return
    procs = list((getattr(p, "_processes", None) or {}).values())
    with suppress(Exception):
        p.shutdown(wait=False, cancel_futures=True)
    if kill:
        for pr in procs:
            try:
                if pr.is_alive():
                    pr.kill()
            except Exception:  # noqa: BLE001
                pass


# ---------- the queue ----------


def wanted(res: dict) -> bool:
    """A deep check is useful when the answer is not fully right and an initial, final, or tone was marked wrong."""
    if mode() == "off" or res.get("score") is None or res["score"] >= 100 or res.get("_lp") is None:
        return False
    return any(
        s.get("initial_ok") is False or s.get("final_ok") is False or not s.get("tone_ok")
        for s in res.get("syllables") or []
    )


def _syllable(s: dict) -> dict:
    e = s["expected"]
    return {
        "expected": {k: e.get(k) for k in ("char", "initial", "final", "tone", "surface_tone", "alt_tones")},
        "heard": s.get("heard"),
        "initial_ok": s.get("initial_ok"),
        "final_ok": s.get("final_ok"),
        "tone_ok": s.get("tone_ok"),
    }


def make_job(user_id: str | None, event_id: int, res: dict, lp, has_ref: bool, mic_pairs: list) -> dict:
    """The job for one answer: the frame log probabilities and pitch of the live check, the live results, and the
    learner's typed mic pairs ([kind, expected, heard]). The audio itself is not needed: the pitch is already measured."""
    return {
        "user_id": user_id,
        "event_id": event_id,
        "mode": mode(),
        "check": {
            "lp": lp,
            "audio_seconds": (res.get("timing") or {}).get("audio_seconds"),
            "syllables": [_syllable(s) for s in res.get("syllables") or []],
            "semitones": (res.get("pitch") or {}).get("semitones") or [],
            "has_ref": has_ref,
            "score": res.get("score"),
            "mic_pairs": mic_pairs,
        },
    }


def submit(job: dict) -> str:
    """Queue a job without waiting. Returns "queued", or "skipped" when the queue is full or stopped, or "off"."""
    if mode() == "off":
        return "off"
    if _stop.is_set() or not (_thread and _thread.is_alive()):
        counts["skipped"] += 1
        return "skipped"
    try:
        _q.put_nowait(job)
    except queue.Full:
        counts["skipped"] += 1
        return "skipped"
    return "queued"


def _loop() -> None:
    while True:
        try:
            job = _q.get(timeout=0.2)
        except queue.Empty:
            if _stop.is_set():
                return
            continue
        if _stop.is_set() and time.monotonic() > _drain_until:
            return
        try:
            run(job)
        except Exception:  # noqa: BLE001
            traceback.print_exc()


def _check(core_job: dict) -> dict:
    if runner is not None:
        return runner(core_job)
    left = JOB_SECONDS
    if _stop.is_set():
        left = max(0.1, min(left, _drain_until - time.monotonic()))
    try:
        return _get_pool().submit(deep_check_core.check, core_job).result(timeout=left)
    except FutureTimeout:
        _reset_pool(kill=True)  # the worker is stuck on this job: a new one takes the next job
        return {"status": "error", "error": f"The check took more than {left:.0f} s."}
    except BrokenProcessPool:
        _reset_pool()
        return {"status": "error", "error": "The worker process stopped."}


def run(job: dict) -> dict:
    """Check one job and save the result as the job's user. Runs in the dispatcher thread (or a test)."""
    t0 = time.monotonic()
    try:
        res = _check(job["check"])
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        res = {"status": "error", "error": str(e)[:200]}
    res["seconds"] = round(time.monotonic() - t0, 2)
    counts["done" if res.get("status") == "done" else "error"] += 1
    with db.as_user(job["user_id"]):
        try:
            save(job["event_id"], job["mode"], res)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
    return res


# ---------- saving and applying ----------


def save(event_id: int, run_mode: str, res: dict) -> bool:
    """Store the verdict. In apply mode, correct the answer when parts were fixed. Returns True when it was applied."""
    applied = False
    parts = res.get("parts") or ([{"error": res["error"]}] if res.get("error") else [])
    with db.conn() as c:
        row = c.execute(
            "INSERT INTO deep_checks(event_id, ts, status, verdict, score_before, score_after, parts, mode, version, seconds)"
            " VALUES (?,?,?,?,?,?,CAST(? AS jsonb),?,?,?) ON CONFLICT (event_id) DO NOTHING RETURNING id",
            (
                event_id,
                time.time(),
                res.get("status") or "error",
                res.get("verdict"),
                res.get("score_before"),
                res.get("score_after"),
                json.dumps(parts, ensure_ascii=False),
                run_mode,
                res.get("version") or deep_check_core.VERSION,
                res.get("seconds"),
            ),
        ).fetchone()
        if (
            row
            and run_mode == "apply"
            and res.get("status") == "done"
            and res.get("verdict") in ("false_miss", "partial")
        ):
            applied = _apply(c, event_id, res)
    if applied:
        from . import coach  # coach imports this module for its digest

        try:
            coach.refresh()
        except Exception:  # noqa: BLE001
            traceback.print_exc()
    return applied


def _apply(c, event_id: int, res: dict) -> bool:
    """Correct the units, score, and levels of one answer in the open transaction c. Typed checks win: an answer with typed
    or pair_fix units, or one already applied, is left as it is."""
    dc = c.execute("SELECT applied FROM deep_checks WHERE event_id=?", (event_id,)).fetchone()
    if not dc or dc["applied"]:
        return False
    if c.execute(
        "SELECT 1 FROM units WHERE event_id=? AND source IN ('typed','pair_fix') LIMIT 1", (event_id,)
    ).fetchone():
        return False
    ev = c.execute("SELECT id, ok, score, help, tries, details FROM events WHERE id=?", (event_id,)).fetchone()
    if not ev:
        return False
    us = [
        dict(r)
        for r in c.execute(
            "SELECT id, kind, pos, ok, actual, try_n, extra FROM units WHERE event_id=? ORDER BY id", (event_id,)
        )
    ]
    fixed = [p for p in res.get("parts") or [] if p.get("verdict") == "fixed"]
    if not us or not fixed:
        return False
    first_n = min(u["try_n"] or 0 for u in us)
    us = [u for u in us if (u["try_n"] or 0) == first_n]  # the recording itself, not a typed check added later
    for p in fixed:
        kinds = ("tone", "sandhi") if p["kind"] == "tone" else (p["kind"],)
        for u in us:
            if u["pos"] == p["pos"] and u["kind"] in kinds and not u["ok"]:
                info = {"heard": u["actual"], "deep_check": deep_check_core.VERSION}
                for k in ("delta", "p_tone"):
                    if p.get(k) is not None:
                        info[k] = p[k]
                typed_fix._fix_unit(c, u, "deep_check", info)
                u["ok"] = 1
    whole = True
    for pos in sorted({u["pos"] for u in us}):
        parts = [u for u in us if u["pos"] == pos]
        graded = [u for u in parts if u["kind"] in ("tone", "initial", "final")]
        good = bool(graded) and all(u["ok"] for u in graded)
        whole = whole and good
        for u in parts:
            if u["kind"] == "syllable" and good and not u["ok"]:
                typed_fix._fix_unit(c, u, "deep_check", {"heard": u["actual"], "deep_check": deep_check_core.VERSION})
    _rescore_event(c, dict(ev), res["score_before"], res["score_after"], whole)
    typed_fix._rebuild_levels(c)
    c.execute("UPDATE deep_checks SET applied=true WHERE event_id=?", (event_id,))
    if res.get("verdict") == "false_miss":
        _notify(c, event_id)
    return True


def _rescore_event(c, ev: dict, before, after, whole: bool) -> None:
    """The new score of the answer. Right (ok) from 80; first try with the same rule as typed_fix.recount."""
    d = typed_fix._extra(ev["details"])
    d["deep_fix"] = {"before": before, "after": after}
    js = json.dumps(d, ensure_ascii=False)
    if after is not None and after >= RIGHT and not ev["ok"]:
        first = whole and not ev["help"] and (ev["tries"] or 1) == 1
        c.execute(
            "UPDATE events SET score=?, ok=1, first_try=?, details=? WHERE id=?", (after, int(first), js, ev["id"])
        )
    else:
        c.execute("UPDATE events SET score=?, details=? WHERE id=?", (after, js, ev["id"]))


def _notify(c, event_id: int) -> None:
    """One notice for all the corrected answers the learner has not seen yet: the unseen ones are merged into one."""
    old = [
        dict(r) for r in c.execute("SELECT id, key FROM level_notices WHERE kind='deep_fix' AND NOT seen ORDER BY id")
    ]
    ids = [event_id]
    for o in old:
        ids += [int(x) for x in str(o["key"]).split(",") if x.isdigit()]
    ids = sorted(set(ids))
    if old:
        c.execute(
            "DELETE FROM level_notices WHERE id IN (" + ",".join("?" * len(old)) + ")", tuple(o["id"] for o in old)
        )
    text = NOTICE_ONE if len(ids) == 1 else NOTICE_MANY.format(n=len(ids))
    nid = c.execute(
        "INSERT INTO level_notices(ts, kind, key, title, text) VALUES (?,?,?,?,?) RETURNING id",
        (time.time(), "deep_fix", ",".join(map(str, ids)), NOTICE_TITLE, text),
    ).fetchone()["id"]
    c.execute("UPDATE deep_checks SET notice_id=? WHERE event_id IN (" + ",".join("?" * len(ids)) + ")", (nid, *ids))


# ---------- reading ----------


def result(event_id: int) -> dict | None:
    with db.conn() as c:
        r = c.execute(
            "SELECT status, verdict, applied, score_after, notice_id FROM deep_checks WHERE event_id=?", (event_id,)
        ).fetchone()
    return dict(r) if r else None


def _fixed_pairs(rows) -> Counter:
    n: Counter = Counter()
    for r in rows:
        parts = r["parts"]
        if isinstance(parts, str):
            parts = json.loads(parts)
        for p in parts or []:
            if p.get("verdict") == "fixed" and p.get("kind") in ("initial", "final", "tone"):
                n[(p["kind"], str(p.get("expected")), str(p.get("heard")))] += 1
    return n


def summary() -> dict:
    """For the stats page: how many answers were checked and corrected, and the pairs corrected most."""
    with db.conn() as c:
        rows = [dict(r) for r in c.execute("SELECT verdict, applied, parts FROM deep_checks WHERE status='done'")]
    applied = [r for r in rows if r["applied"]]
    top = _fixed_pairs(applied).most_common(3)
    return {
        "mode": mode(),
        "checked": len(rows),
        "false_miss": sum(r["verdict"] == "false_miss" for r in rows),
        "corrected": sum(r["verdict"] == "false_miss" for r in applied),
        "applied": len(applied),
        "top_pairs": [{"kind": k, "expected": e, "heard": h, "n": n} for (k, e, h), n in top],
    }


def coach_pairs() -> list[dict]:
    """Pairs the deep check corrected COACH_FIXES times or more: misses of these are the microphone, not the learner."""
    with db.conn() as c:
        rows = [dict(r) for r in c.execute("SELECT parts FROM deep_checks WHERE applied")]
    return [
        {"kind": k, "expected": e, "heard": h, "fixes": n}
        for (k, e, h), n in _fixed_pairs(rows).most_common()
        if n >= COACH_FIXES
    ]
