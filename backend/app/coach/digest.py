"""The stats digest: one compact summary of the learner's stats that the analysts read."""

from __future__ import annotations

import json
import time
from collections import Counter, defaultdict
from datetime import timedelta

from .. import db, deep_check, levels, placement, stats, typed_fix
from ..zhuyin import RULES
from . import store
from .cleaning import focus_of
from .gates import alphabet_gate, alphabet_status, rules_gate, rules_status
from .progress import milestone_progress, step_progress
from .settings import BOPOMOFO, LEARN_REPS, MEASURES, SYMS


def digest(lv: dict | None = None) -> dict:
    """lv: the level status (levels.check() or levels.status()). Read here when not given."""
    lv = lv or levels.status()
    op = {"level": lv["level"], "exercises": lv["exercises"], "symbols": lv["symbols"]}
    today = db.local_today()
    d7 = (today - timedelta(days=6)).isoformat()
    d14 = (today - timedelta(days=13)).isoformat()
    d45 = (today - timedelta(days=44)).isoformat()
    units = store.query(
        "SELECT u.event_id, u.day, u.area, u.kind, u.expected, u.actual, u.ok, u.pos, u.try_n, u.help, u.ctx, u.lex, u.prev, u.next, e.legacy"
        " FROM units u JOIN events e ON e.id = u.event_id WHERE u.day>=?",
        (d45,),
    )
    events = store.query(
        "SELECT id, ts, day, area, mode, item, ok, help, score, legacy FROM events WHERE day>=? ORDER BY ts", (d45,)
    )
    saved = {r["day"]: r["seconds"] for r in store.query("SELECT day, seconds FROM days")}
    secs = stats._seconds_by_day(store.query("SELECT ts, day FROM events ORDER BY ts"), saved)
    minutes_7d = round(sum(s for d, s in secs.items() if d >= d7) / 60)
    answers_7d = sum(1 for e in events if e["day"] >= d7)

    # One row per practice mode, with what it measures: a tone quiz says nothing about knowing the symbols.
    modes = []
    for key in sorted(
        {(e["area"], e["mode"] if e["area"] in ("listening", "numbers") else None) for e in events}, key=str
    ):
        ev = [e for e in events if e["area"] == key[0] and (key[1] is None or e["mode"] == key[1])]
        week = [e for e in ev if e["day"] >= d7]
        old = [e for e in ev if e["day"] < d7]
        name = key[0] + (f"/{key[1]}" if key[1] else "")
        what, needs = MEASURES.get(name) or MEASURES.get(key[0]) or ("", False)
        modes.append(
            {
                "mode": name,
                "measures": what,
                "needs_alphabet": needs,
                "answers_7d": len(week),
                "right_7d_pct": stats._pct(sum(e["ok"] for e in week), len(week)),
                "answer_shown_pct": stats._pct(sum(e["help"] for e in ev), len(ev)),
                "answers_before": len(old),
                "right_before_pct": stats._pct(sum(e["ok"] for e in old), len(old)),
            }
        )
    # Only the exercises of the open levels: a locked exercise is never a gap to fill.
    never = [
        f"{k} ({v[0]})"
        for k, v in MEASURES.items()
        if k not in {m["mode"] for m in modes}
        and k != "listening"
        and any(e == k or e.startswith(k + "/") for e in op["exercises"])
    ]
    alpha = alphabet_status()

    items = stats.item_stats(units, today)

    def row(i):
        return {
            "area": i["area"],
            "unit": i["kind"],
            "x": i["expected"],
            "answers": i["n"],
            "right_pct": i["acc"],
            "this_week_pct": i["recent"],
            "before_pct": i["before"],
            "last_day": i["last"],
            "produced_instead": dict(i["top"]),
        }

    def is_mastered(i):
        return (i["acc"] or 0) >= 92 and i["n"] >= 20

    skills = [i for i in items if i["n"] >= 3 and i["kind"] in ("tone", "initial", "final", "symbol", "sandhi")]
    mastered = [f"{i['area']} {i['kind']} {i['expected']}" for i in skills if is_mastered(i)]
    weak = [row(i) for i in skills if not is_mastered(i)]

    def pick(pred, n=30):
        return [r for r in weak if pred(r)][:n]

    def syl_rows(area):
        return [row(i) for i in items if i["kind"] == "syllable" and i["area"] == area and i["n"] >= 2][:25]

    new_units = [u for u in units if not u["legacy"]]
    tone_tables: dict[str, dict] = defaultdict(lambda: defaultdict(Counter))
    for u in new_units:
        if u["kind"] == "tone" and u["actual"] is not None:
            tone_tables[u["area"]][u["expected"]][u["actual"]] += 1
    tables = {a: {e: dict(c) for e, c in t.items()} for a, t in tone_tables.items()}

    ctx: dict[tuple, list[int]] = defaultdict(lambda: [0, 0])
    for u in new_units:
        if u["area"] != "speaking" or u["kind"] != "tone" or u["ok"] is None:
            continue
        keys = [("position", "first" if u["pos"] == 0 else "last" if u["next"] is None else "middle", u["expected"])]
        if u["prev"]:
            keys.append(("after tone", u["prev"], u["expected"]))
        if u["next"]:
            keys.append(("before tone", u["next"], u["expected"]))
        if u["lex"]:
            keys.append(("tone change from", u["lex"], u["expected"]))
        for k in keys:
            ctx[k][0] += 1
            ctx[k][1] += bool(u["ok"])
    contexts = sorted(
        (
            {"context": f"{k[0]} {k[1]}", "tone": k[2], "answers": v[0], "right_pct": stats._pct(v[1], v[0])}
            for k, v in ctx.items()
            if v[0] >= 3
        ),
        key=lambda x: x["right_pct"] or 0,
    )[:25]

    mix, tot = Counter(), Counter()
    for u in new_units:
        if u["kind"] in ("initial", "final") and u["ok"] is not None:
            tot[(u["area"], u["kind"], u["expected"])] += 1
            if not u["ok"] and u["actual"] not in (None, u["expected"]):
                mix[(u["area"], u["kind"], u["expected"], u["actual"])] += 1
    mixups = [
        {"area": a, "unit": k, "expected": e, "produced": x, "times": n, "of": tot[(a, k, e)]}
        for (a, k, e, x), n in mix.most_common(20)
    ]
    mic = typed_fix.mic_pairs()
    deep_fixes = deep_check.coach_pairs()

    # Silent recognition: which symbol the typed pinyin stands for, when it is not the shown one (ㄓ typed as "z" = ㄗ).
    rmix, rtot = Counter(), Counter()
    for u in new_units:
        if u["area"] == "recognize" and u["kind"] == "symbol" and u["ok"] is not None:
            rtot[u["expected"]] += 1
            if not u["ok"] and u["actual"] in BOPOMOFO and u["actual"] != u["expected"]:
                rmix[(u["expected"], u["actual"])] += 1
    recognize_mixups = [{"shown": e, "typed_as": x, "times": n, "of": rtot[e]} for (e, x), n in rmix.most_common(20)]

    strokes, stroke_n, order_err = Counter(), Counter(), Counter()
    for u in units:
        if u["kind"] == "stroke":
            stroke_n[u["expected"]] += 1
            if u["actual"] != "ok":
                strokes[(u["expected"], u["actual"])] += 1
        elif u["kind"] == "order" and u["ok"] == 0:
            order_err[u["expected"]] += 1
    stroke_rows: dict[str, dict] = defaultdict(dict)
    for (s, st), n in strokes.most_common(30):
        stroke_rows[s][st] = n
    stroke_out = [{"stroke": s, "written": stroke_n[s], "problems": p} for s, p in stroke_rows.items()][:12]

    practiced = defaultdict(set)
    for i in items:
        if i["kind"] == "symbol":
            practiced[i["area"]].add(i["expected"])
    never = {
        a: "".join(s for s in SYMS if s not in practiced[a]) for a in ("reading", "recognize", "dictation", "writing")
    }
    from .. import story

    story_numbers = story.story_stats(units, events, secs, today)
    num = stats.number_stats(45)
    rs = rules_status(lv)
    rule_rows = [{k: v for k, v in r.items() if not k.endswith("_href")} for r in stats.rule_stats(45)]
    tone_rules = {
        "rules": {rid: {"name": r["name"], "rule": r["short"]} for rid, r in RULES.items()},
        "by_rule": [{**r, **rs["per_rule"][r["rule"]]} for r in rule_rows],
        "known": rs["known"],
        "not_known": rs["missing"],
        "rule_active": rs["gate"],
        "exercises_open": rs["open"],
        "error_kinds": {
            "literal": "read the written (dictionary) tone where the rule changes it",
            "over": "changed 不 or 一 where it keeps its written tone",
            "other": "another tone",
            "help": "right only with help",
        },
        "steps_the_app_adds_first": [s["title"] for s in rules_gate([], rs, op)[0]],
    }

    lib = store.query("SELECT id, hanzi, english, level, topic FROM sentences ORDER BY id DESC LIMIT 300")
    lib_id = {s["hanzi"]: s["id"] for s in lib}
    sp_events = [e for e in events if e["area"] == "speaking" and e["score"] is not None and len(e["item"]) >= 2]
    by_item: dict[str, list[dict]] = defaultdict(list)
    for e in sp_events:
        by_item[e["item"]].append(e)
    item_of = {e["id"]: e["item"] for e in sp_events}
    fails: dict[str, Counter] = defaultdict(Counter)
    for u in new_units:
        if u["event_id"] in item_of and u["kind"] in ("tone", "initial", "final") and u["ok"] == 0:
            fails[item_of[u["event_id"]]][
                f"{u['ctx']} {u['kind']} {u['expected']}->{u['actual'] if u['actual'] is not None else '?'}"
            ] += 1
    sents = []
    for txt, evs in by_item.items():
        sc = [e["score"] for e in evs]
        sents.append(
            {
                "id": lib_id.get(txt),
                "text": txt,
                "recordings": len(sc),
                "avg_score": round(sum(sc) / len(sc)),
                "last_scores": [round(x) for x in sc[-3:]],
                "last_day": evs[-1]["day"],
                "failing": [f"{w} x{n}" for w, n in fails[txt].most_common(5)],
            }
        )
    sents.sort(key=lambda s: s["avg_score"])
    weak_sents = [s for s in sents if s["avg_score"] < 90 or min(s["last_scores"]) < 85][:12]
    good = [s for s in sents if s["avg_score"] >= 90]
    good_len = sorted(len(s["text"]) for s in good)
    unpracticed = [
        {"id": s["id"], "text": s["hanzi"], "english": s["english"], "level": s["level"]}
        for s in lib
        if s["hanzi"] not in by_item
    ][:15]

    prev = []
    for p in store.query(
        "SELECT id, ts, status, diagnosis, done_ts FROM plans WHERE status IN ('active','done','replaced') ORDER BY id DESC LIMIT 3"
    ):
        prev.append(
            {
                "status": p["status"],
                "diagnosis": p["diagnosis"],
                "minutes_open": round(((p["done_ts"] or time.time()) - p["ts"]) / 60),
                "steps": [
                    {
                        "type": s["type"],
                        "title": s["title"],
                        "focus": focus_of(s),
                        "target": s["target"],
                        "status": s["status"],
                        "progress": step_progress(s)["progress"],
                        "skip_reason": s["skip_reason"],
                        "minutes_to_finish": round((s["done_ts"] - p["ts"]) / 60)
                        if s["done_ts"] and s["status"] == "done"
                        else None,
                    }
                    for s in store.steps(p["id"])
                ],
            }
        )
    notes = [
        {"kind": n["kind"], "text": n["text"], "day": db.day_of(n["ts"])}
        for n in store.query("SELECT kind, text, ts FROM coach_notes ORDER BY id DESC LIMIT 10")
    ]
    ms = [
        {
            "id": m["id"],
            "title": m["title"],
            "criterion": json.loads(m["criterion"]),
            "now": milestone_progress(json.loads(m["criterion"]), lv),
        }
        for m in store.query("SELECT * FROM milestones WHERE status='active' ORDER BY id")
    ]
    detail = store.query("SELECT MIN(day) AS since, COUNT(*) AS n FROM events WHERE legacy=0")[0]

    return {
        "overview": {
            "today": today.isoformat(),
            "answers_7d": answers_7d,
            "minutes_7d": minutes_7d,
            "answers_per_minute": round(answers_7d / minutes_7d, 1) if minutes_7d >= 5 else None,
            "days_practiced_7d": len({e["day"] for e in events if e["day"] >= d7}),
            "modes": modes,
            "modes_never_practiced": never,
            "alphabet": {
                "known_symbols": alpha["known_count"],
                "of": 37,
                "known": alpha["known"],
                "seen_not_known": alpha["learning"],
                "never_practiced": alpha["new"],
                "rule_active": alpha["gate"],
                "right_repetitions": {x["sym"]: x["reps"] for x in alpha["symbols"] if x["reps"]},
                "repetitions_before_tests": LEARN_REPS,
                "steps_the_app_adds_first": [s["title"] for s in alphabet_gate([], alpha, op)[0]],
            },
            "tone_rules": {
                "known": rs["known"],
                "not_known": rs["missing"],
                "rule_active": rs["gate"],
                "steps_the_app_adds_first": tone_rules["steps_the_app_adds_first"],
            },
            "level": levels.coach_view(lv),
            "placement": placement.coach_view(),
            "mastered": mastered,
            "detailed_answers": detail["n"],
            "detailed_log_since": detail["since"],
            "old_answers_without_detail": sum(1 for e in events if e["legacy"]),
        },
        "tones_listening": {
            "skills": pick(lambda r: r["area"] == "listening" and r["unit"] == "tone"),
            "expected_to_picked": tables.get("listening", {}),
            "syllables_weakest_first": syl_rows("listening"),
        },
        "tones_speaking": {
            "skills": pick(lambda r: r["area"] == "speaking" and r["unit"] == "tone"),
            "expected_to_said": tables.get("speaking", {}),
            "contexts_weakest_first": contexts,
            "syllables_weakest_first": syl_rows("speaking"),
        },
        "sounds": {
            "skills": pick(lambda r: r["unit"] in ("initial", "final")),
            "mixups": mixups,
            "mic_pairs": mic,
            "deep_fixes": deep_fixes,
        },
        "tone_rules": tone_rules,
        "numbers": {
            "by_mode": num["modes"],
            "by_size": num["bands"],
            "errors": num["errors"],
            "error_kinds": num["error_names"],
            "picked_instead": num["mixups"],
            "characters_said_wrong": num["chars"],
            "numbers_missed": num["missed"],
        },
        "symbols": {
            "skills": pick(lambda r: r["unit"] == "symbol" or (r["area"] == "writing" and r["unit"] == "tone"), 40),
            "recognize_mixups": recognize_mixups,
            "mic_pairs": [p for p in mic if p["area"] == "reading"],
            "stroke_problems": stroke_out,
            "stroke_order_errors": dict(order_err.most_common(12)),
            "never_practiced": never,
        },
        "sentences": {
            "weak": weak_sents,
            "good_count": len(good),
            "typical_good_length": good_len[len(good_len) // 2] if good_len else None,
            "library_not_practiced": unpracticed,
        },
        "pace": {
            "minutes_by_day_14d": {d: round(s / 60) for d, s in sorted(secs.items()) if d >= d14},
            "answers_per_minute": round(answers_7d / minutes_7d, 1) if minutes_7d >= 5 else None,
            "previous_plans": prev,
            "recent_coach_notes": notes,
        },
        "milestones": ms,
        "story": story_numbers,
        "_skills": weak,
        "_open": op,
    }
