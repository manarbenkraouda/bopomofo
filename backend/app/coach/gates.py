"""The two rules of the app that come before any model decision.

1. The alphabet gate: below ALPHABET_GATE known symbols, every plan starts with the next symbols to learn,
   and drills that show Bopomofo wait.
2. The tone rule gate: while a tone rule (3-3, 不, 一) is not known, every plan starts with rule steps,
   and the sentence steps wait."""

from __future__ import annotations

from collections import Counter

from .. import levels, placement
from ..zhuyin import RULES
from . import settings, store
from .settings import ALPHABET_STEPS, LEARN_REPS, MAX_LEARNING, NEEDS_ALPHABET, RULE_STEPS_BLOCK, SYMS


def _known_dir(v: list[bool]) -> bool:
    """Known in one direction: at least 2 answers, the last 2 right, and 80% of the last 5."""
    last = v[-5:]
    return len(v) >= 2 and v[-1] and v[-2] and sum(last) >= 0.8 * len(last)


def alphabet_status() -> dict:
    """Per symbol, from first-try answers without help: say it (reading), type its pinyin (recognize), write it (dictation, writing),
    pick it (listening). known = said, typed, or written right reliably; learning = seen but not known yet; new = never practiced.
    A symbol typed right in a passed placement test is known too, until its last 2 answers in one direction are wrong.
    reps = right answers in reading, recognize, and dictation, with or without help. Answers in learn mode (the answer is shown on purpose)
    are repetitions only: they are not tests, so they do not count for or against "known"."""
    rows = store.query(
        "SELECT u.area, u.kind, u.expected, u.ok, u.help, u.try_n, (e.details::jsonb -> 'learn') AS learn"
        " FROM practice_units u JOIN events e ON e.id = u.event_id WHERE u.ok IS NOT NULL AND ((u.kind='symbol'"
        " AND u.area IN ('reading','recognize','dictation','writing')) OR (u.kind IN ('initial','final') AND u.area='listening'))"
        " ORDER BY u.ts, u.id"
    )
    per = {s: {"say": [], "type": [], "write": [], "pick": []} for s in SYMS}
    direction = {"reading": "say", "recognize": "type"}
    reps: Counter = Counter()
    for r in rows:
        if r["kind"] == "symbol" and r["area"] in ("reading", "recognize", "dictation") and r["ok"]:
            reps[r["expected"]] += 1
        if r["learn"] or r["try_n"]:
            continue
        good = bool(r["ok"]) and not r["help"]
        if r["kind"] == "symbol":
            if r["expected"] in per:
                per[r["expected"]][direction.get(r["area"], "write")].append(good)
        else:
            for ch in r["expected"]:
                if ch in per:
                    per[ch]["pick"].append(good)
    symbols, known, learning, new = [], [], [], []
    placed = set(placement.known_symbols())
    for s in SYMS:
        d = per[s]
        n = sum(len(v) for v in d.values())
        lost = any(len(v) >= 2 and not v[-1] and not v[-2] for v in d.values())
        state = (
            "known"
            if _known_dir(d["say"]) or _known_dir(d["type"]) or _known_dir(d["write"]) or (s in placed and not lost)
            else "learning"
            if n or reps[s]
            else "new"
        )
        right = sum(sum(v) for v in d.values())
        symbols.append(
            {
                "sym": s,
                "state": state,
                "answers": n,
                "right": right,
                "reps": reps[s],
                "phase": "known" if state == "known" else "recall" if reps[s] >= LEARN_REPS else "repeat",
                **{k: f"{sum(v[-5:])}/{len(v[-5:])}" for k, v in d.items() if v},
            }
        )
        {"known": known, "learning": learning, "new": new}[state].append(s)
    # The next symbols to learn: the weakest symbols already seen, then new ones in the standard order. At most 4 new at once,
    # and none while MAX_LEARNING symbols are still being learned: half-learned symbols come first.
    seen = sorted(
        (x for x in symbols if x["state"] == "learning"),
        key=lambda x: (x["right"] / max(1, x["answers"]), -x["answers"]),
    )
    group = [x["sym"] for x in seen[:3]]
    # New symbols come from the open chapters of the level path only (initials, then medials, then finals).
    open_syms = levels.opened()["symbols"]
    fresh = sorted((s for s in new if s in open_syms), key=open_syms.index)
    group += fresh[: min(4, 6 - len(group))] if len(learning) < MAX_LEARNING else []
    if len(group) < 6:
        group += [x["sym"] for x in seen[3:]][: 6 - len(group)]
    return {
        "known_count": len(known),
        "known": "".join(known),
        "learning": "".join(learning),
        "new": "".join(new),
        "next_group": group,
        "gate": len(known) < settings.ALPHABET_GATE,
        "symbols": symbols,
        "learn_reps": LEARN_REPS,
    }


def alphabet_gate(steps: list[dict], st: dict, op: dict | None = None) -> tuple[list[dict], list[str]]:
    """Below ALPHABET_GATE known symbols: the plan starts with the next symbols, and drills that show Bopomofo are removed.
    Symbols with fewer than LEARN_REPS right repetitions get repetition steps (the answer is shown, every right answer counts);
    the others get recall steps (say and write from memory). Before the level that opens dictation, recall is said and typed,
    and there is no copy step. Returns the steps and the titles of the removed steps."""
    if not st["gate"] or not st["next_group"]:
        return steps, []
    op = op or levels.opened()
    can_write = levels.is_open("dictation", op)
    g = st["next_group"]
    info = {x["sym"]: x for x in st["symbols"]}
    repeat = [s for s in g if info[s]["reps"] < LEARN_REPS]
    recall = [s for s in g if s not in repeat]
    meta = {"finding_ids": [], "review": "Added by the alphabet rule: the 37 symbols come first.", "rule": "alphabet"}
    first: list[dict] = []
    if recall:
        first.append(
            {
                "type": "read_symbols",
                "title": "Say from memory: " + " ".join(recall),
                "params": {"syms": recall},
                "minutes": 5,
                "meta": dict(meta),
                "why": "You have repeated these enough. Now say them from memory, and press Space only when you are stuck.",
                "target": max(6, 2 * len(recall)),
            }
        )
        first.append(
            {
                "type": "write_symbols",
                "title": "Hear and write from memory: " + " ".join(recall),
                "params": {"syms": recall},
                "minutes": 5,
                "meta": dict(meta),
                "why": "Now write them from their sound, so you know them both ways.",
                "target": max(6, len(recall)),
            }
            if can_write
            else {
                "type": "recognize_symbols",
                "title": "Type from memory: " + " ".join(recall),
                "params": {"syms": recall},
                "minutes": 4,
                "meta": dict(meta),
                "why": "Type the sound of each symbol, quickly: knowing a symbol means you answer without thinking.",
                "target": max(6, 2 * len(recall)),
            }
        )
    if repeat:
        left = sum(LEARN_REPS - info[s]["reps"] for s in repeat)
        first.append(
            {
                "type": "read_symbols",
                "title": "Listen and repeat: " + " ".join(repeat),
                "params": {"syms": repeat, "learn": True},
                "minutes": max(4, round(left / 6)),
                "meta": dict(meta),
                "target": max(len(repeat), left),
                "why": "Hear each symbol and say it back. Every right repetition counts, and the symbols come before every other drill.",
            }
        )
        if can_write:
            first.append(
                {
                    "type": "write_symbols",
                    "title": "Copy and write: " + " ".join(repeat),
                    "params": {"syms": repeat, "learn": True},
                    "minutes": max(3, len(repeat)),
                    "meta": dict(meta),
                    "target": 3 * len(repeat),
                    "why": "Watch the strokes and copy each symbol to learn its shape.",
                }
            )
    kept = [s for s in steps if s["type"] not in NEEDS_ALPHABET | ALPHABET_STEPS]
    removed = [s["title"] for s in steps if s not in kept]
    return (first + kept)[:7], removed


def alphabet_sentence(st: dict) -> str:
    """The first sentence of the diagnosis while the alphabet rule is active. The app writes it, so it always matches the steps."""
    info = {x["sym"]: x for x in st["symbols"]}
    repeat = [s for s in st["next_group"] if info[s]["reps"] < LEARN_REPS]
    recall = [s for s in st["next_group"] if s not in repeat]
    parts = ([f"say and write {' '.join(recall)} from memory"] if recall else []) + (
        [
            f"repeat {' '.join(repeat)} after the voice and copy them ({LEARN_REPS} right repetitions each before any test from memory)"
        ]
        if repeat
        else []
    )
    return (
        f"Alphabet first: you know {st['known_count']} of the 37 Bopomofo symbols, so this plan starts with them: "
        + ", then ".join(parts)
        + "."
    )


def needs_alphabet(c: dict) -> bool:
    """A milestone that tests the Bopomofo symbols. While the alphabet rule is active, the alphabet milestone replaces these."""
    return c["unit"] not in ("alphabet", "level") and (
        c["unit"] == "symbol"
        or c["area"] in ("reading", "recognize", "dictation", "writing")
        or (c["area"] == "listening" and c["unit"] in ("initial", "final"))
    )


def rules_status(lv: dict | None = None) -> dict:
    """Which tone rules are known (★★★ in the rule quiz or in the rule phrases), from the level stars.
    gate: the rule exercises are open and a rule is not known yet."""
    lv = lv or levels.status()
    stars = lv.get("stars") or {}
    per = {}
    for rid in RULES:
        q = (stars.get("listening/rule") or {}).get("rule:" + rid) or {}
        s = (stars.get("speaking/rule") or {}).get("rule:" + rid) or {}
        per[rid] = {
            "quiz_stars": q.get("stars", 0),
            "quiz_tests": q.get("tests", 0),
            "quiz_acc": q.get("acc"),
            "quiz_reps": q.get("reps", 0),
            "speak_stars": s.get("stars", 0),
            "speak_tests": s.get("tests", 0),
            "speak_acc": s.get("acc"),
            "known": max(q.get("stars", 0), s.get("stars", 0)) >= 3,
        }
    open_ = levels.is_open("listening/rule", {"exercises": lv["exercises"]})
    missing = [r for r, v in per.items() if not v["known"]]
    return {
        "open": open_,
        "known": [r for r in per if per[r]["known"]],
        "missing": missing,
        "per_rule": per,
        "gate": settings.RULES_GATE and open_ and bool(missing),
    }


def _rule_names(ids: list[str]) -> str:
    """The names of the tone rules with these ids, for the plan notes."""
    return ", ".join(RULES[r]["name"] for r in ids)


def rules_gate(steps: list[dict], rs: dict, op: dict | None = None) -> tuple[list[dict], list[str]]:
    """While a tone rule is not known: the plan starts with rule steps, and the sentence steps wait. New rules start in learn
    mode (the rule and the answer are shown first), then a quiz from memory, then the phrases said aloud once the quiz is accurate.
    Returns the steps and the titles of the removed steps."""
    if not rs["gate"]:
        return steps, []
    op = op or levels.opened()
    miss = rs["missing"]
    per = rs["per_rule"]
    meta = {
        "finding_ids": [],
        "review": "Added by the tone rule: the tone changes come before sentences.",
        "rule": "tone_rules",
    }
    first: list[dict] = []
    new = [r for r in miss if per[r]["quiz_reps"] < 6 and per[r]["quiz_tests"] < 3]
    if new:
        first.append(
            {
                "type": "tone_rules",
                "title": "Learn the tone rules: " + _rule_names(new),
                "params": {"rules": new, "mode": "quiz", "learn": True},
                "minutes": 4,
                "meta": dict(meta),
                "target": 4 * len(new),
                "why": "The Bopomofo shows the dictionary tone, but some tones change in words. Learn when and how, before sentences.",
            }
        )
    first.append(
        {
            "type": "tone_rules",
            "title": "Tone rules from memory: " + _rule_names(miss),
            "params": {"rules": miss, "mode": "quiz"},
            "minutes": 5,
            "meta": dict(meta),
            "target": max(10, 4 * len(miss)),
            "why": "Pick the tone you say, not the tone you see. Knowing this keeps you from reading 我很好 tone by tone.",
        }
    )
    speak = [r for r in miss if per[r]["quiz_stars"] >= 2]
    if speak and levels.step_allowed("tone_rules", {"mode": "speak"}, op):
        first.append(
            {
                "type": "tone_rules",
                "title": "Say the tone rules: " + _rule_names(speak),
                "params": {"rules": speak, "mode": "speak"},
                "minutes": 5,
                "meta": dict(meta),
                "target": max(8, 3 * len(speak)),
                "why": "You know the rule. Now say short words with it, until it comes without thinking.",
            }
        )
    kept = [
        s
        for s in steps
        if s["type"] not in RULE_STEPS_BLOCK
        and not (s["type"] == "speak_sounds" and s["params"].get("source") in ("sentence", "word"))
        and not (s["type"] == "tone_rules" and (s.get("meta") or {}).get("rule") != "tone_rules")
    ]
    removed = [s["title"] for s in steps if s not in kept]
    return first + kept, removed


def rules_sentence(rs: dict) -> str:
    """The sentence of the diagnosis while the tone rule gate is active. The app writes it, so it always matches the steps."""
    return (
        f"Tone rules first: some tones change in words ({_rule_names(rs['missing'])}), and the Bopomofo does not show it."
        " Sentences wait until you know these rules."
    )
