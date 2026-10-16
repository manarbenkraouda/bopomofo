"""Typed Pinyin checks: the speech model can mix up close sounds (b and p, z and s), more so with a blocked nose.

After repeated misses on one card, the learner types the sound they said in Pinyin. When it is the expected sound,
the misses of that card count as right: the unit keeps what the model heard in extra.heard, and its source becomes
"typed". When the same pair (expected ㄆ, heard ㄅ) is confirmed this way PAIR_CONFIRMATIONS times, the older misses of
that pair are counted as right too (source "pair_fix"). Grading itself does not change.
"""

from __future__ import annotations

import json
import re
import time
import unicodedata
from collections import defaultdict

from pypinyin.style.bopomofo import BopomofoConverter

from . import db, levels
from .zhuyin import INITIALS

PAIR_CONFIRMATIONS = 5
# Every Bopomofo final, with its medial.
FINALS = set("ㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ") | {
    "ㄧㄚ",
    "ㄧㄛ",
    "ㄧㄝ",
    "ㄧㄞ",
    "ㄧㄠ",
    "ㄧㄡ",
    "ㄧㄢ",
    "ㄧㄣ",
    "ㄧㄤ",
    "ㄧㄥ",
    "ㄨㄚ",
    "ㄨㄛ",
    "ㄨㄞ",
    "ㄨㄟ",
    "ㄨㄢ",
    "ㄨㄣ",
    "ㄨㄤ",
    "ㄨㄥ",
    "ㄩㄝ",
    "ㄩㄢ",
    "ㄩㄣ",
    "ㄩㄥ",
}
_PINYIN = re.compile(r"[a-zāáǎàēéěèīíǐìōóǒòūúǔùüǖǘǚǜ]+[1-5]?")
_BOPO = re.compile(r"[\u3105-\u3129]+")
_conv = BopomofoConverter()


def parse_syllable(text: str) -> tuple[str, str] | None:
    """The initial and final of one typed Pinyin syllable ("po", "po1", "pō", "lv3"), "∅" when empty. None if it is not one syllable."""
    t = unicodedata.normalize("NFC", text or "").strip().lower().replace("u:", "ü").replace("v", "ü")
    t = re.sub(r"\s+", "", t)
    if not _PINYIN.fullmatch(t):
        return None
    z = "".join(ch for ch in _conv.to_bopomofo(t) if ch not in "ˊˇˋ˙")
    if not _BOPO.fullmatch(z):
        return None
    initial = z[0] if z[0] in INITIALS else ""
    final = z[len(initial) :]
    if (not initial and not final) or (final and final not in FINALS):
        return None
    return initial or "∅", final or "∅"


def _extra(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw) if raw else {}
    except ValueError:
        return {}


def _in(ids) -> str:
    return "(" + ",".join("?" * len(ids)) + ")"


def _fix_unit(c, u: dict, source: str, extra: dict) -> None:
    c.execute(
        "UPDATE units SET ok=1, actual=expected, source=?, extra=? WHERE id=?",
        (source, json.dumps({**_extra(u["extra"]), **extra}, ensure_ascii=False), u["id"]),
    )


def recount(c, event_ids) -> int:
    """Mark answers right after their units were fixed. Only from wrong to right. Returns how many changed."""
    changed = 0
    for eid in sorted(set(event_ids)):
        e = c.execute("SELECT id, area, ok, help, tries, details FROM events WHERE id=?", (eid,)).fetchone()
        if not e or e["ok"]:
            continue
        us = [
            dict(r)
            for r in c.execute(
                "SELECT id, kind, pos, ok, try_n, help FROM units WHERE event_id=? ORDER BY try_n, pos, id", (eid,)
            )
        ]
        if e["area"] == "speaking":
            by_pos: dict[int, list[dict]] = defaultdict(list)
            for u in us:
                if u["try_n"] == min(x["try_n"] for x in us):  # the recording itself, not a typed check added later
                    by_pos[u["pos"]].append(u)
            whole = bool(by_pos)
            for parts in by_pos.values():
                graded = [u for u in parts if u["kind"] in ("tone", "initial", "final")]
                good = bool(graded) and all(u["ok"] for u in graded)
                for u in parts:
                    if u["kind"] == "syllable" and good and not u["ok"]:
                        c.execute("UPDATE units SET ok=1, actual=expected WHERE id=?", (u["id"],))
                whole = whole and good
            first = whole and not e["help"] and (e["tries"] or 1) == 1
        else:
            sym = [u for u in us if u["kind"] == "symbol"]
            if not sym:
                continue
            whole = bool(sym[0]["ok"]) and not sym[0]["help"] and not e["help"]
            first = whole
        if not whole:
            continue
        d = _extra(e["details"])
        d["typed_fix"] = True
        c.execute(
            "UPDATE events SET ok=1, first_try=?, details=? WHERE id=?",
            (int(first), json.dumps(d, ensure_ascii=False), eid),
        )
        changed += 1
    return changed


def _rebuild_levels(c) -> None:
    if c.execute("SELECT 1 FROM level_built").fetchone():
        levels.rebuild(c)


def confirm_speaking(event_ids: list[int], typed: str) -> dict:
    """The learner typed what they said after missed recordings of one single-syllable card."""
    said = parse_syllable(typed)
    if not said:
        raise ValueError("That is not a Pinyin syllable.")
    ids = sorted(set(event_ids))
    with db.conn() as c:
        evs = c.execute("SELECT id, area, item FROM events WHERE id IN " + _in(ids), tuple(ids)).fetchall()
        if len(evs) != len(ids) or any(e["area"] != "speaking" for e in evs) or len({e["item"] for e in evs}) != 1:
            raise ValueError("These recordings are not from one speaking card.")
        units = [
            dict(r)
            for r in c.execute(
                "SELECT id, event_id, kind, expected, actual, ok, pos, try_n, extra FROM units"
                " WHERE event_id IN " + _in(ids) + " AND kind IN ('initial','final') ORDER BY id",
                tuple(ids),
            )
        ]
        exp = {u["kind"]: u["expected"] for u in units if u["pos"] == 0}
        if "initial" not in exp or "final" not in exp:
            raise ValueError("This card has no sounds to check.")
        match = (exp["initial"], exp["final"]) == said
        cid = f"s{time.time_ns()}"
        fixed = 0
        if match:
            for u in units:
                if u["pos"] == 0 and u["ok"] == 0:
                    _fix_unit(c, u, "typed", {"heard": u["actual"], "typed": typed, "confirm": cid})
                    fixed += 1
            recount(c, ids)
        else:
            last = max(ids)
            n = c.execute("SELECT MAX(try_n) FROM units WHERE event_id=?", (last,)).fetchone()[0] or 0
            db.add_units(
                c,
                last,
                [
                    {
                        "kind": k,
                        "expected": exp[k],
                        "actual": v,
                        "ok": v == exp[k],
                        "try_n": n + 1,
                        "source": "typed",
                        "extra": {"typed": typed, "confirm": cid},
                    }
                    for k, v in (("initial", said[0]), ("final", said[1]))
                ],
            )
        _rebuild_levels(c)
        pairs = _apply_pairs(c) if match else []
    return {"match": match, "fixed": fixed, "pairs_confirmed": pairs}


def _pair_counts(c) -> dict[tuple, set]:
    out: dict[tuple, set] = defaultdict(set)
    for r in c.execute(
        "SELECT area, kind, expected, extra FROM units WHERE source='typed' AND ok=1 AND extra IS NOT NULL"
    ):
        x = _extra(r["extra"])
        heard = x.get("heard")
        if heard in (None, "", "?", r["expected"]) or not x.get("confirm"):
            continue
        out[(r["area"], r["kind"], r["expected"], str(heard))].add(str(x["confirm"]))
    return out


def _apply_pairs(c) -> list[dict]:
    """Count the older misses of every pair confirmed often enough as right. Safe to run again: fixed units are skipped."""
    done = []
    fixed_events: set[int] = set()
    for (area, kind, exp, heard), confirms in _pair_counts(c).items():
        if len(confirms) < PAIR_CONFIRMATIONS:
            continue
        rows = [
            dict(r)
            for r in c.execute(
                "SELECT id, event_id, actual, extra FROM units WHERE area=? AND kind=? AND expected=? AND actual=?"
                " AND ok=0 AND COALESCE(source, '') NOT IN ('typed', 'pair_fix')",
                (area, kind, exp, heard),
            )
        ]
        for u in rows:
            _fix_unit(c, u, "pair_fix", {"heard": u["actual"]})
            fixed_events.add(u["event_id"])
        if rows:
            done.append({"area": area, "kind": kind, "expected": exp, "heard": heard, "fixed": len(rows)})
    if fixed_events:
        recount(c, fixed_events)
        _rebuild_levels(c)
    return done


def apply_pairs() -> list[dict]:
    with db.conn() as c:
        return _apply_pairs(c)


def mic_pairs() -> list[dict]:
    """The sounds the speech model mixes up for this learner, as the learner confirmed by typing them."""
    with db.conn() as c:
        counts = _pair_counts(c)
    out = [
        {"area": a, "kind": k, "expected": e, "heard": h, "n": len(v), "confirmed": len(v) >= PAIR_CONFIRMATIONS}
        for (a, k, e, h), v in counts.items()
    ]
    return sorted(out, key=lambda p: -p["n"])
