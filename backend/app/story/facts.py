"""Build named facts from saved learner data. Only these values can appear in a story."""

from __future__ import annotations

from datetime import date, timedelta

from .. import coach, db

TONE = {"1": "tone 1", "2": "tone 2", "3": "tone 3", "4": "tone 4", "5": "the neutral tone"}


MODE_LABEL = {
    "reading": "reading symbols aloud",
    "recognize": "recognizing symbols silently (typing their pinyin)",
    "listening/tone": "the tone quiz (by ear)",
    "listening/zhuyin": "picking Bopomofo by ear",
    "listening/rule": "the tone rules quiz (3-3, 不, 一)",
    "dictation": "writing symbols you hear",
    "writing": "writing syllables",
    "speaking": "speaking",
}


UNIT_WORD = {
    "%": "",
    "min": "minutes",
    "days": "days",
    "answers": "answers",
    "times": "times",
    "symbols": "symbols",
    "points": "points",
}


def fmt(f: dict) -> str:
    """A fact with its unit, for the fact list the model reads: 79%, 36 minutes, 1 day."""
    v = f["value"]
    v = round(v) if isinstance(v, float) and (abs(v) >= 10 or f["unit"] == "%") else v
    if f["unit"] == "%":
        return f"{v}%"
    word = UNIT_WORD.get(f["unit"], "")
    if word and v == 1:
        word = word[:-1]
    return f"{v} {word}".strip()


def bare(f: dict) -> str:
    """A fact inside a sentence: the number only (79%, 36). The sentence around it says the unit."""
    v = f["value"]
    v = round(v) if isinstance(v, float) and (abs(v) >= 10 or f["unit"] == "%") else v
    return f"{v}%" if f["unit"] == "%" else str(v)


def story_stats(units: list[dict], events: list[dict], secs: dict[str, int], today: date) -> dict:
    """Extra numbers for the story, saved in the digest: 28 days of practice, the streak, and every tone (also the strong ones)."""
    d28 = (today - timedelta(days=27)).isoformat()
    from .. import stats

    tones = []
    for i in stats.item_stats(units, today):
        if i["kind"] == "tone" and i["area"] in ("listening", "speaking") and i["n"] >= 3:
            tones.append(
                {
                    "area": i["area"],
                    "tone": i["expected"],
                    "answers": i["n"],
                    "pct": i["acc"],
                    "week_pct": i["recent"],
                    "before_pct": i["before"],
                    "instead": {a: n for a, n in i["top"] if a not in ("?", None)},
                }
            )
    days = {d for d, s in secs.items() if s > 0}
    return {
        "minutes_by_day_28d": {d: round(s / 60) for d, s in sorted(secs.items()) if d >= d28},
        "minutes_28d": round(sum(s for d, s in secs.items() if d >= d28) / 60),
        "streak": db.streak(days, today),
        "answers_total": coach.store.query("SELECT COUNT(*) AS n FROM events")[0]["n"],
        "tones": tones,
    }


def story_facts(d: dict, steps: list[dict], milestones: list[dict], pace: dict | None = None) -> dict[str, dict]:
    """Every number the story may show, keyed. A fact: {key, label, value, unit}; a series: {key, label, values, labels, unit, series}."""
    F: dict[str, dict] = {}

    def add(key, label, value, unit="", **extra):
        if value is None or isinstance(value, bool):
            return
        F[key] = {"key": key, "label": label, "value": value, "unit": unit, **extra}

    ov = d.get("overview") or {}
    s = d.get("story") or {}
    add("practice.minutes.7d", "minutes of practice in the last 7 days", ov.get("minutes_7d"), "min")
    add("practice.answers.7d", "answers in the last 7 days", ov.get("answers_7d"), "answers")
    add("practice.days.7d", "days with practice in the last 7 days", ov.get("days_practiced_7d"), "days")
    add("practice.answers_per_minute", "answers per minute of practice", ov.get("answers_per_minute"))
    add("practice.streak", "days in a row with practice", s.get("streak"), "days")
    add("practice.answers.total", "answers since the start", s.get("answers_total"), "answers")
    by_day = s.get("minutes_by_day_28d") or (d.get("pace") or {}).get("minutes_by_day_14d") or {}
    if by_day:
        if s.get("minutes_28d") is not None:
            add("practice.minutes.28d", "minutes of practice in the last 28 days", s["minutes_28d"], "min")
        add(
            "practice.days.28d",
            "days with practice in the last 28 days",
            sum(1 for v in by_day.values() if v > 0),
            "days",
        )
        F["practice.minutes_by_day"] = {
            "key": "practice.minutes_by_day",
            "label": "minutes of practice per day",
            "series": True,
            "unit": "min",
            "values": list(by_day.values()),
            "labels": list(by_day.keys()),
        }

    for m in ov.get("modes") or []:
        k = "mode." + m["mode"].replace("/", "_")
        name = MODE_LABEL.get(m["mode"], m["mode"])
        extra = {"needs_alphabet": m.get("needs_alphabet"), "measures": m.get("measures")}
        add(k + ".pct", f"right in {name}, last 7 days", m.get("right_7d_pct"), "%", **extra)
        add(k + ".answers", f"answers in {name}, last 7 days", m.get("answers_7d"), "answers", **extra)
        add(k + ".pct_before", f"right in {name}, before the last 7 days", m.get("right_before_pct"), "%", **extra)
        add(
            k + ".help_pct",
            f"answers in {name} where the answer was shown first",
            m.get("answer_shown_pct"),
            "%",
            **extra,
        )

    rows = s.get("tones") or [
        {
            "area": r["area"],
            "tone": r["x"],
            "answers": r["answers"],
            "pct": r["right_pct"],
            "week_pct": r["this_week_pct"],
            "before_pct": r["before_pct"],
            "instead": r.get("produced_instead") or {},
        }
        for r in d.get("_skills") or []
        if r["unit"] == "tone" and r["area"] in ("listening", "speaking")
    ]
    for area, short, how in (("listening", "listen", "by ear"), ("speaking", "speak", "when you say it")):
        mine = [r for r in rows if r["area"] == area and r["pct"] is not None]
        for r in mine:
            add(f"tone.{short}.{r['tone']}.pct", f"{TONE.get(r['tone'], r['tone'])} right {how}", r["pct"], "%")
            add(
                f"tone.{short}.{r['tone']}.answers",
                f"answers on {TONE.get(r['tone'], r['tone'])} {how}",
                r["answers"],
                "answers",
            )
            for a, n in (r.get("instead") or {}).items():
                if a in TONE and a != r["tone"]:
                    verb = "picked" if area == "listening" else "said"
                    add(
                        f"mix.{area}.tone.{r['tone']}>{a}",
                        f"times you {verb} {TONE[a]} instead of {TONE[r['tone']]}",
                        n,
                        "times",
                    )
        n = sum(r["answers"] for r in mine)
        if n:
            add(
                f"tone.{short}.all.pct",
                f"tones right {how}, all tones",
                round(sum(r["pct"] * r["answers"] for r in mine) / n, 1),
                "%",
            )
            add(f"tone.{short}.all.answers", f"tone answers {how}", n, "answers")
    for area, table in (
        ("listening", (d.get("tones_listening") or {}).get("expected_to_picked")),
        ("speaking", (d.get("tones_speaking") or {}).get("expected_to_said")),
    ):
        for e, got in (table or {}).items():
            for a, n in got.items():
                if a in TONE and a != e:
                    verb = "picked" if area == "listening" else "said"
                    add(
                        f"mix.{area}.tone.{e}>{a}",
                        f"times you {verb} {TONE[a]} instead of {TONE.get(e, e)}",
                        n,
                        "times",
                    )
    for m in (d.get("sounds") or {}).get("mixups") or []:
        add(
            f"mix.{m['area']}.{m['unit']}.{m['expected']}>{m['produced']}",
            f"times you gave {m['produced']} instead of {m['expected']} ({m['area']})",
            m["times"],
            "times",
        )
    for m in (d.get("symbols") or {}).get("recognize_mixups") or []:
        add(
            f"mix.recognize.symbol.{m['shown']}>{m['typed_as']}",
            f"times you typed the pinyin of {m['typed_as']} for {m['shown']}",
            m["times"],
            "times",
        )
    for r in d.get("_skills") or []:
        if r["unit"] in ("initial", "final", "symbol"):
            add(f"skill.{r['area']}.{r['unit']}.{r['x']}.pct", f"{r['x']} right ({r['area']})", r["right_pct"], "%")
    for r in (d.get("tone_rules") or {}).get("by_rule") or []:
        if r.get("n"):
            k = "rule." + r["rule"].replace("-", "")
            add(k + ".pct", f"right on the {r['name']}", r.get("acc"), "%")
            add(k + ".answers", f"answers on the {r['name']}", r["n"], "answers")
            add(
                k + ".literal",
                f"times you read the written tone where the {r['name']} changes it",
                r.get("literal"),
                "times",
            )

    a = ov.get("alphabet") or {}
    if a:
        add("alphabet.known", "Bopomofo symbols you know", a.get("known_symbols"), "symbols")
        add("alphabet.total", "Bopomofo symbols in all (a bare number)", 37)
        add(
            "alphabet.learning",
            "symbols you have met but do not know yet",
            len(a.get("seen_not_known") or ""),
            "symbols",
        )
        add("alphabet.new", "symbols you have never practiced", len(a.get("never_practiced") or ""), "symbols")
        add(
            "alphabet.reps_needed",
            "right repetitions of a symbol before tests from memory",
            a.get("repetitions_before_tests"),
            "times",
        )
        for sym, n in (a.get("right_repetitions") or {}).items():
            add(f"alphabet.reps.{sym}", f"right repetitions of {sym}", n, "times")

    sent = d.get("sentences") or {}
    add("sentence.good.count", "sentences you say well (90 points or more)", sent.get("good_count"))
    for i, w in enumerate((sent.get("weak") or [])[:6], 1):
        add(
            f"sentence.weak.{i}.score",
            f"average score of the sentence {w['text']}",
            w["avg_score"],
            "points",
            text=w["text"],
        )

    for m in milestones:
        c = m["criterion"]
        if c["unit"] == "alphabet":
            add(f"milestone.{m['id']}.now", f"now, for the goal {m['title']}", m.get("n"), "symbols")
            add(f"milestone.{m['id']}.goal", f"goal of {m['title']}", round(37 * c["min_acc"] / 100), "symbols")
        else:
            unit = "points" if c["unit"] == "score" else "%"
            add(f"milestone.{m['id']}.now", f"now, for the goal {m['title']}", m.get("value"), unit)
            add(f"milestone.{m['id']}.goal", f"goal of {m['title']}", c["min_acc"], unit)

    add("plan.steps", "steps in this plan", len(steps))
    add("plan.minutes", "minutes this plan takes, all steps together", sum(x.get("minutes") or 0 for x in steps), "min")
    return F


def story_context(d: dict, steps: list[dict]) -> dict:
    """Data for the blocks that need more than one number: the alphabet grid, the calendar, the plan steps."""
    a = (d.get("overview") or {}).get("alphabet") or {}
    by_day = (d.get("story") or {}).get("minutes_by_day_28d") or (d.get("pace") or {}).get("minutes_by_day_14d") or {}
    today = date.fromisoformat((d.get("overview") or {}).get("today") or db.local_today().isoformat())
    cal = [
        {
            "day": (today - timedelta(days=i)).isoformat(),
            "minutes": by_day.get((today - timedelta(days=i)).isoformat(), 0),
        }
        for i in range(27, -1, -1)
    ]
    nxt = next((x["params"].get("syms") or [] for x in steps if x["type"] == "read_symbols"), [])
    return {
        "alphabet": {
            "known": a.get("known", ""),
            "learning": a.get("seen_not_known", ""),
            "new": a.get("never_practiced", ""),
            "reps": a.get("right_repetitions") or {},
            "reps_needed": a.get("repetitions_before_tests") or coach.settings.LEARN_REPS,
            "next": nxt,
        },
        "calendar": cal,
        "steps": [
            {
                "type": x["type"],
                "title": x["title"],
                "target": x["target"],
                "minutes": x.get("minutes"),
                "learn": bool((x.get("params") or {}).get("learn")),
            }
            for x in steps
        ],
    }
