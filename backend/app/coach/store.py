"""Reads of the coach tables: plans, steps, and any query on the stats tables."""

from __future__ import annotations

import json

from .. import stats


def query(sql: str, args=()) -> list[dict]:
    """Run a query on the stats tables and return the rows as dicts."""
    return stats._rows(sql, args)


def plan(pid: int | None = None) -> dict | None:
    """One plan by id, or the active plan when pid is None."""
    rows = (
        query("SELECT * FROM plans WHERE id=?", (pid,))
        if pid
        else query("SELECT * FROM plans WHERE status='active' ORDER BY id DESC LIMIT 1")
    )
    return rows[0] if rows else None


def steps(pid: int) -> list[dict]:
    """The steps of a plan in order, with their params as a dict."""
    return [
        {**s, "params": json.loads(s["params"])}
        for s in query("SELECT * FROM steps WHERE plan_id=? ORDER BY pos", (pid,))
    ]


def step(sid: int) -> dict | None:
    """One step by id, with its params as a dict."""
    rows = query("SELECT * FROM steps WHERE id=?", (sid,))
    return {**rows[0], "params": json.loads(rows[0]["params"])} if rows else None
