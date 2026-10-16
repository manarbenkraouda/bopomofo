"""Progress, measured from the answers given inside a step, and the progress of the milestones."""

from __future__ import annotations

from collections import defaultdict
from urllib.parse import quote

from .. import levels, stats
from . import store
from .gates import alphabet_status
from .settings import DECK_TYPES, TYPES


def _match(expected: str, syms: list[str], exact: bool) -> bool:
    """True when expected is one of syms (exact), or contains one of them."""
    return expected in syms if exact else any(s in expected for s in syms)


def hit(step: dict, r: dict) -> bool:
    """True when an answer (one unit row) counts for the step: the right kind, inside the step focus."""
    t, p = step["type"], step["params"]
    tones = [str(x) for x in p.get("tones") or []]
    syms = p.get("syms") or []
    if t == "speak_sounds":
        if r["kind"] != p["unit"]:
            return False
        if p["unit"] == "tone":
            return not tones or r["expected"] in tones
        return not syms or _match(r["expected"], syms, False)
    if t == "listen_tones":
        return r["kind"] == "tone" and (not tones or r["expected"] in tones)
    if t == "listen_sounds":
        return r["kind"] in ("initial", "final") and (not syms or _match(r["expected"], syms, False))
    if t == "tone_rules":
        rules = p.get("rules") or []
        return r["kind"] == "sandhi" and (p.get("learn") or r["try_n"] == 0) and (not rules or r["expected"] in rules)
    if t in ("read_symbols", "recognize_symbols", "write_symbols"):
        # Learn mode counts every right repetition; a recall step counts first tries only.
        return r["kind"] == "symbol" and (p.get("learn") or r["try_n"] == 0) and (not syms or r["expected"] in syms)
    # write_syllables: every written part of a deck syllable. Variety cards from outside the deck do not count.
    deck = p.get("deck")
    if deck and r.get("item") is not None and r["item"] not in deck:
        return False
    return r["kind"] in ("symbol", "tone") and r["expected"] != "∅"


STEP_SQL = "(e.details::jsonb ->> 'step') = CAST(? AS TEXT)"


def step_progress(step: dict, detail: bool = False) -> dict:
    """The progress of a step, from the answers given inside it. detail adds the counts per item."""
    t, p, sid = step["type"], step["params"], step["id"]
    if t == "speak_sentences":
        texts = p.get("texts") or []
        rows = [
            r
            for r in store.query(
                f"SELECT e.item, e.score FROM events e WHERE e.area='speaking' AND e.score IS NOT NULL AND {STEP_SQL} ORDER BY e.ts",
                (sid,),
            )
            if r["item"] in texts
        ]
        per = []
        for txt in texts:
            sc = [round(r["score"]) for r in rows if r["item"] == txt]
            per.append(
                {
                    "text": txt,
                    "passes": min(sum(1 for x in sc if x >= p["min_score"]), p["reps"]),
                    "tries": len(sc),
                    "best": max(sc) if sc else None,
                    "last": sc[-1] if sc else None,
                }
            )
        out = {
            "progress": sum(x["passes"] for x in per),
            "tried": len(rows),
            "right": sum(1 for r in rows if r["score"] >= p["min_score"]),
            "items": per,
        }
        if detail:
            out["last"] = [{"text": r["item"], "score": round(r["score"])} for r in rows[-20:]]
            out["blocks"] = [
                round(sum(r["score"] for r in rows[i : i + 10]) / len(rows[i : i + 10]))
                for i in range(0, len(rows), 10)
            ]
        return out
    rows = store.query(
        "SELECT u.kind, u.expected, u.actual, u.ok, u.help, u.try_n, e.item FROM units u JOIN events e ON e.id = u.event_id"
        f" WHERE {STEP_SQL} AND u.ok IS NOT NULL AND u.kind IN ('tone','initial','final','symbol','sandhi') ORDER BY u.id",
        (sid,),
    )
    mine = [r for r in rows if hit(step, r)]
    good = [bool(r["ok"]) and (p.get("learn") or not r["help"]) for r in mine]
    out = {"progress": sum(good), "tried": len(mine), "right": sum(good)}
    if detail:
        out["last"] = [
            {"item": r["item"], "unit": r["kind"], "expected": r["expected"], "produced": r["actual"], "right": g}
            for r, g in zip(mine[-30:], good[-30:], strict=True)
        ]
        out["blocks"] = [round(100 * sum(good[i : i + 10]) / len(good[i : i + 10])) for i in range(0, len(good), 10)]
        per: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        for r, g in zip(mine, good, strict=True):
            per[r["expected"]][0] += 1
            per[r["expected"]][1] += g
        out["by_item"] = {k: {"answers": n, "right": ok} for k, (n, ok) in per.items()}
    return out


def baseline(step: dict, ts: float) -> dict:
    """The same focus in the 30 days before the plan."""
    since = ts - 30 * 86400
    if step["type"] == "speak_sentences":
        texts = step["params"]["texts"] or [""]
        rows = store.query(
            f"SELECT item, score FROM events WHERE area='speaking' AND score IS NOT NULL AND ts>=? AND ts<? AND item IN ({','.join('?' * len(texts))})",
            (since, ts, *texts),
        )
        return {
            "recordings": len(rows),
            "average_score": round(sum(r["score"] for r in rows) / len(rows)) if rows else None,
        }
    rows = store.query(
        "SELECT kind, expected, actual, ok, help, try_n FROM units WHERE area=? AND ts>=? AND ts<? AND ok IS NOT NULL AND try_n=0"
        " AND kind IN ('tone','initial','final','symbol','sandhi')",
        (
            "speaking"
            if step["type"] == "tone_rules" and step["params"].get("mode") == "speak"
            else TYPES[step["type"]],
            since,
            ts,
        ),
    )
    mine = [r for r in rows if hit(step, r)]
    ok = sum(1 for r in mine if r["ok"] and not r["help"])
    return {"answers": len(mine), "right_pct": stats._pct(ok, len(mine))}


def href(step: dict) -> str:
    """The URL of the practice mode of a step, with its focus params and &step=."""
    t, p, sid = step["type"], step["params"], step["id"]
    tones = ",".join(str(x) for x in p.get("tones") or [])
    syms = quote(",".join(p.get("syms") or []))
    q = {
        "speak_sentences": f"/speaking?source=sentence&ids={','.join(str(i) for i in p.get('ids') or [])}",
        "speak_sounds": f"/speaking?source={p.get('source', 'syllable')}"
        + (f"&tones={tones}" if tones else "")
        + (f"&syms={syms}" if syms else ""),
        "listen_tones": f"/listening?quiz=tone&tones={tones}",
        "listen_sounds": f"/listening?quiz=zhuyin&syms={syms}",
        "read_symbols": f"/reading?syms={syms}",
        "write_symbols": f"/dictation?syms={syms}",
        "recognize_symbols": f"/recognize?syms={syms}",
        "tone_rules": ("/speaking?source=rule" if p.get("mode") == "speak" else "/listening?quiz=rule")
        + "&rules="
        + quote(",".join(p.get("rules") or [])),
        "write_syllables": "/writing?mode=syllable"
        + (f"&tones={tones}" if tones else "")
        + (f"&syms={syms}" if syms else ""),
    }[t]
    if p.get("deck") and t in DECK_TYPES:
        q += "&items=" + quote(",".join(p["deck"]))
    if p.get("learn"):
        q += "&learn=1"
    return q + f"&step={sid}"


def milestone_progress(c: dict, lv: dict | None = None) -> dict:
    """lv: the level status, for the level milestone (read here when not given)."""
    if c["unit"] == "alphabet":
        n = alphabet_status()["known_count"]
        return {"n": n, "value": round(100 * n / 37, 1), "reached": n >= round(37 * c["min_acc"] / 100)}
    if c["unit"] == "level":
        target = int(c["expected"][0]) if c.get("expected") else 0
        if lv is None and levels.opened()["level"] >= target:
            return {"n": c["window"], "value": 100.0, "reached": True}
        lv = lv or levels.status()
        if lv["level"] >= target:
            return {"n": c["window"], "value": 100.0, "reached": True}
        goals = lv["levels"][target - 2]["goals"] if 2 <= target <= levels.MAX_LEVEL else []
        n = sum(min(g["done"], g["need"]) for g in goals)
        return {"n": n, "value": round(100 * n / max(1, c["window"]), 1), "reached": False}
    if c["unit"] == "score":
        rows = store.query(
            "SELECT score FROM events WHERE area='speaking' AND score IS NOT NULL ORDER BY ts DESC LIMIT ?",
            (c["window"],),
        )
        n = len(rows)
        value = round(sum(r["score"] for r in rows) / n, 1) if n else None
    else:
        rows = store.query(
            "SELECT expected, ok, help FROM units WHERE area=? AND kind=? AND try_n=0 AND ok IS NOT NULL ORDER BY id DESC LIMIT 2000",
            (c["area"], c["unit"]),
        )
        exact = c["unit"] in ("tone", "symbol", "initial", "sandhi")
        rows = [r for r in rows if _match(r["expected"], c["expected"], exact)][: c["window"]]
        n = len(rows)
        value = round(100 * sum(1 for r in rows if r["ok"] and not r["help"]) / n, 1) if n else None
    return {"n": n, "value": value, "reached": n >= c["window"] and value is not None and value >= c["min_acc"]}
