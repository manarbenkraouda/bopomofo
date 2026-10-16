"""The syllables of the practice modes, the learner's history on each one, and the checks on a drill deck."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import timedelta
from functools import lru_cache

from .. import db, stats
from ..zhuyin import analyze_text
from . import store, validate
from .settings import BOPOMOFO, MARKS, SYLLABLES_FILE


@lru_cache(maxsize=2)
def syllables(neutral: bool = False) -> list[dict]:
    """The syllables of the practice modes (frontend/public/data/syllables.json). The listening quiz has no neutral tone."""
    try:
        rows = json.loads(SYLLABLES_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    out = []
    for r in rows:
        z = r["zhuyin"]
        if "˙" in z and not neutral:
            continue
        tone = next((t for t, m in MARKS.items() if m and m in z), 1)
        out.append({"z": z, "char": r["char"], "tone": tone, "base": "".join(c for c in z if c in BOPOMOFO)})
    return out


def syllable_history(days: int = 60) -> dict[str, dict]:
    """Per syllable (Bopomofo with tone mark): first-try answers in listening, speaking, and writing, and the wrong answers."""
    since = (db.local_today() - timedelta(days=days)).isoformat()
    sy = syllables(neutral=True)
    by_base = {(s["base"], s["tone"]): s["z"] for s in sy}
    known = {s["z"] for s in sy}
    char_z = {s["char"]: s["z"] for s in sy}
    h: dict[str, dict] = defaultdict(lambda: {"n": 0, "ok": 0, "wrong": Counter(), "areas": Counter()})
    rows = store.query(
        "SELECT event_id, area, kind, expected, actual, ok, ctx FROM units WHERE area IN ('listening','speaking')"
        " AND kind IN ('tone','syllable') AND try_n=0 AND ok IS NOT NULL AND day>=?",
        (since,),
    )
    has_syl = {r["event_id"] for r in rows if r["kind"] == "syllable" and r["area"] == "listening"}
    for r in rows:
        if r["kind"] == "syllable":
            z, got = r["expected"], r["actual"]
        elif r["area"] == "listening" and r["event_id"] not in has_syl and r["ctx"]:
            z = by_base.get((r["ctx"], validate.integer(r["expected"], 0, 9, 0)))
            got = f"tone {r['actual']}"
        else:
            continue
        if z not in known:
            continue
        x = h[z]
        x["n"] += 1
        x["ok"] += bool(r["ok"])
        x["areas"][r["area"]] += 1
        if not r["ok"] and got:
            x["wrong"][got] += 1
    for e in store.query("SELECT item, ok FROM events WHERE area='writing' AND day>=?", (since,)):
        z = e["item"] if e["item"] in known else char_z.get(e["item"])
        if z:
            h[z]["n"] += 1
            h[z]["ok"] += bool(e["ok"])
            h[z]["areas"]["writing"] += 1
    return {
        z: {
            "answers": x["n"],
            "right_pct": stats._pct(x["ok"], x["n"]),
            "areas": dict(x["areas"]),
            "given_instead": [f"{w} x{n}" for w, n in x["wrong"].most_common(2)],
        }
        for z, x in h.items()
    }


def candidates(step: dict, hist: dict) -> list[dict]:
    """Syllables that fit the focus of a deck step, with the learner's history on each."""
    p = step["params"]
    tones = set(p.get("tones") or [])
    syms = p.get("syms") or []
    sy = syllables(neutral=step["type"] != "listen_tones" and step["type"] != "listen_sounds")

    def fits(s, use_tone=True):
        return (not tones or not use_tone or s["tone"] in tones) and (not syms or any(x in s["base"] for x in syms))

    pool = [s for s in sy if fits(s)]
    if len(pool) < 12:
        pool += [s for s in sy if s not in pool and fits(s, False)]
    return [
        {"z": s["z"], "char": s["char"], "tone": s["tone"], **({"history": hist[s["z"]]} if s["z"] in hist else {})}
        for s in pool[:90]
    ]


def deck_problems(step: dict, deck: list[str], cands: list[dict]) -> list[str]:
    """A deck must hold every focus tone and symbol that the candidates have, at least twice."""
    p = step["params"]
    by_z = {c["z"]: c for c in cands}
    problems = []
    for t in p.get("tones") or []:
        have = sum(1 for z in deck if by_z[z]["tone"] == t)
        can = sum(1 for c in cands if c["tone"] == t)
        if have < min(2, can):
            problems.append(
                f"tone {t} is in the focus but the deck has {have} syllables with it ({can} candidates have it)"
            )
    for s in p.get("syms") or []:
        have = sum(1 for z in deck if s in z)
        can = sum(1 for c in cands if s in c["z"])
        if have < min(2, can):
            problems.append(f"{s} is in the focus but the deck has {have} syllables with it ({can} candidates have it)")
    return problems


def focus_check(hanzi: str, focus: dict) -> list[str]:
    """Problems of a new sentence against its focus (surface tones, tone pairs, symbols). Empty list: the sentence is good."""
    items = analyze_text(hanzi)
    syl = [x for x in items if x["type"] == "syllable"]
    problems = []
    if not 3 <= len(syl) <= 16:
        problems.append(f"{len(syl)} syllables; write 3 to 16")
    tones = [x["surface_tone"] for x in syl]
    for t in focus.get("tones") or []:
        if t not in tones:
            problems.append(f"no syllable with surface tone {t}")
    # A pair matches on the surface tones (what is said) or on the dictionary tones: "3-3" asks for the tone change itself.
    pairs, last = set(), None
    for x in items:
        if x["type"] == "syllable":
            if last is not None:
                pairs.add(f"{last[0]}-{x['surface_tone']}")
                pairs.add(f"{last[1]}-{x['tone']}")
            last = (x["surface_tone"], x["tone"])
        else:
            last = None
    for p in focus.get("pairs") or []:
        if p not in pairs:
            problems.append(f"no tone pair {p}; the surface tones here are {' '.join(map(str, tones))}")
    allz = "".join(x["zhuyin"] for x in syl)
    for s in focus.get("syms") or []:
        if s not in allz:
            problems.append(f"no syllable with {s}")
    return problems
