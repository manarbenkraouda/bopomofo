"""Progress statistics built from the events and units tables.

Words used here:
- production: one unit, that is one thing the learner said, heard, or wrote, with what was expected.
- first try: a unit with try_n = 0. It counts as right only if it was right without help (answer shown).
- weak score: recency-weighted accuracy on first tries, pulled toward the average for that skill when
  there is little data (a Beta prior). Old answers count half after HALF_LIFE days.
"""

from __future__ import annotations

import csv
import io
import json
import random
from collections import Counter, defaultdict
from datetime import date, timedelta
from urllib.parse import quote

from . import db, deep_check, levels, typed_fix
from .zhuyin import RULES, tested_rule, zhuyin_of

HALF_LIFE = 14.0
PRIOR = 4.0  # weight of the skill average in the weak score, in answers
SESSION_GAP = 15 * 60  # a pause longer than this starts a new session
AREAS = ["reading", "recognize", "listening", "dictation", "writing", "speaking"]
VERB = {
    "reading": "said",
    "recognize": "typed",
    "listening": "picked",
    "speaking": "said",
    "dictation": "wrote",
    "writing": "wrote",
}


# ---------- speaking: one recording gives tone, initial, final, and syllable units ----------


def speaking_units(res: dict) -> list[dict]:
    """Convert one scored recording into tone, sound, syllable, and tone-rule evidence."""
    sy = res.get("syllables") or []
    tones = [s["expected"]["surface_tone"] for s in sy]
    out: list[dict] = []
    for i, s in enumerate(sy):
        e, h = s["expected"], s.get("heard")
        base = {"pos": i, "ctx": e.get("char")}
        # "?" = the syllable was not heard, or its tone was not clear. None (old rows) = not recorded.
        heard_tone = (h.get("tone") if h else None) or "?"
        out.append(
            {
                **base,
                "kind": "tone",
                "expected": e["surface_tone"],
                "actual": heard_tone,
                "ok": s.get("tone_ok"),
                "lex": e["tone"] if e["tone"] != e["surface_tone"] else None,
                "prev": tones[i - 1] if i > 0 else None,
                "next": tones[i + 1] if i + 1 < len(tones) else None,
                "source": s.get("tone_source"),
                "uncertain": s.get("uncertain"),
                "extra": {"model": s.get("model_tone"), "pitch": s.get("pitch_tone"), "zhuyin": e.get("zhuyin")},
            }
        )
        if s.get("initial_ok") is not None:
            out.append(
                {
                    **base,
                    "kind": "initial",
                    "expected": e.get("initial") or "∅",
                    "actual": (h.get("initial") or "∅") if h else "?",
                    "ok": s["initial_ok"],
                }
            )
        if s.get("final_ok") is not None:
            out.append(
                {
                    **base,
                    "kind": "final",
                    "expected": e.get("final") or "∅",
                    "actual": (h.get("final") or "∅") if h else "?",
                    "ok": s["final_ok"],
                }
            )
        whole = (
            bool(h) and bool(s.get("tone_ok")) and s.get("initial_ok") is not False and s.get("final_ok") is not False
        )
        said_as = (
            zhuyin_of(e.get("initial") or "", e.get("final") or "", e["surface_tone"])
            if e.get("final") is not None
            else e.get("zhuyin")
        )
        out.append(
            {**base, "kind": "syllable", "expected": said_as, "actual": h.get("zhuyin") if h else "?", "ok": whole}
        )
        # Tone rules: one "sandhi" unit per syllable that tests a rule. actual: the tone said. extra.error:
        # "literal" = read the written tone where the rule changes it, "over" = changed 不/一 where it keeps its tone.
        rule = tested_rule(e)
        if rule:
            err = None if s.get("tone_ok") else (s.get("rule_error") or "other")
            out.append(
                {
                    **base,
                    "kind": "sandhi",
                    "expected": rule,
                    "actual": heard_tone,
                    "ok": s.get("tone_ok"),
                    "lex": e["tone"],
                    "next": tones[i + 1] if i + 1 < len(tones) else None,
                    "extra": {"said": e["surface_tone"], "error": err, "zhuyin": e.get("zhuyin")},
                }
            )
    return out


def log_speaking(
    text: str, res: dict, mode: str | None, step: int | None = None, help: bool = False, try_n: int = 0
) -> int:
    """Save one recording and its evidence, including help, attempt, and coach step context."""
    mode = (
        mode
        if mode in ("sentence", "word", "syllable", "custom", "rule")
        else ("syllable" if len(text) == 1 else "sentence")
    )
    ok = res["score"] >= 80
    return db.add_event(
        {
            "area": "speaking",
            "mode": mode,
            "item": text,
            "ok": ok,
            "score": res["score"],
            "first_try": ok and not help and try_n == 0,
            "tries": try_n + 1,
            "help": help,
            "details": {
                "heard": res.get("heard_raw"),
                "extra": len(res.get("extra") or []),
                "audio_seconds": (res.get("timing") or {}).get("audio_seconds"),
                **({"step": step} if step else {}),
            },
            "units": [{**u, "help": help, "try_n": try_n} for u in speaking_units(res)],
        }
    )


# ---------- helpers ----------


def _rows(sql: str, args=()) -> list[dict]:
    with db.conn() as c:
        rows = [dict(r) for r in c.execute(sql, args)]
    for r in rows:
        r.pop("user_id", None)
    return rows


def _since(days: int | None) -> str:
    return "0000-00-00" if not days else (db.local_today() - timedelta(days=days - 1)).isoformat()


def _good(u: dict) -> bool:
    return bool(u["ok"]) and not u["help"]


def _pct(ok: float, n: float) -> float | None:
    return round(100 * ok / n, 1) if n else None


def _median(v: list) -> float | None:
    """The upper middle of the values that are not 0 or None (the time charts use it; levels._median is a true median)."""
    v = sorted(x for x in v if x)
    return v[len(v) // 2] if v else None


def _seconds_by_day(events: list[dict], saved: dict[str, int]) -> dict[str, int]:
    """Active seconds per day: the browser clock or the estimate from answer times, whichever is larger
    (the clock can start syncing in the middle of a day)."""
    est: dict[str, float] = defaultdict(float)
    last = None
    for e in events:
        gap = e["ts"] - last["ts"] if last and last["day"] == e["day"] else None
        est[e["day"]] += min(gap, 90) if gap is not None and gap < 300 else 15
        last = e
    out = {d: int(s) for d, s in est.items()}
    for d, s in saved.items():
        if s:
            out[d] = max(int(s), out.get(d, 0))
    return out


def _href(area: str, kind: str, expected: str, also: list | None = None) -> str | None:
    vals = [expected] + [a for a in (also or []) if a and a not in ("∅", "?", expected)]
    if kind == "sandhi":
        if expected not in RULES:
            return None
        return ("/speaking?source=rule&rules=" if area == "speaking" else "/listening?quiz=rule&rules=") + quote(
            expected
        )
    if kind == "tone":
        t = ",".join(v for v in vals if v in ("1", "2", "3", "4", "5"))
        base = {
            "listening": "/listening?quiz=tone&tones=",
            "speaking": "/speaking?source=syllable&tones=",
            "writing": "/writing?mode=syllable&tones=",
        }
        return base[area] + t if area in base else None
    if expected in ("∅", "?"):
        return None
    syms = quote(",".join(v for v in vals if v not in ("∅", "?")))
    if kind == "symbol":
        return {
            "reading": "/reading?syms=",
            "recognize": "/recognize?syms=",
            "dictation": "/dictation?syms=",
            "writing": "/writing?mode=symbol&syms=",
        }.get(area, "/dictation?syms=") + syms
    if kind in ("initial", "final"):
        return ("/listening?quiz=zhuyin&syms=" if area == "listening" else "/speaking?source=syllable&syms=") + syms
    if kind in ("stroke", "order"):
        return "/dictation?syms=" + quote(expected)
    return None


def _label(kind: str, expected: str) -> str:
    if kind == "tone":
        return "Neutral tone" if expected == "5" else "Tone " + expected
    if kind == "sandhi":
        return RULES[expected]["name"] if expected in RULES else expected
    return expected


# ---------- tone rules (sandhi) ----------


def rule_stats(days: int | None = None) -> list[dict]:
    """Per tone rule: first tries in the rule quiz (listening/rule) and in every recording (speaking), the kind of error
    (literal: read the written tone; over: changed 不/一 where the tone stays; other), the last 7 days, and the hardest characters."""
    rows = _rows(
        "SELECT day, area, expected, actual, ok, help, ctx, extra FROM units WHERE kind='sandhi' AND try_n=0 AND ok IS NOT NULL"
        " AND day>=? ORDER BY ts",
        (_since(days),),
    )
    week_ago = (db.local_today() - timedelta(days=7)).isoformat()
    out = []
    for rid, r in RULES.items():
        rs = [x for x in rows if x["expected"] == rid]
        good = [x for x in rs if _good(x)]
        err: Counter = Counter()
        chars: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        areas: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        for x in rs:
            g = _good(x)
            areas[x["area"]][0] += 1
            areas[x["area"]][1] += g
            chars[x["ctx"] or "?"][0] += 1
            chars[x["ctx"] or "?"][1] += g
            if not g:
                ex = x["extra"]
                if isinstance(ex, str):
                    try:
                        ex = json.loads(ex)
                    except ValueError:
                        ex = {}
                err[(ex or {}).get("error") or ("help" if x["ok"] else "other")] += 1
        recent = [x for x in rs if x["day"] > week_ago]
        out.append(
            {
                "rule": rid,
                "name": r["name"],
                "short": r["short"],
                "n": len(rs),
                "ok": len(good),
                "acc": _pct(len(good), len(rs)),
                "recent": _pct(sum(_good(x) for x in recent), len(recent)),
                "recent_n": len(recent),
                "errors": dict(err),
                "literal": err.get("literal", 0),
                "areas": {a: {"n": v[0], "ok": v[1], "acc": _pct(v[1], v[0])} for a, v in areas.items()},
                "chars": sorted(
                    ({"char": c, "n": v[0], "ok": v[1]} for c, v in chars.items()),
                    key=lambda c: (c["ok"] / c["n"], -c["n"]),
                )[:5],
                "quiz_href": "/listening?quiz=rule&rules=" + quote(rid),
                "speak_href": "/speaking?source=rule&rules=" + quote(rid),
            }
        )
    return out


# ---------- per item ----------


def item_stats(units: list[dict], today: date) -> list[dict]:
    """Per (area, kind, expected): first-try accuracy, recency-weighted weak score, trend, and top confusions."""
    first = [u for u in units if u["try_n"] == 0 and u["ok"] is not None and u["kind"] != "stroke"]
    base: dict[tuple, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for u in first:
        b = base[(u["area"], u["kind"])]
        b[0] += 1
        b[1] += _good(u)
    g: dict[tuple, dict] = {}
    week_ago = (today - timedelta(days=7)).isoformat()
    for u in first:
        k = (u["area"], u["kind"], u["expected"])
        d = g.setdefault(k, {"n": 0, "ok": 0, "wn": 0.0, "wok": 0.0, "rn": 0, "rok": 0, "pn": 0, "pok": 0, "last": ""})
        w = 0.5 ** ((today - date.fromisoformat(u["day"])).days / HALF_LIFE)
        good = _good(u)
        d["n"] += 1
        d["ok"] += good
        d["wn"] += w
        d["wok"] += w * good
        if u["day"] > week_ago:
            d["rn"] += 1
            d["rok"] += good
        else:
            d["pn"] += 1
            d["pok"] += good
        d["last"] = max(d["last"], u["day"])
    conf: dict[tuple, Counter] = defaultdict(Counter)
    for u in units:
        if u["kind"] in ("stroke", "order") or u["ok"]:
            continue
        if u["actual"] is not None and u["actual"] != u["expected"]:
            conf[(u["area"], u["kind"], u["expected"])][u["actual"]] += 1
    out = []
    for (area, kind, exp), d in g.items():
        bn, bok = base[(area, kind)]
        p0 = (bok + 1) / (bn + 2)
        post = (d["wok"] + PRIOR * p0) / (d["wn"] + PRIOR)
        out.append(
            {
                "area": area,
                "kind": kind,
                "expected": exp,
                "n": d["n"],
                "ok": d["ok"],
                "acc": _pct(d["ok"], d["n"]),
                "post": round(100 * post, 1),
                "recent": _pct(d["rok"], d["rn"]),
                "before": _pct(d["pok"], d["pn"]),
                "recent_n": d["rn"],
                "last": d["last"],
                "top": [[a, n] for a, n in conf[(area, kind, exp)].most_common(3)],
            }
        )
    out.sort(key=lambda x: x["post"])
    return out


# ---------- main stats ----------


def compute(days: int | None = 30, area: str | None = None) -> dict:
    """Build the learner's stats response for the selected period and optional practice area."""
    today = db.local_today()
    since = _since(days)
    af = " AND area=?" if area else ""
    aa = (area,) if area else ()
    events = _rows(
        "SELECT id, ts, day, area, mode, item, ok, first_try, score, ms, tries, help, replays FROM events WHERE day>=?"
        + af
        + " ORDER BY ts",
        (since, *aa),
    )
    units = _rows(
        "SELECT u.event_id, u.day, u.area, u.mode, u.kind, u.expected, u.actual, u.ok, u.pos, u.try_n, u.help, u.ctx, u.lex, u.prev, u.next,"
        " u.source, u.uncertain, e.legacy FROM units u JOIN events e ON e.id = u.event_id WHERE u.day>=?"
        + af.replace("area", "u.area"),
        (since, *aa),
    )
    saved = {r["day"]: r["seconds"] for r in _rows("SELECT day, seconds FROM days")}
    all_events = _rows("SELECT ts, day, area, ok, ms FROM events ORDER BY ts")
    secs_all = _seconds_by_day(all_events, saved)

    def totals(evs: list[dict], d_from: str, d_to: str) -> dict:
        n = len(evs)
        ok = sum(e["ok"] for e in evs)
        secs = (
            sum(_seconds_by_day(evs, {}).values())
            if area
            else sum(s for d, s in secs_all.items() if d_from <= d <= d_to)
        )
        return {
            "cards": n,
            "ok": ok,
            "acc": _pct(ok, n),
            "minutes": round(secs / 60),
            "days": len({e["day"] for e in evs}),
            "ms": _median([e["ms"] for e in evs]),
        }

    overview = totals(events, since, today.isoformat())
    if days:
        p_from = (today - timedelta(days=2 * days - 1)).isoformat()
        prev = [e for e in all_events if p_from <= e["day"] < since and (not area or e["area"] == area)]
        overview["prev"] = totals(prev, p_from, (date.fromisoformat(since) - timedelta(days=1)).isoformat())

    # Day by day.
    first_day = events[0]["day"] if events else today.isoformat()
    secs_area = _seconds_by_day(events, {}) if area else secs_all
    by_day: dict[str, dict] = {}
    d = date.fromisoformat(since if days else first_day)
    while d <= today:
        k = d.isoformat()
        by_day[k] = {
            "day": k,
            "cards": 0,
            "ok": 0,
            "minutes": round(secs_area.get(k, 0) / 60, 1),
            "areas": {},
            "_ms": [],
        }
        d += timedelta(days=1)
    for e in events:
        b = by_day.get(e["day"])
        if not b:
            continue
        b["cards"] += 1
        b["ok"] += e["ok"]
        a = b["areas"].setdefault(e["area"], [0, 0])
        a[0] += 1
        a[1] += e["ok"]
        b["_ms"].append(e["ms"])
    daily = [
        {**{k: v for k, v in b.items() if k != "_ms"}, "acc": _pct(b["ok"], b["cards"]), "ms": _median(b["_ms"])}
        for b in by_day.values()
    ]

    # Per area.
    per_area = {}
    for a in AREAS:
        evs = [e for e in events if e["area"] == a]
        if not evs:
            continue
        ft = [e for e in evs if e["first_try"] is not None]
        sc = [e["score"] for e in evs if e["score"] is not None]
        ok = sum(e["ok"] for e in evs)
        per_area[a] = {
            "n": len(evs),
            "ok": ok,
            "acc": _pct(ok, len(evs)),
            "first_try": _pct(sum(e["first_try"] for e in ft), len(ft)),
            "help": _pct(sum(e["help"] for e in evs), len(evs)),
            "tries": round(sum(e["tries"] or 1 for e in evs) / len(evs), 2),
            "ms": _median([e["ms"] for e in evs]),
            "replays": round(sum(e["replays"] or 0 for e in evs) / len(evs), 2),
            "score": round(sum(sc) / len(sc), 1) if sc else None,
            "modes": dict(Counter(e["mode"] or "-" for e in evs)),
        }

    # Confusion: every production with a known answer, including right ones (the diagonal).
    conf: Counter = Counter()
    tot: dict[tuple, list[int]] = defaultdict(lambda: [0, 0])
    for u in units:
        if u["kind"] in ("stroke", "order") or u["ok"] is None:
            continue
        k = (u["area"], u["kind"], u["expected"])
        tot[k][0] += 1
        tot[k][1] += _good(u)
        if u["actual"] is not None:
            conf[(*k, u["actual"])] += 1
    confusion = [{"area": a, "kind": k, "expected": e, "actual": x, "n": n} for (a, k, e, x), n in conf.items()]
    expected = [{"area": a, "kind": k, "expected": e, "n": v[0], "ok": v[1]} for (a, k, e), v in tot.items()]

    # Tones in context (speaking): the tone before, the tone after, tone changes, position, and which signal judged it.
    # Old rows saved no context, so they are left out here.
    tone_units = [
        u for u in units if u["kind"] == "tone" and u["area"] == "speaking" and u["ok"] is not None and not u["legacy"]
    ]

    def grp(keyf) -> list[dict]:
        acc: dict[tuple, list[int]] = defaultdict(lambda: [0, 0])
        for u in tone_units:
            k = keyf(u)
            if None in k:
                continue
            acc[k][0] += 1
            acc[k][1] += bool(u["ok"])
        return [{"k": list(k), "n": v[0], "ok": v[1]} for k, v in acc.items()]

    multi = {u["event_id"] for u in tone_units if u["pos"] > 0}
    tone_ctx = {
        "prev": grp(lambda u: (u["prev"], u["expected"])),
        "next": grp(lambda u: (u["expected"], u["next"])),
        "sandhi": grp(lambda u: (u["lex"], u["expected"])),
        "source": grp(lambda u: (u["source"] or "-",)),
        "position": grp(
            lambda u: (
                "alone"
                if u["event_id"] not in multi
                else "first"
                if u["pos"] == 0
                else "last"
                if u["next"] is None
                else "middle",
                u["expected"],
            )
        ),
        "uncertain": sum(u["uncertain"] for u in tone_units),
        "n": len(tone_units),
    }

    # Strokes (dictation and writing): problems per symbol and per stroke.
    strokes: dict[str, dict] = {}
    for u in units:
        if u["kind"] not in ("stroke", "order"):
            continue
        s = strokes.setdefault(
            u["expected"],
            {
                "sym": u["expected"],
                "n": 0,
                "status": Counter(),
                "by_stroke": defaultdict(Counter),
                "order_n": 0,
                "order_err": 0,
            },
        )
        if u["kind"] == "stroke":
            s["n"] += 1
            s["status"][u["actual"] or "?"] += 1
            if u["actual"] != "ok":
                s["by_stroke"][str(u["pos"] + 1)][u["actual"] or "?"] += 1
        else:
            s["order_n"] += 1
            s["order_err"] += 0 if u["ok"] else 1
    stroke_list = sorted(
        (
            {
                **s,
                "status": dict(s["status"]),
                "by_stroke": {k: dict(v) for k, v in s["by_stroke"].items()},
                "clean": _pct(s["status"].get("ok", 0), s["n"]),
            }
            for s in strokes.values()
        ),
        key=lambda s: s["clean"] if s["clean"] is not None else 101,
    )

    # Time of day.
    hours: dict[int, list[int]] = defaultdict(lambda: [0, 0])
    for e in events:
        h = db.hour_of(e["ts"])
        hours[h][0] += 1
        hours[h][1] += e["ok"]
    by_hour = [{"hour": h, "n": v[0], "ok": v[1]} for h, v in sorted(hours.items())]

    # Sessions: answers with less than SESSION_GAP between them.
    sessions: list[dict] = []
    for e in events:
        if not sessions or e["ts"] - sessions[-1]["end"] > SESSION_GAP:
            sessions.append({"start": e["ts"], "end": e["ts"], "cards": 0, "ok": 0, "areas": Counter()})
        s = sessions[-1]
        s["end"] = e["ts"]
        s["cards"] += 1
        s["ok"] += e["ok"]
        s["areas"][e["area"]] += 1
    sessions = [{**s, "areas": dict(s["areas"])} for s in sessions[-40:]][::-1]

    items = item_stats(units, today)
    lv = levels.status()
    op = {"exercises": lv["exercises"], "symbols": lv["symbols"]}
    return {
        "range": {"days": days, "since": since if days else first_day, "area": area},
        "overview": overview,
        "daily": daily,
        "areas": per_area,
        "confusion": confusion,
        "expected": expected,
        "items": items,
        "tone_ctx": tone_ctx,
        "strokes": stroke_list,
        "hours": by_hour,
        "sessions": sessions,
        "rules": rule_stats(days),
        "mic_pairs": typed_fix.mic_pairs(),
        "deep_check": deep_check.summary(),
        "recent": recent(area=area),
        "records": records(),
        "challenges": challenges(op=op),
        "weak": weak(items, op=op),
        "levels": lv,
        "calendar": [
            {"day": dd, "minutes": round(s / 60, 1)}
            for dd, s in secs_all.items()
            if dd >= (today - timedelta(days=370)).isoformat()
        ],
    }


def recent(limit: int = 80, area: str | None = None) -> list[dict]:
    """Read recent answers with their non-stroke evidence, newest first."""
    evs = _rows(
        "SELECT id, ts, area, mode, item, ok, score, ms, tries, help, replays FROM events"
        + (" WHERE area=?" if area else "")
        + " ORDER BY ts DESC LIMIT ?",
        ((area, limit) if area else (limit,)),
    )
    if not evs:
        return []
    ids = [e["id"] for e in evs]
    us = _rows(
        f"SELECT event_id, kind, expected, actual, ok, pos, try_n, help, ctx FROM units WHERE kind != 'stroke' AND event_id IN ({','.join('?' * len(ids))}) ORDER BY id",
        ids,
    )
    by: dict[int, list] = defaultdict(list)
    for u in us:
        by[u.pop("event_id")].append(u)
    for e in evs:
        e["units"] = by.get(e["id"], [])
    return evs


def weak(items: list[dict], limit: int = 12, op: dict | None = None) -> list[dict]:
    """Training targets: the lowest weak scores with enough answers, in the exercises the level has unlocked."""
    op = op or levels.opened()
    out = []
    for it in items:
        if it["n"] < 3 or it["kind"] in ("syllable", "order") or it["expected"] in ("∅", "?") or it["post"] >= 92:
            continue
        href = _href(it["area"], it["kind"], it["expected"], [a for a, _ in it["top"][:2]])
        if not href or not levels.is_open(levels.exercise_of(href), op):
            continue
        out.append(
            {**it, "label": _label(it["kind"], it["expected"]), "verb": VERB.get(it["area"], "gave"), "href": href}
        )
        if len(out) >= limit:
            break
    return out


# ---------- records ----------


def records() -> dict:
    """Compute personal records from this learner's full answer and practice-time history."""
    evs = _rows("SELECT ts, day, area, ok, score, ms FROM events ORDER BY ts")
    saved = {r["day"]: r["seconds"] for r in _rows("SELECT day, seconds FROM days")}
    secs = _seconds_by_day(evs, saved)
    rec: dict[str, dict | None] = {}
    run = best = 0
    best_day = ""
    for e in evs:
        run = run + 1 if e["ok"] else 0
        if run > best:
            best, best_day = run, e["day"]
    rec["combo"] = {"value": best, "day": best_day} if best else None
    per_day: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for e in evs:
        per_day[e["day"]][0] += 1
        per_day[e["day"]][1] += e["ok"]
    if per_day:
        d, v = max(per_day.items(), key=lambda kv: kv[1][0])
        rec["cards_day"] = {"value": v[0], "day": d}
        good = [(d, 100 * v[1] / v[0]) for d, v in per_day.items() if v[0] >= 30]
        top = max(good, key=lambda x: x[1]) if good else None
        rec["acc_day"] = {"value": round(top[1], 1), "day": top[0]} if top else None
    if secs:
        d, s = max(secs.items(), key=lambda kv: kv[1])
        rec["minutes_day"] = {"value": round(s / 60), "day": d}
    days = set(per_day) | {d for d, s in saved.items() if s}
    longest = cur = 0
    prev = None
    for d in sorted(days):
        dd = date.fromisoformat(d)
        cur = cur + 1 if prev and (dd - prev).days == 1 else 1
        longest = max(longest, cur)
        prev = dd
    rec["streak"] = {"value": longest, "day": ""} if longest else None
    rec["streak_now"] = {"value": db.streak(days), "day": ""}
    sp = [e for e in evs if e["area"] == "speaking" and e["score"] is not None]
    if sp:
        top_sp = max(sp, key=lambda e: e["score"])
        rec["speaking"] = {"value": top_sp["score"], "day": top_sp["day"]}
    li: dict[str, list] = defaultdict(list)
    for e in evs:
        if e["area"] == "listening" and e["ms"] and e["ok"]:
            li[e["day"]].append(e["ms"])
    fast = [(d, _median(v)) for d, v in li.items() if len(v) >= 15]
    best_fast = min(fast, key=lambda x: x[1]) if fast else None
    rec["listen_ms"] = {"value": best_fast[1], "day": best_fast[0]} if best_fast else None
    rec["total"] = {"value": len(evs), "day": evs[0]["day"] if evs else ""}
    rec["total_minutes"] = {"value": round(sum(secs.values()) / 60), "day": ""}
    rec["days"] = {"value": len(days), "day": min(days) if days else ""}
    return rec


# ---------- daily challenges ----------


def challenges(today: date | None = None, op: dict | None = None) -> list[dict]:
    """Up to four goals for today, picked from the weakest skills before today, so they stay the same all day.
    Progress counts today's answers. Only exercises the level has unlocked."""
    today = today or db.local_today()
    op = op or levels.opened()
    t = today.isoformat()
    since = (today - timedelta(days=45)).isoformat()
    past = _rows(
        "SELECT day, area, kind, expected, actual, ok, try_n, help FROM units WHERE day>=? AND day<? AND kind!='stroke'",
        (since, t),
    )
    now = _rows("SELECT area, kind, expected, ok, try_n, help FROM units WHERE day=?", (t,))
    now_ev = _rows("SELECT area, mode FROM events WHERE day=?", (t,))
    items = item_stats(past, today)
    out: list[dict] = []

    def weakest(area: str, kind: str, k: int = 1, min_n: int = 4) -> list[dict]:
        return [
            i
            for i in items
            if i["area"] == area
            and i["kind"] == kind
            and i["n"] >= min_n
            and i["expected"] not in ("∅", "?")
            and i["post"] < 90
        ][:k]

    def count(area: str, kind: str, exp: set, first: bool = False) -> int:
        return sum(
            1
            for u in now
            if u["area"] == area
            and u["kind"] == kind
            and u["expected"] in exp
            and u["ok"]
            and not u["help"]
            and (not first or u["try_n"] == 0)
        )

    def tname(x: str) -> str:
        return "neutral tone" if x == "5" else "tone " + x

    w = weakest("speaking", "tone")
    if w:
        i = w[0]
        conf = (" Often heard as " + tname(i["top"][0][0]) + ".") if i["top"] and i["top"][0][0] != "?" else ""
        out.append(
            {
                "id": "speak-tone",
                "area": "speaking",
                "title": f"Say {tname(i['expected'])} right 8 times",
                "why": f"{i['acc']:.0f}% right on {i['n']} tries.{conf}",
                "target": 8,
                "progress": count("speaking", "tone", {i["expected"]}),
                "href": _href("speaking", "tone", i["expected"]),
            }
        )
    w = weakest("listening", "tone")
    if w:
        i = w[0]
        other = i["top"][0][0] if i["top"] else None
        pair = {i["expected"], other} if other else {i["expected"]}
        out.append(
            {
                "id": "hear-tone",
                "area": "listening",
                "title": f"Hear {tname(i['expected'])}" + (f" vs {tname(other)}" if other else "") + ": 12 right",
                "why": f"{i['acc']:.0f}% right on {i['n']} questions."
                + (f" You picked {tname(other)} {i['top'][0][1]} times." if other else ""),
                "target": 12,
                "progress": count("listening", "tone", pair),
                "href": _href("listening", "tone", i["expected"], [other] if other else []),
            }
        )
    for area, verb in (("reading", "Read"), ("recognize", "Recognize"), ("dictation", "Write")):
        w = weakest(area, "symbol", 3, 3)
        if w:
            syms = [i["expected"] for i in w]
            n = sum(i["n"] for i in w)
            ok = sum(i["ok"] for i in w)
            out.append(
                {
                    "id": area + "-syms",
                    "area": area,
                    "title": f"{verb} {' '.join(syms)} right on the first try 6 times",
                    "why": f"Your weakest {area} symbols: {round(100 * ok / n)}% first try on {n} cards.",
                    "target": 6,
                    "progress": count(area, "symbol", set(syms), first=True),
                    "href": _href(area, "symbol", syms[0], syms[1:]),
                }
            )
    for kind in ("initial", "final"):
        w = weakest("speaking", kind)
        if w:
            i = w[0]
            said = (" You often say " + i["top"][0][0] + ".") if i["top"] and i["top"][0][0] != "?" else ""
            out.append(
                {
                    "id": "speak-" + kind,
                    "area": "speaking",
                    "title": f"Say the {kind} {i['expected']} right 6 times",
                    "why": f"{i['acc']:.0f}% right on {i['n']} tries.{said}",
                    "target": 6,
                    "progress": count("speaking", kind, {i["expected"]}),
                    "href": _href("speaking", kind, i["expected"]),
                }
            )
    # Tone rules: the weakest rule, in the quiz or in recordings.
    rw = sorted(
        (i for i in items if i["kind"] == "sandhi" and i["n"] >= 4 and i["expected"] in RULES and i["post"] < 90),
        key=lambda i: i["post"],
    )
    if rw:
        i = rw[0]
        name = RULES[i["expected"]]["name"]
        out.append(
            {
                "id": "rule-" + i["expected"],
                "area": i["area"],
                "title": f"Use the {name} right 8 times",
                "why": f"{i['acc']:.0f}% right on {i['n']} tries. {RULES[i['expected']]['short']}",
                "target": 8,
                "progress": sum(
                    1
                    for u in now
                    if u["kind"] == "sandhi" and u["expected"] == i["expected"] and u["ok"] and not u["help"]
                ),
                "href": _href(i["area"], "sandhi", i["expected"]),
            }
        )
    # Tones first (the main goal of the app), then the others in a daily order.
    rnd = random.Random(t)
    rnd.shuffle(out)
    out = [c for c in out if levels.is_open(levels.exercise_of(c["href"]), op)]
    out.sort(key=lambda c: 0 if c["id"] in ("speak-tone", "hear-tone") or c["id"].startswith("rule-") else 1)
    out = out[:4]
    fill = [
        {
            "id": "warm-listen",
            "area": "listening",
            "title": "Answer 20 listening questions",
            "why": "Daily ear training.",
            "target": 20,
            "progress": sum(1 for e in now_ev if e["area"] == "listening" and e["mode"] != "rule"),
            "href": "/listening?quiz=tone",
        },
        {
            "id": "warm-rules",
            "area": "listening",
            "slot": "rules",
            "title": "Answer 10 tone rule questions",
            "why": "Know how tones change in words before you say sentences.",
            "target": 10,
            "progress": sum(1 for e in now_ev if e["area"] == "listening" and e["mode"] == "rule"),
            "href": "/listening?quiz=rule",
        },
        {
            "id": "warm-read",
            "area": "reading",
            "title": "Read 15 symbols out loud",
            "why": "Daily reading.",
            "target": 15,
            "progress": sum(1 for e in now_ev if e["area"] == "reading"),
            "href": "/reading",
        },
        {
            "id": "warm-speak",
            "area": "speaking",
            "title": "Record 5 sentences",
            "why": "Daily speaking.",
            "target": 5,
            "progress": sum(1 for e in now_ev if e["area"] == "speaking" and e["mode"] == "sentence"),
            "href": "/speaking",
        },
        {
            "id": "warm-dict",
            "area": "dictation",
            "title": "Write 10 symbols from memory",
            "why": "Daily writing.",
            "target": 10,
            "progress": sum(1 for e in now_ev if e["area"] == "dictation"),
            "href": "/dictation",
        },
        {
            "id": "warm-recognize",
            "area": "recognize",
            "title": "Recognize 20 symbols silently",
            "why": "Daily symbol recall, no speaking.",
            "target": 20,
            "progress": sum(1 for e in now_ev if e["area"] == "recognize"),
            "href": "/recognize",
        },
    ]
    have = {c["area"] for c in out}
    for f in fill:
        if len(out) >= 4:
            break
        slot = f.pop("slot", f["area"])
        if slot not in have and levels.is_open(levels.exercise_of(f["href"]), op):
            out.append(f)
            have.add(slot)
    for c in out:
        c["progress"] = min(c["progress"], c["target"])
        c["done"] = c["progress"] >= c["target"]
    return out


# ---------- export ----------


def export_csv() -> str:
    """Export this learner's full answer history as CSV text."""
    rows = _rows(
        "SELECT e.id AS event, to_char(to_timestamp(e.ts) AT TIME ZONE ?, 'YYYY-MM-DD HH24:MI:SS') AS time, e.area, e.mode, e.item, e.ok AS event_ok, e.first_try,"
        " e.score, e.ms, e.tries, e.help AS event_help, e.replays, u.kind, u.expected, u.actual, u.ok, u.pos, u.try_n,"
        " u.help, u.ctx, u.lex, u.prev, u.next, u.source, u.uncertain"
        " FROM events e LEFT JOIN units u ON u.event_id = e.id ORDER BY e.ts, u.id",
        (db.user_tz().key,),
    )
    buf = io.StringIO()
    if rows:
        w = csv.DictWriter(buf, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    return buf.getvalue()
