"""Checks on the model's steps and milestones. Unknown symbols are dropped and numbers are clamped."""

from __future__ import annotations

import re

from .. import db, levels
from ..zhuyin import RULES
from . import validate
from .settings import DEFAULT_TARGET, MAX_SENTENCES, SYMBOL_TYPES, TYPES


def clean_step(s: dict, known_texts: set[str], scale: float = 1.0, op: dict | None = None) -> dict | None:
    """One step from the model, checked. Returns None when it cannot be measured or when the level has not unlocked its exercise.
    op: what the level opens (levels.opened()); read here when not given."""
    t = s.get("type")
    if t not in TYPES:
        return None
    op = op or levels.opened()
    if not levels.step_allowed(
        t, {"source": s.get("source"), "mode": s.get("mode")} if t in ("speak_sounds", "tone_rules") else None, op
    ):
        return None
    meta = {"finding_ids": [validate.text(x, 60) for x in (s.get("finding_ids") or []) if x][:6], "review": ""}
    if t == "speak_sentences":
        ids: list[tuple[int, str]] = []
        for i in s.get("sentence_ids") or []:
            row = db.get_sentence(validate.integer(i, 0, 10**9, 0))
            if row and row["hanzi"] not in [x[1] for x in ids]:
                ids.append((row["id"], row["hanzi"]))
        for txt in s.get("texts") or []:
            txt = str(txt).strip()
            if txt in known_texts and txt not in [x[1] for x in ids]:
                row = next((r for r in db.list_sentences(500) if r["hanzi"] == txt), None) or db.add_sentence(
                    {"hanzi": txt}, "coach", "coach"
                )
                ids.append((row["id"], row["hanzi"]))
        ids = ids[:MAX_SENTENCES]
        new = s.get("new") if isinstance(s.get("new"), dict) else {}
        f = new.get("focus") if isinstance(new.get("focus"), dict) else {}
        count = min(validate.integer(new.get("count"), 0, 4, 0), MAX_SENTENCES - len(ids))
        if not ids and not count:
            return None
        p = {
            "ids": [i for i, _ in ids],
            "texts": [h for _, h in ids],
            "reps": validate.integer(s.get("reps"), 1, 10, 2),
            "min_score": validate.integer(s.get("min_score"), 60, 100, 85),
        }
        if count:
            p["new"] = {
                "count": count,
                "focus": {
                    "tones": validate.tones(f.get("tones")),
                    "pairs": validate.pairs(f.get("pairs")),
                    "syms": validate.syms(f.get("syms")),
                },
            }
        target = p["reps"] * len(ids)
    else:
        if t == "speak_sounds":
            unit = s.get("unit") if s.get("unit") in ("tone", "initial", "final") else "tone"
            p = {
                "unit": unit,
                "tones": validate.tones(s.get("tones")),
                "syms": validate.syms(s.get("syms")),
                "source": "sentence" if s.get("source") == "sentence" else "syllable",
            }
            if (unit == "tone" and not p["tones"]) or (unit != "tone" and not p["syms"]):
                return None
            if unit == "tone" and 5 in p["tones"]:
                p["source"] = "sentence"  # the neutral tone only exists after another syllable
            if not levels.step_allowed(t, p, op):
                return None
        elif t == "listen_tones":
            p = {"tones": validate.tones(s.get("tones"), allow5=False)}
            if not p["tones"]:
                return None
        elif t == "listen_sounds":
            p = {"syms": validate.syms(s.get("syms"))}
        elif t == "tone_rules":
            src = s.get("params") if isinstance(s.get("params"), dict) else s
            rules = [r for r in dict.fromkeys(str(x) for x in (src.get("rules") or [])) if r in RULES] or list(RULES)
            p = {"rules": rules, "mode": "speak" if src.get("mode") == "speak" else "quiz"}
            if src.get("learn"):
                p["learn"] = True
            if not levels.step_allowed(t, p, op):
                return None
        elif t in SYMBOL_TYPES:
            p = {"syms": [x for x in validate.syms(s.get("syms"), single=True) if x in op["symbols"]]}
        else:
            p = {"tones": validate.tones(s.get("tones")), "syms": validate.syms(s.get("syms"))}
            if not p["tones"] and not p["syms"]:
                return None
        if (t == "listen_sounds" or t in SYMBOL_TYPES) and not p["syms"]:
            return None
        target = max(5, min(120, round(validate.integer(s.get("target"), 5, 60, DEFAULT_TARGET[t]) * scale)))
    return {
        "type": t,
        "title": validate.text(s.get("title"), 80) or t.replace("_", " "),
        "why": validate.text(s.get("why"), 500),
        "params": p,
        "target": target,
        "minutes": validate.integer(s.get("minutes"), 1, 60, 5),
        "meta": meta,
    }


def clean_milestone(m: dict) -> dict | None:
    """Check one milestone from the model. Returns None when its area, unit, or items are not known."""
    if m.get("area") not in TYPES.values() or m.get("unit") not in (
        "tone",
        "initial",
        "final",
        "symbol",
        "score",
        "alphabet",
        "sandhi",
    ):
        return None
    unit = m["unit"]
    if unit == "sandhi":
        exp = [r for r in dict.fromkeys(str(x) for x in (m.get("expected") or [])) if r in RULES]
        if m["area"] not in ("listening", "speaking"):
            return None
    else:
        exp = (
            [str(t) for t in validate.tones(m.get("expected"))]
            if unit == "tone"
            else validate.syms(m.get("expected"))
            if unit not in ("score", "alphabet")
            else []
        )
    if unit not in ("score", "alphabet") and not exp:
        return None
    if unit == "score" and m["area"] != "speaking":
        return None
    c = {
        "area": m["area"],
        "unit": unit,
        "expected": exp,
        "min_acc": validate.integer(m.get("min_acc"), 50, 100, 90),
        "window": validate.integer(m.get("window"), 20, 200, 50),
    }
    if unit == "alphabet":
        c["window"] = 37
    # The numbers in the title always come from the criterion.
    # The model often writes the goal into the title too ("Speaking score: 95 average…"): cut from the first number.
    name = re.sub(r"\s*[:,(-]?\s*(at\s+)?\d+\s*%.*$", "", validate.text(m.get("title"), 80))
    name = re.sub(r"\s*[:,(—-]\s*(?:an?\s+)?(?:average\s+|avg\.?\s+)?\d.*$", "", name).strip(" :-,") or "Milestone"
    goal = (
        f"average {c['min_acc']} over the last {c['window']}"
        if unit == "score"
        else f"{round(37 * c['min_acc'] / 100)} of 37 symbols known"
        if unit == "alphabet"
        else f"{c['min_acc']}% of the last {c['window']}"
    )
    return {"title": f"{name}: {goal}", "why": validate.text(m.get("why"), 400), "criterion": c}


def focus_of(s: dict) -> dict:
    """The params of a step that set its focus (the items and the mode), for the model payloads."""
    p = s["params"]
    return {
        k: p[k]
        for k in (
            "unit",
            "tones",
            "syms",
            "source",
            "deck",
            "texts",
            "ids",
            "reps",
            "min_score",
            "focus",
            "rules",
            "mode",
            "learn",
        )
        if p.get(k) not in (None, [], "")
    }
