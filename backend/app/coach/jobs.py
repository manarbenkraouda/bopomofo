"""The background job of each user: one plan build at a time, shared by every API process.

What the coach builds in the background is in the coach_jobs table. During a deploy, the old process finishes the job
while the new process answers the app. A running job writes a beat every JOB_BEAT seconds. A job without a beat for
JOB_STALE seconds stopped with its process, and a new job may start."""

from __future__ import annotations

import contextvars
import threading
import time
import traceback

from .. import db

# What the coach builds in the background, per user, is in the coach_jobs table, so every API process sees it: during a
# deploy the old process finishes the job while the new one answers the app. A running job writes a beat every
# JOB_BEAT seconds; without a beat for JOB_STALE seconds it died with its process, and a new job may start.
JOB_BEAT = 20
JOB_STALE = 90
JOB_LOST = "Bobo stopped before finishing the plan. Ask again for a new plan."
_IDLE = {"running": False, "stage": "", "error": None, "started": 0.0, "next": False, "story": None}


def current() -> dict:
    """The background job of the current user, as any API process sees it."""
    if not db.current_user():
        return dict(_IDLE)
    with db.conn() as c:
        r = c.execute("SELECT running, stage, error, started, next, story, beat FROM coach_jobs").fetchone()
    if not r:
        return dict(_IDLE)
    j = {k: r[k] for k in _IDLE}
    if j["running"] and r["beat"] < time.time() - JOB_STALE:
        j.update(running=False, stage="", story=None, error=JOB_LOST)
    return j


def claim(stage: str, as_next: bool = False, story: int | None = None) -> bool:
    """Mark a job as running for the current user. False when one already runs, in this process or another."""
    now = time.time()
    with db.conn() as c:
        r = c.execute(
            "INSERT INTO coach_jobs(running, stage, error, started, next, story, beat) VALUES (true, ?, NULL, ?, ? = 1, ?, ?) "
            "ON CONFLICT (user_id) DO UPDATE SET running=true, stage=excluded.stage, error=NULL, started=excluded.started, "
            "next=excluded.next, story=excluded.story, beat=excluded.beat "
            "WHERE NOT coach_jobs.running OR coach_jobs.beat < ? RETURNING user_id",
            (stage, now, int(as_next), story, now, now - JOB_STALE),
        ).fetchone()
    return r is not None


def run(fn) -> None:
    """Run a claimed job in the background with a beat, then mark it finished, with its error if it failed."""

    def run():
        stop = threading.Event()

        def beat():
            while not stop.wait(JOB_BEAT):
                try:
                    with db.conn() as c:
                        c.execute("UPDATE coach_jobs SET beat=? WHERE running", (time.time(),))
                except Exception:  # noqa: BLE001
                    traceback.print_exc()

        threading.Thread(target=contextvars.copy_context().run, args=(beat,), daemon=True).start()
        error = None
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            error = f"{type(e).__name__}: {e}"
        finally:
            stop.set()
            with db.conn() as c:
                c.execute(
                    "UPDATE coach_jobs SET running=false, stage='', story=NULL, error=?, beat=?", (error, time.time())
                )

    db.spawn(run)


def set_stage(text: str):
    """Show the current stage of the running job, and write a beat."""
    with db.conn() as c:
        c.execute("UPDATE coach_jobs SET stage=?, beat=? WHERE running", (text, time.time()))
