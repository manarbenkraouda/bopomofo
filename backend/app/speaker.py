"""The learner's pitch reference (median F0), learned from recordings of 2+ syllables."""
from __future__ import annotations

import json
import math

from .config import DATA_DIR

PATH = DATA_DIR / "speaker.json"


def get() -> float | None:
    try:
        d = json.loads(PATH.read_text())
        return float(d["median_hz"]) if d.get("n", 0) >= 1 else None
    except (OSError, ValueError, KeyError):
        return None


def update(median_hz: float) -> float:
    try:
        d = json.loads(PATH.read_text())
    except (OSError, ValueError):
        d = {"median_hz": median_hz, "n": 0}
    n = d.get("n", 0)
    w = 1 / (n + 1) if n < 10 else 0.1  # running mean in log-frequency, then slow adaptation
    new = math.exp((1 - w) * math.log(d["median_hz"]) + w * math.log(median_hz)) if n else median_hz
    PATH.write_text(json.dumps({"median_hz": round(new, 1), "n": n + 1}))
    return new


def reset():
    PATH.unlink(missing_ok=True)
