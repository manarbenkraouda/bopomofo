"""The learner's pitch reference (median F0), learned from recordings of 2+ syllables. One per user, in the database."""
from __future__ import annotations

import json
import math

from . import db

KEY = "speaker"


def _load() -> dict | None:
    try:
        v = db.get_meta(KEY)
        return json.loads(v) if v else None
    except ValueError:
        return None


def get() -> float | None:
    d = _load()
    try:
        return float(d["median_hz"]) if d and d.get("n", 0) >= 1 else None
    except (KeyError, TypeError, ValueError):
        return None


def update(median_hz: float) -> float:
    d = _load() or {"median_hz": median_hz, "n": 0}
    n = d.get("n", 0)
    w = 1 / (n + 1) if n < 10 else 0.1  # running mean in log-frequency, then slow adaptation
    new = math.exp((1 - w) * math.log(d["median_hz"]) + w * math.log(median_hz)) if n else median_hz
    db.set_meta(KEY, json.dumps({"median_hz": round(new, 1), "n": n + 1}))
    return new


def reset():
    db.set_meta(KEY, None)
