"""The plan story: a short headline and the "How do we know?" cards, written by the model from a catalog of blocks.

The model never writes a number. In props it refers to a fact ({"$fact": "key"}), and in text it writes a placeholder ({key}).
This module builds the facts from the plan's saved stats, checks every card against CATALOG, and fills the numbers in before
the story is saved. When the model is not available, a fixed story is built from the same facts and blocks."""
from __future__ import annotations

import asyncio
import json
import re
from datetime import date, timedelta

from . import coach, db

# ---------- the facts ----------

TONE = {"1": "tone 1", "2": "tone 2", "3": "tone 3", "4": "tone 4", "5": "the neutral tone"}
MODE_LABEL = {"reading": "reading symbols aloud", "listening/tone": "the tone quiz (by ear)", "listening/zhuyin": "picking Bopomofo by ear",
              "dictation": "writing symbols you hear", "writing": "writing syllables", "speaking": "speaking"}
UNIT_WORD = {"%": "", "min": "minutes", "days": "days", "answers": "answers", "times": "times", "symbols": "symbols", "points": "points"}


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
    from . import stats
    tones = []
    for i in stats.item_stats(units, today):
        if i["kind"] == "tone" and i["area"] in ("listening", "speaking") and i["n"] >= 3:
            tones.append({"area": i["area"], "tone": i["expected"], "answers": i["n"], "pct": i["acc"], "week_pct": i["recent"],
                          "before_pct": i["before"], "instead": {a: n for a, n in i["top"] if a not in ("?", None)}})
    days = {d for d, s in secs.items() if s > 0}
    return {"minutes_by_day_28d": {d: round(s / 60) for d, s in sorted(secs.items()) if d >= d28},
            "minutes_28d": round(sum(s for d, s in secs.items() if d >= d28) / 60),
            "streak": db.streak(days, today), "answers_total": coach._q("SELECT COUNT(*) AS n FROM events")[0]["n"],
            "tones": tones}


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
        add("practice.days.28d", "days with practice in the last 28 days", sum(1 for v in by_day.values() if v > 0), "days")
        F["practice.minutes_by_day"] = {"key": "practice.minutes_by_day", "label": "minutes of practice per day", "series": True, "unit": "min",
                                        "values": list(by_day.values()), "labels": list(by_day.keys())}

    for m in ov.get("modes") or []:
        k = "mode." + m["mode"].replace("/", "_")
        name = MODE_LABEL.get(m["mode"], m["mode"])
        extra = {"needs_alphabet": m.get("needs_alphabet"), "measures": m.get("measures")}
        add(k + ".pct", f"right in {name}, last 7 days", m.get("right_7d_pct"), "%", **extra)
        add(k + ".answers", f"answers in {name}, last 7 days", m.get("answers_7d"), "answers", **extra)
        add(k + ".pct_before", f"right in {name}, before the last 7 days", m.get("right_before_pct"), "%", **extra)
        add(k + ".help_pct", f"answers in {name} where the answer was shown first", m.get("answer_shown_pct"), "%", **extra)

    rows = s.get("tones") or [{"area": r["area"], "tone": r["x"], "answers": r["answers"], "pct": r["right_pct"], "week_pct": r["this_week_pct"],
                               "before_pct": r["before_pct"], "instead": r.get("produced_instead") or {}}
                              for r in d.get("_skills") or [] if r["unit"] == "tone" and r["area"] in ("listening", "speaking")]
    for area, short, how in (("listening", "listen", "by ear"), ("speaking", "speak", "when you say it")):
        mine = [r for r in rows if r["area"] == area and r["pct"] is not None]
        for r in mine:
            add(f"tone.{short}.{r['tone']}.pct", f"{TONE.get(r['tone'], r['tone'])} right {how}", r["pct"], "%")
            add(f"tone.{short}.{r['tone']}.answers", f"answers on {TONE.get(r['tone'], r['tone'])} {how}", r["answers"], "answers")
            for a, n in (r.get("instead") or {}).items():
                if a in TONE and a != r["tone"]:
                    verb = "picked" if area == "listening" else "said"
                    add(f"mix.{area}.tone.{r['tone']}>{a}", f"times you {verb} {TONE[a]} instead of {TONE[r['tone']]}", n, "times")
        n = sum(r["answers"] for r in mine)
        if n:
            add(f"tone.{short}.all.pct", f"tones right {how}, all tones", round(sum(r["pct"] * r["answers"] for r in mine) / n, 1), "%")
            add(f"tone.{short}.all.answers", f"tone answers {how}", n, "answers")
    for area, table in (("listening", (d.get("tones_listening") or {}).get("expected_to_picked")), ("speaking", (d.get("tones_speaking") or {}).get("expected_to_said"))):
        for e, got in (table or {}).items():
            for a, n in got.items():
                if a in TONE and a != e:
                    verb = "picked" if area == "listening" else "said"
                    add(f"mix.{area}.tone.{e}>{a}", f"times you {verb} {TONE[a]} instead of {TONE.get(e, e)}", n, "times")
    for m in (d.get("sounds") or {}).get("mixups") or []:
        add(f"mix.{m['area']}.{m['unit']}.{m['expected']}>{m['produced']}", f"times you gave {m['produced']} instead of {m['expected']} ({m['area']})", m["times"], "times")
    for r in d.get("_skills") or []:
        if r["unit"] in ("initial", "final", "symbol"):
            add(f"skill.{r['area']}.{r['unit']}.{r['x']}.pct", f"{r['x']} right ({r['area']})", r["right_pct"], "%")

    a = ov.get("alphabet") or {}
    if a:
        add("alphabet.known", "Bopomofo symbols you know", a.get("known_symbols"), "symbols")
        add("alphabet.total", "Bopomofo symbols in all (a bare number)", 37)
        add("alphabet.learning", "symbols you have met but do not know yet", len(a.get("seen_not_known") or ""), "symbols")
        add("alphabet.new", "symbols you have never practiced", len(a.get("never_practiced") or ""), "symbols")
        add("alphabet.reps_needed", "right repetitions of a symbol before tests from memory", a.get("repetitions_before_tests"), "times")
        for sym, n in (a.get("right_repetitions") or {}).items():
            add(f"alphabet.reps.{sym}", f"right repetitions of {sym}", n, "times")

    sent = d.get("sentences") or {}
    add("sentence.good.count", "sentences you say well (90 points or more)", sent.get("good_count"))
    for i, w in enumerate((sent.get("weak") or [])[:6], 1):
        add(f"sentence.weak.{i}.score", f"average score of the sentence {w['text']}", w["avg_score"], "points", text=w["text"])

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
    today = date.fromisoformat((d.get("overview") or {}).get("today") or date.today().isoformat())
    cal = [{"day": (today - timedelta(days=i)).isoformat(), "minutes": by_day.get((today - timedelta(days=i)).isoformat(), 0)} for i in range(27, -1, -1)]
    nxt = next((x["params"].get("syms") or [] for x in steps if x["type"] == "read_symbols"), [])
    return {"alphabet": {"known": a.get("known", ""), "learning": a.get("seen_not_known", ""), "new": a.get("never_practiced", ""),
                         "reps": a.get("right_repetitions") or {}, "reps_needed": a.get("repetitions_before_tests") or coach.LEARN_REPS, "next": nxt},
            "calendar": cal,
            "steps": [{"type": x["type"], "title": x["title"], "target": x["target"], "minutes": x.get("minutes"),
                       "learn": bool((x.get("params") or {}).get("learn"))} for x in steps]}


# ---------- the block catalog ----------
# Prop specs: ("text", max) · ("fact",) a number fact · ("pct",) a fact in % · ("series",) a series fact · ("enum", [...])
# · ("syms", max) single Bopomofo symbols · ("glyph",) one emoji or CJK character · ("bool",) · ("list", min, max, {item props}).
# A prop name that ends with "?" is optional.

CATALOG: dict[str, dict] = {
    "kicker": {"desc": "a small uppercase label above the card text", "props": {"text": ("text", 30)}},
    "headline": {"desc": "a large title, the main line of the card", "props": {"text": ("text", 70)}},
    "text": {"desc": "one short sentence", "props": {"text": ("text", 140)}},
    "big_number": {"desc": "one number that counts up, with a label", "chart": True, "props": {"value": ("fact",), "label": ("text", 40)}},
    "ring": {"desc": "a percentage as a ring that fills", "chart": True, "props": {"value": ("pct",), "label": ("text", 40)}},
    "bars": {"desc": "2 to 6 bars that grow, for example the tones side by side; highlight the one that matters", "chart": True,
             "props": {"items": ("list", 2, 6, {"label": ("text", 18), "value": ("fact",), "highlight?": ("bool",)})}},
    "versus": {"desc": "two numbers face to face, for example ear against mouth", "chart": True,
               "props": {"left": ("obj", {"label": ("text", 24), "value": ("fact",)}), "right": ("obj", {"label": ("text", 24), "value": ("fact",)})}},
    "symbol_grid": {"desc": "the 37 Bopomofo symbols, colored known / learning / new, with a ring on the highlighted ones", "chart": True,
                    "props": {"highlight?": ("syms", 8)}},
    "confusion": {"desc": "arrows from what was expected to what you gave instead, with how many times", "chart": True,
                  "props": {"pairs": ("list", 1, 4, {"from": ("text", 16), "to": ("text", 16), "count": ("fact",)})}},
    "calendar": {"desc": "the last 28 days, one square per day, brighter with more practice", "chart": True, "props": {}},
    "sparkline": {"desc": "a line that draws itself, from a series fact", "chart": True, "props": {"series": ("series",), "label": ("text", 40)}},
    "chips": {"desc": "up to 8 small tags, for example the next symbols or tones", "props": {"items": ("list", 1, 8, ("text", 20))}},
    "steps": {"desc": "the steps of this plan, appearing one by one", "chart": True, "props": {}},
    "sticker": {"desc": "one big emoji or CJK character that pops in, with a short caption", "props": {"glyph": ("glyph",), "text?": ("text", 40)}},
    "cta": {"desc": "the final button: start the first step, or close the story", "props": {"label": ("text", 30), "action": ("enum", ["start", "close"])}},
}
MOODS = ["warm", "calm", "bright", "deep", "win"]
MAX_CARDS, MIN_CARDS, MAX_BLOCKS, MAX_CHARTS = 9, 5, 4, 2
TONE_NAMES = re.compile(r"\b(?:[Tt]ones?)\s+[1-5](?:\s*(?:,|and|or|&|/|vs\.?|versus)\s*(?:tone\s+)?[1-5])*\b")
PLACEHOLDER = re.compile(r"\{([^{}\s]{1,60})\}")
SYM_RE = re.compile(f"^[{coach.SYMS}]$")


def catalog_text() -> str:
    def spec(p):
        k = p[0]
        if k == "text":
            return f"text (max {p[1]} characters)"
        if k == "list":
            inner = spec(p[3]) if isinstance(p[3], tuple) else "{" + ", ".join(f'"{n}": {spec(v)}' for n, v in p[3].items()) + "}"
            return f"list of {p[1]} to {p[2]} × {inner}"
        if k == "obj":
            return "{" + ", ".join(f'"{n}": {spec(v)}' for n, v in p[1].items()) + "}"
        return {"fact": '{"$fact":"key"}', "pct": '{"$fact":"key of a % fact"}', "series": '{"$fact":"key of a series fact"}',
                "enum": " | ".join(f'"{x}"' for x in p[1]) if k == "enum" else "", "syms": f"list of up to {p[1] if k == 'syms' else 0} single Bopomofo symbols",
                "glyph": "one emoji or one CJK character", "bool": "true | false"}[k]
    return "\n".join(f"- {t}{' [chart]' if c.get('chart') else ''}: {c['desc']}. props: "
                     + ("{" + ", ".join(f'"{n}": {spec(v)}' for n, v in c["props"].items()) + "}" if c["props"] else "none") for t, c in CATALOG.items())


def check_text(s, n: int, facts: dict, where: str, errors: list[str], strict: bool) -> str | None:
    """Fill the {key} placeholders. A digit outside a placeholder or a tone name is an error: the model may not write numbers."""
    if not isinstance(s, str) or not s.strip():
        errors.append(f"{where}: empty text")
        return None
    s = " ".join(s.split())
    bad = [k for k in PLACEHOLDER.findall(s) if k not in facts or facts[k].get("series")]
    if bad:
        errors.append(f"{where}: unknown fact keys {bad}")
        return None
    if re.search(r"\d", TONE_NAMES.sub("", PLACEHOLDER.sub("", s))):
        errors.append(f"{where}: a digit written by hand; write numbers only as {{key}} placeholders")
        return None
    out = PLACEHOLDER.sub(lambda m: bare(facts[m.group(1)]), s)
    # A unit written twice ("266 answers answers", "86% percent") reads badly: keep one.
    for w in [x for x in UNIT_WORD.values() if x] + ["percent"]:
        prev = None
        while prev != out:
            prev, out = out, re.sub(rf"(\d[\d.,]*(?:%| {w}| {w[:-1]})) (?:{w}|{w[:-1]})\b", r"\1", out)
    out = re.sub(r"(\d+%) (?:percent|per cent)\b", r"\1", out)
    if len(out) > n:
        errors.append(f"{where}: {len(out)} characters, max {n}")
        if strict:
            return None
        out = out[: n - 1].rsplit(" ", 1)[0] + "…"
    return out


def _ref(v, facts: dict) -> str | None:
    if isinstance(v, dict) and isinstance(v.get("$fact"), str):
        return v["$fact"]
    if isinstance(v, str):
        m = PLACEHOLDER.fullmatch(v.strip())
        return m.group(1) if m else v.strip()
    return None


def check_prop(spec: tuple, v, facts: dict, where: str, errors: list[str], strict: bool):
    k = spec[0]
    if k == "text":
        return check_text(v, spec[1], facts, where, errors, strict)
    if k in ("fact", "pct", "series"):
        key = _ref(v, facts)
        f = facts.get(key or "")
        if not f:
            errors.append(f"{where}: unknown fact {v!r}; numbers must be {{\"$fact\": key}} from the facts list")
            return None
        if (k == "series") != bool(f.get("series")) or (k == "pct" and f["unit"] != "%"):
            errors.append(f"{where}: fact {key} is not a {'series' if k == 'series' else '% fact' if k == 'pct' else 'number'}")
            return None
        return dict(f)
    if k == "enum":
        if v in spec[1]:
            return v
        errors.append(f"{where}: {v!r} is not one of {spec[1]}")
        return None
    if k == "bool":
        return bool(v)
    if k == "glyph":
        if isinstance(v, str) and 1 <= len(v.strip()) <= 4 and not re.search(r"[A-Za-z0-9]", v):
            return v.strip()
        errors.append(f"{where}: glyph must be one emoji or one CJK character")
        return None
    if k == "syms":
        out = [x for x in (v or []) if isinstance(x, str) and SYM_RE.match(x)][: spec[1]] if isinstance(v, list) else []
        return out
    if k == "obj":
        if not isinstance(v, dict):
            errors.append(f"{where}: must be an object")
            return None
        return check_props(spec[1], v, facts, where, errors, strict)
    if k == "list":
        if not isinstance(v, list):
            errors.append(f"{where}: must be a list")
            return None
        items = []
        for i, x in enumerate(v[: spec[2]]):
            item = check_prop(spec[3], x, facts, f"{where}[{i}]", errors, strict) if isinstance(spec[3], tuple) else (
                check_props(spec[3], x, facts, f"{where}[{i}]", errors, strict) if isinstance(x, dict) else None)
            if item is not None:
                items.append(item)
        if len(v) > spec[2]:
            errors.append(f"{where}: at most {spec[2]} items")
        if len(items) < spec[1]:
            errors.append(f"{where}: needs at least {spec[1]} valid items")
            return None
        return items
    return None


def check_props(specs: dict, props: dict, facts: dict, where: str, errors: list[str], strict: bool) -> dict | None:
    out = {}
    for name, spec in specs.items():
        opt = name.endswith("?")
        key = name.rstrip("?")
        if key not in props or props[key] in (None, "", []):
            if not opt:
                errors.append(f"{where}.{key}: missing")
                return None
            continue
        v = check_prop(spec, props[key], facts, f"{where}.{key}", errors, strict)
        if v is None:
            if opt:
                continue
            return None
        out[key] = v
    return out


def clean_card(card, facts: dict, strict: bool = True) -> tuple[dict | None, list[str]]:
    """One card, checked against CATALOG, with the numbers filled in. strict: any problem rejects the card (the model retries);
    not strict: bad blocks are dropped and long texts are cut."""
    errors: list[str] = []
    if not isinstance(card, dict) or not isinstance(card.get("blocks"), list):
        return None, ["the card must be {\"blocks\": [...]}"]
    blocks, charts = [], 0
    for i, b in enumerate(card["blocks"]):
        where = f"block {i}"
        t = b.get("type") if isinstance(b, dict) else None
        if t not in CATALOG:
            errors.append(f"{where}: unknown type {t!r}")
            continue
        if len(blocks) >= MAX_BLOCKS:
            errors.append(f"at most {MAX_BLOCKS} blocks")
            break
        if CATALOG[t].get("chart") and charts >= MAX_CHARTS:
            errors.append(f"{where}: at most {MAX_CHARTS} chart blocks per card")
            continue
        props = check_props(CATALOG[t]["props"], b.get("props") if isinstance(b.get("props"), dict) else {}, facts, f"{where} ({t})", errors, strict)
        if props is None:
            continue
        charts += bool(CATALOG[t].get("chart"))
        blocks.append({"type": t, "props": props})
    if strict and errors:
        return None, errors
    if not blocks:
        return None, errors or ["no valid block"]
    chars = sum(len(json.dumps(b["props"], ensure_ascii=False)) for b in blocks if b["type"] in ("headline", "text", "kicker"))
    seconds = coach._int(card.get("seconds"), 6, 10, max(6, min(10, round(5 + chars / 45 + charts * 1.5))))
    mood = card.get("mood") if card.get("mood") in MOODS else "warm"
    return {"id": coach._text(card.get("id"), 20) or "c", "mood": mood, "seconds": seconds, "blocks": blocks}, errors


def _has_cta(c: dict) -> bool:
    return any(b["type"] == "cta" for b in c["blocks"])


def finish(cards: list[dict], fallback: list[dict]) -> list[dict]:
    """5 to 9 cards (fixed cards fill a short story); only the last card has the button."""
    cards = [c for c in cards if c][:MAX_CARDS]
    extra = [c for c in fallback if not _has_cta(c)]
    while len(cards) < MIN_CARDS and extra:
        cards.insert(len(cards) - 1 if cards and _has_cta(cards[-1]) else len(cards), extra.pop(0))
    for c in cards[:-1]:
        c["blocks"] = [b for b in c["blocks"] if b["type"] != "cta"] or c["blocks"]
    cta = {"type": "cta", "props": {"label": "Start the first step", "action": "start"}}
    if cards and not _has_cta(cards[-1]):
        if len(cards[-1]["blocks"]) < MAX_BLOCKS:
            cards[-1]["blocks"].append(cta)
        else:
            cards.append({"id": "go", "mood": "win", "seconds": 6, "blocks": [{"type": "headline", "props": {"text": "Ready when you are."}}, cta]})
    for i, c in enumerate(cards):
        c["id"] = f"c{i + 1}"
    return cards[:MAX_CARDS + 1]


# ---------- the headline ----------

def check_headline(h, gate: bool) -> tuple[str | None, list[str]]:
    errors = []
    if not isinstance(h, str) or not h.strip():
        return None, ["empty headline"]
    h = " ".join(h.split())
    if len(h) > 220:
        errors.append(f"{len(h)} characters, max 220")
    if len(re.findall(r"[.!?](?:\s|$)", h.replace("...", "…"))) > 2:
        errors.append("more than 2 sentences")
    if re.search(r"\d|%", TONE_NAMES.sub("", h)):
        errors.append("it has a number: write no numbers and no stats")
    if gate and not re.search(f"alphabet|symbol|bopomofo|zhuyin|letter|[{coach.SYMS}]", h, re.I):
        errors.append("the learner does not know the alphabet yet: the headline must be about the symbols or the alphabet")
    return (None if errors else h), errors


def template_headline(gate: bool) -> str:
    if gate:
        return ("Your ears already get along with the tones; your eyes are still being introduced to the Bopomofo symbols. "
                "This plan makes the introductions, a few symbols at a time.")
    return "You are making real progress, and a few sounds still like to play tricks on you. This plan goes after the trickiest ones first."


# ---------- the fixed story (no model) ----------

def rules_cards(facts: dict, ctx: dict, gate: bool) -> list[dict]:
    F = facts
    raw: list[dict] = []
    if "practice.minutes.7d" in F:
        raw.append({"mood": "warm", "blocks": [{"type": "kicker", "props": {"text": "Your week"}},
                                                {"type": "big_number", "props": {"value": {"$fact": "practice.minutes.7d"}, "label": "minutes of practice"}},
                                                {"type": "calendar", "props": {}},
                                                {"type": "text", "props": {"text": "Every minute is saved, down to each tone you hear and say."}}]})
    if "tone.listen.all.pct" in F:
        raw.append({"mood": "bright", "blocks": [{"type": "kicker", "props": {"text": "Your strong side"}},
                                                  {"type": "headline", "props": {"text": "Your ears are on it."}},
                                                  {"type": "ring", "props": {"value": {"$fact": "tone.listen.all.pct"}, "label": "tones right by ear"}}]})
    spoken = [t for t in "12345" if f"tone.speak.{t}.pct" in F]
    if len(spoken) >= 2:
        worst = min(spoken, key=lambda t: F[f"tone.speak.{t}.pct"]["value"])
        raw.append({"mood": "deep", "blocks": [{"type": "kicker", "props": {"text": "When you speak"}},
                                                {"type": "headline", "props": {"text": "Some tones need more love."}},
                                                {"type": "bars", "props": {"items": [{"label": TONE[t].replace("the ", ""), "value": {"$fact": f"tone.speak.{t}.pct"},
                                                                                      "highlight": t == worst} for t in spoken]}}]})
    mix = sorted((f for k, f in F.items() if k.startswith("mix.")), key=lambda f: -f["value"])[:3]
    if mix:
        pairs = []
        for f in mix:
            body = f["key"].split(".", 3)[3]
            a, b = body.split(">")
            pairs.append({"from": TONE.get(a, a).replace("the ", ""), "to": TONE.get(b, b).replace("the ", ""), "count": {"$fact": f["key"]}})
        raw.append({"mood": "calm", "blocks": [{"type": "kicker", "props": {"text": "Mix-ups"}},
                                                {"type": "headline", "props": {"text": "What you give instead"}},
                                                {"type": "confusion", "props": {"pairs": pairs}}]})
    if "alphabet.known" in F:
        raw.append({"mood": "warm", "blocks": [{"type": "kicker", "props": {"text": "The alphabet"}},
                                                {"type": "headline", "props": {"text": "Your eyes are next." if gate else "Your symbols"}},
                                                {"type": "symbol_grid", "props": {"highlight": ctx["alphabet"]["next"]}},
                                                {"type": "text", "props": {"text": "You know {alphabet.known} of {alphabet.total}. Repetition first, tests later."}}]})
    raw.append({"mood": "win", "blocks": [{"type": "kicker", "props": {"text": "Today"}},
                                           {"type": "headline", "props": {"text": "Small steps, in the right order."}},
                                           {"type": "steps", "props": {}},
                                           {"type": "cta", "props": {"label": "Start the first step", "action": "start"}}]})
    return [c for c in (clean_card(x, F, strict=False)[0] for x in raw) if c]


# ---------- the model calls ----------

STORY_COMMON = """You write for the coach of Zhuyin Studio, a private app for one adult who learns Taiwan Mandarin and Bopomofo (Zhuyin).
The learner reads your words on animated cards, like Spotify Wrapped, or as the headline of today's plan.
Voice: warm, playful, kind, reassuring. Short sentences (at most 12 words). Plain everyday words. Speak to the learner ("you").
A light joke or a playful image is welcome; never mock, never scold. No jargon, no JSON field names, no internal names.
Facts only come from the facts you get. A skill with fewer than 5 answers is unknown, not weak or strong.
A tone quiz (by ear) needs no Bopomofo: it never shows that the learner knows the symbols.
Return JSON only."""

HEADLINE = """Task: write the headline at the top of today's plan. At most 2 short sentences, at most 220 characters.
Sentence 1: the biggest gap, told with a light, kind joke or image. Sentence 2: what this plan does about it, reassuring.
No numbers, no percentages, no stats, no digits (tone names such as "tone 2" are fine). Do not list skills.
For the tone only (do not copy it): "Your ears already speak fluent tone; your eyes are still being introduced to the alphabet. Today we make the
introductions, six symbols at a time."
If "problems" is given, your last headline failed these checks: fix them.
Return {"headline":"..."}"""

HEADLINE_ALPHABET = """
The learner does not know the Bopomofo alphabet yet (alphabet_rule_active is true): the headline must be about the symbols or the alphabet,
twisted with a kind joke. Never write it flat, like "you don't know the alphabet"."""

OUTLINE = """Task: plan the cards of the learner's story "How do we know?". It shows, with the learner's real stats, where they are and why
today's plan looks like this.
Give 5 to 9 cards in order. A good arc: your practice so far; what is strong; the main gaps; the evidence (mix-ups: what you give instead of
what); the alphabet; what this plan does; your milestones; a last card that sends the learner to the first step.
Skip a topic when its facts are missing or thin. One idea per card. Use only fact keys from the facts list.
The main gaps must have their own card, and it names the gap that today's plan works on. Celebrate strengths, but do not hide the gaps.
Each card: "topic" (one sentence: what the card says), "facts" (the fact keys it needs), "visual" (block types from the catalog),
"mood" (warm | calm | bright | deep | win).
Catalog:
CATALOG
Return {"cards":[{"id":"c1","topic":"...","facts":["..."],"visual":["bars"],"mood":"warm"}]}"""

CARD = """Task: write ONE card of the learner's story as blocks from the catalog. You get the outline of the whole story and the card to write.
Rules:
- 1 to 4 blocks, at most 2 blocks marked [chart]. Start with a kicker or a headline. Each text says one thing, briefly.
- Numbers: never type a digit. In props a number is {"$fact":"key"}. In text put {key} where the number goes; the app replaces it with the
  bare number, and with % for percentages: "{tone.listen.4.pct} right" becomes "79% right", "{practice.minutes.7d} minutes" becomes
  "36 minutes". Write the unit yourself, once. Tone names such as "tone 4" are fine. The text must read well with the numbers filled in.
- Use only keys from "facts". Labels in bars, versus, and confusion are short names ("tone 2", "ear", "mouth", "ㄓ"), without numbers.
- In bars, highlight the item the card is about: on a gaps card, the weakest item that today's plan works on.
- Say each thing once in the whole story: do not repeat what another card of the outline covers.
- The last card is a short, warm send-off: a headline, at most one short text without numbers, and a "cta" block
  ({"label":"Start the first step","action":"start"}). Other cards have no cta.
Catalog:
CATALOG
If "problems" is given, your last card failed these checks: fix them.
Return {"card":{"mood":"warm","blocks":[{"type":"...","props":{}}]}}"""


def _fact_lines(facts: dict) -> list[str]:
    out = []
    for f in facts.values():
        if f.get("series"):
            out.append(f"{f['key']}: {f['label']} (series of {len(f['values'])} values)")
        else:
            note = " [needs the alphabet]" if f.get("needs_alphabet") else ""
            out.append(f"{f['key']}: {f['label']} = {fmt(f)}{note}")
    return out


async def _model_story(ask, facts: dict, ctx: dict, gate: bool, brief: dict) -> tuple[str | None, list[dict], list[str]]:
    lines = _fact_lines(facts)
    cat = catalog_text()
    errors: list[str] = []

    async def headline():
        payload = {"alphabet_rule_active": gate, "plan_steps": [s["title"] for s in ctx["steps"]], "facts": lines, **brief}
        task = HEADLINE + (HEADLINE_ALPHABET if gate else "")
        for attempt in range(2):
            r = await ask(f"headline#{attempt + 1}", task, payload)
            h, problems = check_headline(r.get("headline"), gate)
            if h:
                return h
            payload = {**payload, "your_last_headline": r.get("headline"), "problems": problems}
        return None

    async def outline():
        r = await ask("story:outline", OUTLINE.replace("CATALOG", cat), {"facts": lines, "plan_steps": ctx["steps"], "alphabet_rule_active": gate, **brief})
        cards = [c for c in r.get("cards") or [] if isinstance(c, dict)][:MAX_CARDS]
        if len(cards) < 3:
            raise ValueError("the outline had fewer than 3 cards")
        return cards

    async def card(i, oc, outline_cards):
        payload = {"card": oc, "position": f"card {i + 1} of {len(outline_cards)}", "is_last": i == len(outline_cards) - 1,
                   "outline": [c.get("topic") for c in outline_cards], "facts": lines, "plan_steps": ctx["steps"],
                   "alphabet": ctx["alphabet"] if gate else None}
        last = None
        for attempt in range(2):
            r = await ask(f"story:card{i + 1}#{attempt + 1}", CARD.replace("CATALOG", cat), payload)
            last = r.get("card") if isinstance(r.get("card"), dict) else r
            c, problems = clean_card(last, facts, strict=True)
            if c:
                c["mood"] = c["mood"] if last.get("mood") in MOODS else (oc.get("mood") if oc.get("mood") in MOODS else c["mood"])
                return c
            payload = {**payload, "your_last_card": last, "problems": problems}
        c, problems = clean_card(last, facts, strict=False)
        errors.extend(f"card {i + 1}: {p}" for p in problems[:3])
        return c

    h_task = asyncio.ensure_future(headline())
    try:
        oc = await outline()
        cards = list(await asyncio.gather(*(card(i, c, oc) for i, c in enumerate(oc))))
    except Exception as e:  # noqa: BLE001
        errors.append(f"story: {type(e).__name__}: {e}"[:300])
        cards = []
    try:
        h = await h_task
    except Exception as e:  # noqa: BLE001
        errors.append(f"headline: {type(e).__name__}: {e}"[:300])
        h = None
    return h, [c for c in cards if c], errors


def make(d: dict, steps: list[dict], milestones: list[dict], pace: dict | None, findings: list[dict], ask=None) -> dict:
    """The headline and the story for one plan. ask(stage, task, payload) -> dict is one model call (async); None = no model."""
    facts = story_facts(d, steps, milestones, pace)
    ctx = story_context(d, steps)
    gate = bool(((d.get("overview") or {}).get("alphabet") or {}).get("rule_active"))
    fallback = rules_cards(facts, ctx, gate)
    headline, cards, errors, source = None, [], [], "rules"
    if ask:
        brief = {"top_findings": [f.get("problem") for f in findings[:6]], "pace_notes": (pace or {}).get("notes")}
        try:
            headline, cards, errors = asyncio.run(_model_story(ask, facts, ctx, gate, brief))
        except Exception as e:  # noqa: BLE001
            errors.append(f"{type(e).__name__}: {e}"[:300])
        if len(cards) >= 3:
            source = "llm"
    spec = {"v": 1, "source": source, "cards": finish(cards if source == "llm" else fallback, fallback), "context": ctx}
    return {"headline": headline or template_headline(gate), "headline_source": "llm" if headline else "rules", "story": spec, "errors": errors}


def write(pid: int, run: str | None = None, live: bool | None = None) -> dict:
    """Build and save the headline and story of a saved plan, from its saved digest, steps, and milestones."""
    import uuid
    plan = coach._plan_row(pid)
    if not plan:
        raise ValueError(f"no plan {pid}")
    d = json.loads(plan["digest"] or "{}")
    if not d.get("story"):  # plans saved before the story existed: these numbers are read now
        d["story"] = coach.story_stats_now()
    raw = json.loads(plan["raw"] or "{}")
    steps = coach._steps(pid)
    ms = coach.state_milestones()
    run = run or uuid.uuid4().hex[:12]
    use_model = coach.LIVE if live is None else live

    async def ask(stage, task, payload):
        return await coach.call(stage, task, payload, run, plan_id=pid, common=STORY_COMMON)

    out = make(d, steps, ms, raw.get("pace"), raw.get("findings") or [], ask if use_model else None)
    with db.conn() as c:
        c.execute("UPDATE plans SET headline=?, story=? WHERE id=?", (out["headline"], json.dumps(out["story"], ensure_ascii=False), pid))
        c.execute("UPDATE coach_calls SET plan_id=? WHERE run=?", (pid, run))
    return out


def get(pid: int) -> dict | None:
    plan = coach._plan_row(pid)
    if not plan or not plan.get("story"):
        return None
    spec = json.loads(plan["story"])
    return {**spec, "plan_id": pid, "headline": plan.get("headline")}

