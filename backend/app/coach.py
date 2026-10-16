"""Coach: a pipeline of many small model decisions turns the practice stats into the next plan.

How a plan is built (every call is logged in coach_calls, with its model, time, and cost):
1. Analysts, in parallel: one call per domain (listening tones, speaking tones, sounds, symbols, sentences) finds the gaps,
   with the numbers as evidence. One more call sets the size of the plan from the pace and the previous plans.
2. Planner: turns the findings into 3-7 steps. A step is one practice mode with an exact focus and a target.
3. Details, one call per step: a writer makes new sentences for the exact tones, tone pairs, or sounds (the Bopomofo analyzer
   checks each sentence; rejected ones go back to the writer with the reason), and a picker chooses the exact syllables of a deck.
4. Reviewer and milestones, in parallel: keep, drop, or change each step; set 3-5 long goals.
During practice:
- Answers given inside a step carry the step id. Only those count for the step.
- Every CHECK_EVERY answers in a step, a checkpoint call reads them and continues, extends, narrows, eases, or ends the step.
- When a step ends, a debrief call compares it with the 30 days before the plan. The notes feed the next plan.
- A plan ends by practice, never by date. When one step is left, the next plan is built in the background, so it is ready at once.
If the model fails, a plan is built by rules from the weak spots.
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import re
import threading
import time
import traceback
import uuid
from collections import Counter, defaultdict
from datetime import timedelta
from functools import lru_cache
from urllib.parse import quote

from . import db, deep_check, levels, limits, llm, placement, stats, typed_fix
from .config import COACH_MODEL, OPENROUTER_MODEL, ROOT
from .zhuyin import RULES, analyze_text

SYMS = "ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ"
BOPOMOFO = set(SYMS)
MARKS = {1: "", 2: "ˊ", 3: "ˇ", 4: "ˋ", 5: "˙"}
PLAN_MINUTES = 25
STALE_UNITS = 400  # after this many new answers, the plan may no longer match the stats
CHECK_EVERY = 10  # answers in a step between two checkpoint calls
MAX_SENTENCES = 6
TYPES = {
    "speak_sentences": "speaking",
    "speak_sounds": "speaking",
    "listen_tones": "listening",
    "listen_sounds": "listening",
    "read_symbols": "reading",
    "recognize_symbols": "recognize",
    "write_symbols": "dictation",
    "write_syllables": "writing",
    "tone_rules": "listening",
}
DECK_TYPES = {"listen_tones", "listen_sounds", "speak_sounds", "write_syllables"}
DEFAULT_TARGET = {
    "speak_sounds": 10,
    "listen_tones": 20,
    "listen_sounds": 15,
    "read_symbols": 10,
    "recognize_symbols": 15,
    "write_symbols": 10,
    "write_syllables": 10,
    "tone_rules": 12,
}
SYMBOL_TYPES = {"read_symbols", "recognize_symbols", "write_symbols"}  # one symbol per answer, focus = single symbols
SYLLABLES_FILE = ROOT.parent / "frontend" / "public" / "data" / "syllables.json"
LIVE = True  # False in tests: no background threads and no model calls

# What each practice mode measures. The analysts get this with the numbers, so a tone quiz is never read as symbol knowledge.
MEASURES = {
    "reading": ("see a Bopomofo symbol and say its name (alphabet: symbol to sound)", True),
    "recognize": (
        "see a Bopomofo symbol and type its sound in pinyin, silently (alphabet: symbol to sound, no speaking)",
        True,
    ),
    "listening/tone": ("hear a syllable and name its tone; no Bopomofo needed", False),
    "listening/zhuyin": ("hear a syllable and pick its Bopomofo spelling; needs the alphabet", True),
    "listening/rule": (
        "see a short word in Bopomofo and pick the tone that is said for one syllable after the tone rules (3-3, 不, 一);"
        " measures rule knowledge, not hearing; needs the alphabet",
        True,
    ),
    "dictation": ("hear a symbol name and write the symbol by hand (alphabet: sound to symbol)", True),
    "writing": ("hear a syllable or word and write its Bopomofo by hand, with the tone mark; needs the alphabet", True),
    "speaking": (
        "say a sentence or syllable; the speech model checks each initial, final, and tone; no Bopomofo needed",
        False,
    ),
}
# The alphabet comes first: below this many known symbols, every plan starts with the next symbols to learn,
# and drills that show Bopomofo wait. This is a rule of the app, not a model decision.
ALPHABET_GATE = 30
RULES_GATE = True  # the tone rules (3-3, 不, 一) must be known before sentence steps
NEEDS_ALPHABET = {"listen_sounds", "write_syllables"}
ALPHABET_STEPS = {"read_symbols", "recognize_symbols", "write_symbols"}
# Coach notes the learner sees: checkpoint notes and the learner line of a debrief. The rest ("debrief", "skip") is for the next plan.
VISIBLE_NOTES = "(kind LIKE 'checkpoint:%' OR kind='debrief:learner')"
# A new symbol is learned by repetition first: the app plays it and shows its name or strokes, and the learner repeats it.
# Recall tests (name it from memory) start only after this many right repetitions of the symbol.
LEARN_REPS = 10
MAX_LEARNING = 8  # no new symbols while this many symbols are seen but not known yet
# The tone rules (3-3, 不, 一) come before sentences: the written Bopomofo shows the dictionary tone, not the tone said.
# While a rule is not known (levels: ★★★ in the rule quiz or the rule phrases), every plan starts with rule steps and has no
# sentence steps. This is a rule of the app, not a model decision.
RULE_STEPS_BLOCK = {"speak_sentences"}

_refresh_lock = threading.RLock()
_checking: set[int] = set()

# What the coach builds in the background, per user, is in the coach_jobs table, so every API process sees it: during a
# deploy the old process finishes the job while the new one answers the app. A running job writes a beat every
# JOB_BEAT seconds; without a beat for JOB_STALE seconds it died with its process, and a new job may start.
JOB_BEAT = 20
JOB_STALE = 90
JOB_LOST = "Bobo stopped before finishing the plan. Ask again for a new plan."
_IDLE = {"running": False, "stage": "", "error": None, "started": 0.0, "next": False, "story": None}


def _job() -> dict:
    """The background job of the current user, as any API process sees it."""
    if not db.current_user():
        return dict(_IDLE)
    with db.conn() as c:
        r = c.execute("SELECT running, stage, error, started, next, story, beat FROM coach_jobs").fetchone()
    if not r:
        return dict(_IDLE)
    j = {k: r[k] for k in _IDLE}
    if j["running"] and r["beat"] < time.time() - JOB_STALE:
        j.update(running=False, stage="", story=None, error=JOB_LOST)
    return j


def _claim(stage: str, as_next: bool = False, story: int | None = None) -> bool:
    """Mark a job as running for the current user. False when one already runs, in this process or another."""
    now = time.time()
    with db.conn() as c:
        r = c.execute(
            "INSERT INTO coach_jobs(running, stage, error, started, next, story, beat) VALUES (true, ?, NULL, ?, ? = 1, ?, ?) "
            "ON CONFLICT (user_id) DO UPDATE SET running=true, stage=excluded.stage, error=NULL, started=excluded.started, "
            "next=excluded.next, story=excluded.story, beat=excluded.beat "
            "WHERE NOT coach_jobs.running OR coach_jobs.beat < ? RETURNING user_id",
            (stage, now, int(as_next), story, now, now - JOB_STALE),
        ).fetchone()
    return r is not None


def _run_job(fn) -> None:
    """Run a claimed job in the background with a beat, then mark it finished, with its error if it failed."""

    def run():
        stop = threading.Event()

        def beat():
            while not stop.wait(JOB_BEAT):
                try:
                    with db.conn() as c:
                        c.execute("UPDATE coach_jobs SET beat=? WHERE running", (time.time(),))
                except Exception:  # noqa: BLE001
                    traceback.print_exc()

        threading.Thread(target=contextvars.copy_context().run, args=(beat,), daemon=True).start()
        error = None
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            error = f"{type(e).__name__}: {e}"
        finally:
            stop.set()
            with db.conn() as c:
                c.execute(
                    "UPDATE coach_jobs SET running=false, stage='', story=NULL, error=?, beat=?", (error, time.time())
                )

    db.spawn(run)


def _q(sql: str, args=()) -> list[dict]:
    return stats._rows(sql, args)


def _stage(text: str):
    with db.conn() as c:
        c.execute("UPDATE coach_jobs SET stage=?, beat=? WHERE running", (text, time.time()))


# ---------- small validators ----------


def _tones(v, allow5=True) -> list[int]:
    out = []
    for t in v or []:
        try:
            t = int(t)
        except (TypeError, ValueError):
            continue
        if 1 <= t <= (5 if allow5 else 4) and t not in out:
            out.append(t)
    return out


def _syms(v, single=False) -> list[str]:
    out = []
    for s in v or []:
        s = str(s).strip()
        if s and all(c in BOPOMOFO for c in s) and len(s) <= (1 if single else 3) and s not in out:
            out.append(s)
    return out


def _pairs(v) -> list[str]:
    out = []
    for p in v or []:
        t = _tones(str(p).replace(" ", "").split("-"))
        if len(t) == 1 and str(p).count("-") == 1 and str(p).split("-")[0].strip() == str(p).split("-")[1].strip():
            t = t * 2  # "3-3"
        if len(t) == 2 and f"{t[0]}-{t[1]}" not in out:
            out.append(f"{t[0]}-{t[1]}")
    return out


def _int(v, lo: int, hi: int, default: int) -> int:
    try:
        return max(lo, min(hi, round(float(v))))
    except (TypeError, ValueError):
        return default


def _float(v, lo: float, hi: float, default: float) -> float:
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return default


def _text(v, n: int) -> str:
    return " ".join(str(v or "").split())[:n]


def _list(v, n: int, size: int = 200) -> list[str]:
    return [_text(x if isinstance(x, str) else json.dumps(x, ensure_ascii=False), size) for x in (v or []) if x][:n]


# ---------- syllables and their history ----------


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
    rows = _q(
        "SELECT event_id, area, kind, expected, actual, ok, ctx FROM units WHERE area IN ('listening','speaking')"
        " AND kind IN ('tone','syllable') AND try_n=0 AND ok IS NOT NULL AND day>=?",
        (since,),
    )
    has_syl = {r["event_id"] for r in rows if r["kind"] == "syllable" and r["area"] == "listening"}
    for r in rows:
        if r["kind"] == "syllable":
            z, got = r["expected"], r["actual"]
        elif r["area"] == "listening" and r["event_id"] not in has_syl and r["ctx"]:
            z = by_base.get((r["ctx"], _int(r["expected"], 0, 9, 0)))
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
    for e in _q("SELECT item, ok FROM events WHERE area='writing' AND day>=?", (since,)):
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


# ---------- the alphabet: which of the 37 symbols the learner knows ----------


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
    rows = _q(
        "SELECT u.area, u.kind, u.expected, u.ok, u.help, u.try_n, (e.details::jsonb -> 'learn') AS learn"
        " FROM units u JOIN events e ON e.id = u.event_id WHERE u.ok IS NOT NULL AND ((u.kind='symbol'"
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
        "gate": len(known) < ALPHABET_GATE,
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


# ---------- the tone rule gate (3-3, 不, 一) ----------


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
        "gate": RULES_GATE and open_ and bool(missing),
    }


def _rule_names(ids: list[str]) -> str:
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
        and not (s["type"] == "speak_sounds" and s["params"].get("source") == "sentence")
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


# ---------- the stats digest ----------


def digest(lv: dict | None = None) -> dict:
    """lv: the level status (levels.check() or levels.status()). Read here when not given."""
    lv = lv or levels.status()
    op = {"level": lv["level"], "exercises": lv["exercises"], "symbols": lv["symbols"]}
    today = db.local_today()
    d7 = (today - timedelta(days=6)).isoformat()
    d14 = (today - timedelta(days=13)).isoformat()
    d45 = (today - timedelta(days=44)).isoformat()
    units = _q(
        "SELECT u.event_id, u.day, u.area, u.kind, u.expected, u.actual, u.ok, u.pos, u.try_n, u.help, u.ctx, u.lex, u.prev, u.next, e.legacy"
        " FROM units u JOIN events e ON e.id = u.event_id WHERE u.day>=?",
        (d45,),
    )
    events = _q(
        "SELECT id, ts, day, area, mode, item, ok, help, score, legacy FROM events WHERE day>=? ORDER BY ts", (d45,)
    )
    saved = {r["day"]: r["seconds"] for r in _q("SELECT day, seconds FROM days")}
    secs = stats._seconds_by_day(_q("SELECT ts, day FROM events ORDER BY ts"), saved)
    minutes_7d = round(sum(s for d, s in secs.items() if d >= d7) / 60)
    answers_7d = sum(1 for e in events if e["day"] >= d7)

    # One row per practice mode, with what it measures: a tone quiz says nothing about knowing the symbols.
    modes = []
    for key in sorted({(e["area"], e["mode"] if e["area"] in ("listening",) else None) for e in events}, key=str):
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
    from . import story

    story_numbers = story.story_stats(units, events, secs, today)
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

    lib = _q("SELECT id, hanzi, english, level, topic FROM sentences ORDER BY id DESC LIMIT 300")
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
    for p in _q(
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
                        "focus": _focus_of(s),
                        "target": s["target"],
                        "status": s["status"],
                        "progress": step_progress(s)["progress"],
                        "skip_reason": s["skip_reason"],
                        "minutes_to_finish": round((s["done_ts"] - p["ts"]) / 60)
                        if s["done_ts"] and s["status"] == "done"
                        else None,
                    }
                    for s in _steps(p["id"])
                ],
            }
        )
    notes = [
        {"kind": n["kind"], "text": n["text"], "day": db.day_of(n["ts"])}
        for n in _q("SELECT kind, text, ts FROM coach_notes ORDER BY id DESC LIMIT 10")
    ]
    ms = [
        {
            "id": m["id"],
            "title": m["title"],
            "criterion": json.loads(m["criterion"]),
            "now": milestone_progress(json.loads(m["criterion"]), lv),
        }
        for m in _q("SELECT * FROM milestones WHERE status='active' ORDER BY id")
    ]
    detail = _q("SELECT MIN(day) AS since, COUNT(*) AS n FROM events WHERE legacy=0")[0]

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


# ---------- model calls ----------

COMMON = """You are part of the coach inside bopomofo, a private app for one adult who learns Taiwan Mandarin and Bopomofo (Zhuyin).
The learner knows the coach as Bobo (波波), a cute Formosan black bear. When learner text names the coach, call it Bobo.
The app saves every answer down to each tone, initial, final, symbol, and stroke, with what the learner produced instead.
The coach is a pipeline of small decisions. You make one of them. Rules for every decision:
- Data first. Base every claim on the numbers you get, and quote them (counts, percentages, what was produced instead, the context).
- Few answers mean low confidence. Do not call a skill weak or mastered on fewer than 5 answers: call it unknown.
- Foundations before advanced material: symbols and single tones before tone pairs, tone pairs before long sentences.
- Practice ends by a count of right answers, never by a date.
- The Bopomofo alphabet (37 symbols) is the foundation. "overview.alphabet" says which symbols the learner knows: a symbol is known
  only when it was said or written right without help, reliably. Never say the learner knows, reads, or hears the symbols unless
  "known_symbols" shows it. Tones can be trained by ear and by speaking without the alphabet.
- "overview.placement" (when present) is the one placement test the learner took after the onboarding: the level it gave, the
  alphabet score, and for the syllables and the sentences the symbols and tones said right and the symbols missed. Its answers
  are also in the stats. It is one test, so trust newer answers more.
- Each row of "overview.modes" says what that mode measures. Draw a conclusion only from a mode that measures it: the tone quiz
  ("listening/tone") measures tones by ear, not symbols. "answer_shown_pct" is how often the learner asked for the answer.
- "Surface tone" is the tone after tone changes (3-3 is said 2-3; 不 and 一 change). Tone 5 is the neutral tone.
- The app logs every answer in detail. Old answers, from before "detailed_log_since", only say right or wrong: no "produced instead",
  no context. Empty confusion data means there are few detailed answers yet, never that logging is off. Do not ask the learner to
  change any setting. More practice in that area fills the data: a diagnostic step is the right answer to missing data.
- Text the learner reads in the app (a step "title" and "why", a milestone "title" and "why", a "note" or "learner" line) is for a
  learner, not for a coach: one short, friendly sentence in plain words, at most one number. Say what the practice trains and why
  it helps now. Never mention data, logs, detailed or old answers, "missing data", findings, analysts, the planner, the reviewer,
  the model, the app, the plan's process, or JSON field names. The diagnosis, findings, and other fields are internal: there,
  write for the coach and quote the numbers.
- "mic_pairs" lists sound pairs (expected, heard) where the learner typed the sound they said in Pinyin and it was the expected
  sound: the speech model heard the wrong sound (a blocked nose makes p sound like b). "confirmed": true means 5 or more such
  checks; the old misses of that pair already count as right. Do not call these pairs weak, and do not plan contrast drills for them.
- "deep_fixes" lists sound and tone pairs (kind, expected, heard) where a second, closer check of the recording found the
  expected sound or tone 3 or more times after the first check heard the other one: the microphone misses, not the learner.
  Those answers already count as right. Do not plan drills for these pairs because of microphone misses.
- Write short, plain English. Return one JSON object only."""

DOMAINS = {
    "tones_listening": "tones in listening (the tone quiz and the Bopomofo quiz): which tone is taken for which, and on which syllables",
    "tones_speaking": "tones in speaking: which tone the learner says instead, and in which context (tone before and after, tone changes, position)",
    "sounds": "initials and finals in listening and speaking: which sounds are mixed up, in which direction",
    "tone_rules": "the tone rules (3-3: tone 3 before tone 3 is said tone 2; 不 before tone 4 is said tone 2; 一 is tone 2 before tone 4 and tone 4 before tones 1-3), in the rule quiz and in every recording: which rule fails, the kind of error (literal = the learner read the written tone; over = changed 不/一 where it stays), and on which characters",
    "symbols": "the 37 Bopomofo symbols and the tone marks in reading (saying them), recognize (typing their pinyin silently; recognize_mixups says which symbol the typed pinyin stands for), dictation and writing (writing them by hand): recall, symbols taken for others, stroke order, stroke problems, symbols never practiced",
    "sentences": "recorded sentences: which sentences score low, which syllables fail in them, and which material fits the level",
}

ANALYZE = """Task: analyze one domain of the stats: DOMAIN.
Find the gaps that block progress most. Use "produced_instead", the expected-to-produced tables, and the contexts to say exactly what goes wrong.
Each finding: {"id":"short-key","area":"reading|recognize|listening|dictation|writing|speaking","items":["exact values from the data: tones as strings, Bopomofo, syllables, or sentence ids"],
"problem":"what goes wrong, with the numbers","context":"when it happens, or empty","severity":1-5,"confidence":1-5,"drill":"the exercise that fixes it, one sentence"}
Also give "strengths" (facts with numbers: things to stop drilling), "unknown" (things barely or never practiced that matter at this level),
and "too_advanced" (things to postpone, with the reason).
At most 8 findings, the most important first. With no data in this domain, return empty lists and say so in "unknown".
Return {"findings":[...],"strengths":[...],"unknown":[...],"too_advanced":[...]}"""

PACE = """Task: decide the size of the next plan from the learner's pace and the previous plans.
You get the minutes per day for 14 days, answers per minute, the previous plans (steps, targets, progress, time to finish, skip reasons),
the recent coach notes, and the reason for this plan.
- target_scale multiplies the default targets: above 1 when steps were finished fast or skipped as too_easy, below 1 when steps were skipped
  as too_hard or stayed open a long time.
- plan_minutes: about one usual session. A learner who practices a lot is never blocked: the next plan comes at once when one is done.
Return {"plan_minutes":10-60,"target_scale":0.5-2.0,"steps":3-7,"notes":"1-2 sentences","avoid":["what not to plan now, with the reason"]}"""

PLAN = """Task: write the next plan from the analysts' findings.
You get the reason for the plan, the overview, the pace decision, the findings (with ids, severity, confidence), strengths, unknown and
too-advanced items, the sentences you can reuse, the previous plans, and the active milestones.
Rules:
1. Each step fixes one or more findings: list their ids in "finding_ids". Take the findings with the highest severity x confidence first.
2. Train confusions as contrasts: when X is taken for Y, the step contains both X and Y.
3. Use the context: when errors cluster after a tone, before a tone, or on tone changes, the step must contain that context
   (for new sentences: put the tone pairs in "new.focus.pairs").
4. Repeating low-score sentences until they pass is a strong step. Name the syllables that fail in "why".
5. Unknown skills that matter now get a small diagnostic step (target 8-12). Do not plan too-advanced items.
6. Do not repeat a finished step of the previous plan unless its numbers are still weak. A step skipped as too_hard needs a smaller or
   easier version; too_easy needs a harder one.
7. Order: warm-up first, the hardest contrast in the middle, a short success at the end.
8. Respect the pace decision: the number of steps and the total minutes.
Step types (only these; the app measures each one from the answers given inside the step):
- speak_sentences: {"sentence_ids":[int],"texts":[str],"new":{"count":0-4,"focus":{"tones":[1-5],"pairs":["a-b"],"syms":[Bopomofo]}},"reps":1-10,"min_score":60-100}
  Record each sentence until it scores min_score or more, reps times. At most 6 sentences. Reuse ids when they exist, "texts" for weak
  sentences without an id, and "new" to have a writer make new sentences that contain the focus.
- speak_sounds: {"unit":"tone"|"initial"|"final","tones":[1-5],"syms":[Bopomofo],"source":"syllable"|"sentence","target":N}
  Done after N right syllables of that unit.
- listen_tones: {"tones":[2 to 4 tones from 1-4],"target":N}  Tone quiz. Done after N right.
- listen_sounds: {"syms":[Bopomofo initials or finals],"target":N}  "Which Bopomofo" quiz.
- read_symbols: {"syms":[single symbols],"target":N}  Say symbols out loud. N right on the first try.
- recognize_symbols: {"syms":[single symbols],"target":N}  See a symbol and type its pinyin, silently. N right on the first try.
  Use it to drill symbol recall without speaking, and to contrast symbols taken for each other (put both in "syms").
- write_symbols: {"syms":[single symbols],"target":N}  Hear a symbol and write it. N right on the first try.
- write_syllables: {"tones":[1-5],"syms":[Bopomofo],"target":N}  Hear a syllable, write it with its tone mark. N right parts.
- tone_rules: {"rules":["3-3"|"bu"|"yi"],"mode":"quiz"|"speak","target":N}  The tone rules. quiz: see a short word in Bopomofo
  (written with the dictionary tone) and pick the tone that is said. speak: say short words that use the rule. N right answers on
  the rule. Use it when "tone_rules" shows rule errors, also when they come from sentences (literal errors: the learner reads the
  written tone).
Tone 5 (neutral) only exists after another syllable: train it with speak_sounds source "sentence" or with speak_sentences, never on single syllables.
For listen_tones, listen_sounds, speak_sounds with source syllable, and write_syllables, a later stage picks the exact syllables from your
focus and the learner's history: give the focus, not the syllables.
Every step has "type", "title" (imperative, max 60 characters), "why" (one short, friendly sentence for the learner, at most one
number; see the rule for text the learner reads), "finding_ids", "minutes", and
"target" (right answers, 5-60, before the pace scale), except speak_sentences.
Return {"diagnosis":"2-4 sentences: the biggest gaps and why this plan","steps":[...]}"""

ALPHABET_RULE = """
Alphabet rule (overview.alphabet.rule_active is true): the app itself puts the alphabet steps first. New symbols are learned by heavy
repetition (the app plays each symbol and shows it; the learner repeats it), and tests from memory start only after enough repetitions.
The steps the app adds are in overview.alphabet.steps_the_app_adds_first: they are part of THIS plan and come before your steps.
Do not plan read_symbols, recognize_symbols, write_symbols, listen_sounds, or write_syllables. Plan the rest of the session with steps that need no
Bopomofo and that the level allows (listen_tones; speak_sounds and speak_sentences only when overview.level.allowed_step_types lists them).
The app writes the first sentence of the diagnosis about the alphabet steps:
your diagnosis covers your own steps only. Do not repeat the alphabet count, do not say that your steps open the session, and never
say that the alphabet waits for a later plan."""

ALPHABET_MILESTONE_RULE = """
Alphabet rule (overview.alphabet.rule_active is true): the learner does not know the Bopomofo alphabet yet and learns it by repetition.
The app has its own milestone for it ("Know the alphabet"). Do not set milestones that test the symbols: no unit "symbol", no area
reading, recognize, dictation, or writing, and no listening initial or final. Set milestones for tones and speaking only."""

TONE_RULES_RULE = """
Tone rule (overview.tone_rules.rule_active is true): the learner does not know every tone rule yet. The Bopomofo shows the
dictionary tone, so a learner who does not know the rules reads sentences with wrong tones. The app itself puts the rule steps
first (overview.tone_rules.steps_the_app_adds_first): they are part of THIS plan. Do not plan speak_sentences or speak_sounds with
source "sentence", and do not plan tone_rules steps yourself. The app writes the sentence of the diagnosis about the rules: do not repeat it."""


def level_rule(op: dict, task: str = "plan") -> str:
    """The level path is a rule of the app: the model only sees and plans the exercises the learner has unlocked."""
    open_ex = ", ".join(op["exercises"])
    if task == "milestones":
        return (
            f"\nLevel rule (overview.level): the learner is at level {op['level']} of {levels.MAX_LEVEL}. Only these exercises are open: {open_ex}."
            " Set milestones only for skills these exercises measure. The app has its own milestone for the next level."
        )
    syms = "" if op["symbols"] == levels.SYMS else f" Symbol steps use only these symbols: {' '.join(op['symbols'])}."
    return (
        f"\nLevel rule (overview.level): the learner is at level {op['level']} of {levels.MAX_LEVEL} and has unlocked only these exercises: {open_ex}."
        f" Use only these step types: {', '.join(levels.allowed_types(op))}. Any other step type is removed.{syms}"
        " A level opens when its items are known: right on the first try, fast, on more than one day."
        " overview.level.next_level lists what is still missing: steps that train those items move the learner up."
        " overview.level.dropped lists known items that slipped: the app adds a review step for them itself."
    )


SENTENCES = """Task: write new practice sentences that train an exact focus for a learner of Taiwan Mandarin.
A Bopomofo analyzer checks your sentences after you answer. Sentences that fail are rejected:
- "tones": each listed surface tone appears at least once (two or more times is better).
- "pairs": "a-b" is a syllable with surface tone a directly followed by one with surface tone b, in the same phrase (no punctuation
  between). Count the tones after tone changes: 3-3 is said 2-3; 不 before tone 4 is tone 2; 一 changes too. Exception: "3-3" asks
  for two dictionary tone 3 in a row (the learner must apply the tone change), for example 你好, 很好, 可以.
- "syms": each listed Bopomofo symbol appears in at least one syllable.
Put the focus on common words. Traditional characters, Taiwan usage, no Latin letters or digits. 3 to 16 syllables, about as long as the
learner's good sentences ("typical_good_length"). Natural, useful sentences. Use real facts from the profile when given; never invent personal facts.
"rejected_before" lists sentences that failed the check, with the reason: fix that problem in the new ones.
Return {"sentences":[{"hanzi":"...","english":"...","words":[{"text":"...","english":"..."}],"focus_at":"the syllables that carry the focus"}]}"""

DECK = """Task: pick the exact syllables for one drill step.
You get the step (type, focus, why), the findings it fixes, and the candidate syllables: Bopomofo with tone mark, a character, the tone,
and the learner's history on that syllable when there is one (answers, right %, what was given instead).
Pick 12 to 30 syllables:
- most of them fail often, or were not practiced yet;
- add contrasts: the same syllable with the tone it is confused with, or a syllable with the confused sound;
- add 2 to 4 known syllables, so the drill cannot be guessed.
Use only candidates, written exactly as given.
If "problems" is given, your last deck ("your_last_deck") failed these checks: fix them.
Return {"deck":["ㄇㄚˇ","..."],"why":"one sentence"}"""

REVIEW = """Task: review the draft plan as a strict senior coach.
You get the draft steps (pos, type, focus, target, why, finding ids), the findings, the pace, and the overview.
For each step decide:
- "keep";
- "drop": no real evidence (few answers), too advanced for the foundations, a drill of something mastered, or a duplicate;
- "change": a better "title", "why", "target", or for sentences "reps" or "min_score".
Check that confusions are trained as contrasts and that the total fits the pace. Then give the final order (warm-up, the hardest in the
middle, a short success at the end) and the final diagnosis for the learner.
Return {"verdicts":[{"pos":0,"action":"keep|drop|change","title":null,"why":null,"target":null,"reps":null,"min_score":null,"reason":"short"}],
"order":[pos,...],"diagnosis":"2-4 sentences"}"""

MILESTONES = """Task: set the milestones: 3 to 5 skill goals that take several plans to reach and show real progress.
You get the overview, the top findings, the active milestones with their current values, and a menu of measurable skills with current values.
- Keep an active milestone that is still useful and not reached: put its id in "keep".
- A new milestone must be measurable: {"title","why","area","unit","expected","min_acc","window"}. area: reading|recognize|listening|dictation|writing|speaking.
  unit: tone|initial|final|symbol|sandhi|score (score is speaking only: the average score, with expected []; sandhi: a tone rule, expected
  ["3-3"|"bu"|"yi"], area listening for the rule quiz or speaking for every recording). It is reached when the last "window"
  first-try answers of that unit reach min_acc percent right (score: the average of the last "window" recordings).
- Set the goal above the current value but reachable, usually 10 to 25 points higher. Do not pick a goal that is already reached.
- The title states the same numbers as min_acc and window, for example "Tone 4 by ear: 90% of the last 40".
Return {"keep":[ids],"new":[...]}"""

CHECKPOINT = """Task: the learner is in the middle of one drill step. Decide what happens next in this step.
You get the step (focus, target, progress), the last answers inside the step (expected, produced, right), the accuracy per block of 10
answers (oldest first), the accuracy per item, and the findings the step was made for.
Actions:
- "continue": keep going as planned.
- "finish": the skill is clearly solid now (the last two blocks at 90% or more, at least 20 answers). The step ends.
- "extend": the learner still fails often and does not improve: raise "target" (sentences: raise "reps").
- "narrow": some items are solid, others still fail: keep only the failing ones in "tones", "syms", "deck", or "sentence_ids" (a subset of the current ones).
- "easier": accuracy is very low (under 40%) or falling: narrow, and lower "min_score" (sentences) or "target".
A listening quiz must not be guessable: listen_tones keeps at least 2 tones, listen_sounds at least 2 sounds, and a deck keeps both sides
of a contrast. To train the weak side harder, keep the contrast and use "extend".
"note": one short, friendly sentence to the learner: what is going well, or what to listen for (at most one number). Never mention
the target, the step settings, or your decision.
Return {"action":"...","target":null,"reps":null,"tones":null,"syms":null,"deck":null,"sentence_ids":null,"min_score":null,"note":"..."}"""

DEBRIEF = """Task: a drill step just ended. Compare the answers inside the step with the same focus in the 30 days before the plan.
"note" (internal, for the next plan): 1-3 sentences: what improved, what still fails (name the items), and what the next plan should do
about it. Only numbers from the data.
"learner": one short, warm sentence for the learner about this step: what got better, or what to keep an eye on. At most one number.
Return {"note":"...","learner":"...","still_weak":[...],"solid":[...]}"""


def _log(run, plan_id, step_id, stage, model, t0, usage, ok, error, response):
    usage = usage or {}
    with db.conn() as c:
        c.execute(
            "INSERT INTO coach_calls(ts, run, plan_id, step_id, stage, model, ms, cost, tokens, ok, error, response) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                time.time(),
                run,
                plan_id,
                step_id,
                stage,
                model,
                round((time.time() - t0) * 1000),
                usage.get("cost"),
                usage.get("total_tokens"),
                int(ok),
                error,
                json.dumps(response, ensure_ascii=False)[:20000] if response is not None else None,
            ),
        )


async def call(
    stage: str,
    task: str,
    payload: dict,
    run: str,
    step_id: int | None = None,
    plan_id: int | None = None,
    common: str | None = None,
) -> dict:
    """One logged model decision. Tries the coach model, then the default model."""
    msgs = [
        {"role": "system", "content": (common or COMMON) + "\n\n" + task},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False, separators=(",", ":"))},
    ]
    last: Exception | None = None
    for model in dict.fromkeys([COACH_MODEL, OPENROUTER_MODEL]):
        t0 = time.time()
        try:
            res = await llm._chat(msgs, temperature=0.3, model=model, reasoning=True, timeout=180)
            _log(run, plan_id, step_id, stage, res.get("model") or model, t0, res.get("usage"), True, None, res["json"])
            if not isinstance(res["json"], dict):
                raise llm.LLMError("The reply was not a JSON object.")
            return res["json"]
        except limits.LimitReached:
            raise  # a quota wait is not a model failure; another model must not retry it
        except Exception as e:  # noqa: BLE001
            _log(run, plan_id, step_id, stage, model, t0, None, False, f"{type(e).__name__}: {e}"[:400], None)
            last = e
    raise llm.LLMError(f"{stage}: {last}")


# ---------- checking the model's steps ----------


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
    meta = {"finding_ids": [_text(x, 60) for x in (s.get("finding_ids") or []) if x][:6], "review": ""}
    if t == "speak_sentences":
        ids: list[tuple[int, str]] = []
        for i in s.get("sentence_ids") or []:
            row = db.get_sentence(_int(i, 0, 10**9, 0))
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
        count = min(_int(new.get("count"), 0, 4, 0), MAX_SENTENCES - len(ids))
        if not ids and not count:
            return None
        p = {
            "ids": [i for i, _ in ids],
            "texts": [h for _, h in ids],
            "reps": _int(s.get("reps"), 1, 10, 2),
            "min_score": _int(s.get("min_score"), 60, 100, 85),
        }
        if count:
            p["new"] = {
                "count": count,
                "focus": {
                    "tones": _tones(f.get("tones")),
                    "pairs": _pairs(f.get("pairs")),
                    "syms": _syms(f.get("syms")),
                },
            }
        target = p["reps"] * len(ids)
    else:
        if t == "speak_sounds":
            unit = s.get("unit") if s.get("unit") in ("tone", "initial", "final") else "tone"
            p = {
                "unit": unit,
                "tones": _tones(s.get("tones")),
                "syms": _syms(s.get("syms")),
                "source": "sentence" if s.get("source") == "sentence" else "syllable",
            }
            if (unit == "tone" and not p["tones"]) or (unit != "tone" and not p["syms"]):
                return None
            if unit == "tone" and 5 in p["tones"]:
                p["source"] = "sentence"  # the neutral tone only exists after another syllable
            if not levels.step_allowed(t, p, op):
                return None
        elif t == "listen_tones":
            p = {"tones": _tones(s.get("tones"), allow5=False)}
            if not p["tones"]:
                return None
        elif t == "listen_sounds":
            p = {"syms": _syms(s.get("syms"))}
        elif t == "tone_rules":
            src = s.get("params") if isinstance(s.get("params"), dict) else s
            rules = [r for r in dict.fromkeys(str(x) for x in (src.get("rules") or [])) if r in RULES] or list(RULES)
            p = {"rules": rules, "mode": "speak" if src.get("mode") == "speak" else "quiz"}
            if src.get("learn"):
                p["learn"] = True
            if not levels.step_allowed(t, p, op):
                return None
        elif t in SYMBOL_TYPES:
            p = {"syms": [x for x in _syms(s.get("syms"), single=True) if x in op["symbols"]]}
        else:
            p = {"tones": _tones(s.get("tones")), "syms": _syms(s.get("syms"))}
            if not p["tones"] and not p["syms"]:
                return None
        if (t == "listen_sounds" or t in SYMBOL_TYPES) and not p["syms"]:
            return None
        target = max(5, min(120, round(_int(s.get("target"), 5, 60, DEFAULT_TARGET[t]) * scale)))
    return {
        "type": t,
        "title": _text(s.get("title"), 80) or t.replace("_", " "),
        "why": _text(s.get("why"), 500),
        "params": p,
        "target": target,
        "minutes": _int(s.get("minutes"), 1, 60, 5),
        "meta": meta,
    }


def clean_milestone(m: dict) -> dict | None:
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
            [str(t) for t in _tones(m.get("expected"))]
            if unit == "tone"
            else _syms(m.get("expected"))
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
        "min_acc": _int(m.get("min_acc"), 50, 100, 90),
        "window": _int(m.get("window"), 20, 200, 50),
    }
    if unit == "alphabet":
        c["window"] = 37
    # The numbers in the title always come from the criterion.
    # The model often writes the goal into the title too ("Speaking score: 95 average…"): cut from the first number.
    name = re.sub(r"\s*[:,(-]?\s*(at\s+)?\d+\s*%.*$", "", _text(m.get("title"), 80))
    name = re.sub(r"\s*[:,(—-]\s*(?:an?\s+)?(?:average\s+|avg\.?\s+)?\d.*$", "", name).strip(" :-,") or "Milestone"
    goal = (
        f"average {c['min_acc']} over the last {c['window']}"
        if unit == "score"
        else f"{round(37 * c['min_acc'] / 100)} of 37 symbols known"
        if unit == "alphabet"
        else f"{c['min_acc']}% of the last {c['window']}"
    )
    return {"title": f"{name}: {goal}", "why": _text(m.get("why"), 400), "criterion": c}


def _focus_of(s: dict) -> dict:
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


# ---------- the pipeline ----------


async def write_sentences(step: dict, d: dict, profile: str, run: str):
    p = step["params"]
    need, focus = p["new"]["count"], p["new"]["focus"]
    accepted: list[dict] = []
    rejected: list[dict] = []
    s = d["sentences"]
    for attempt in range(3):
        payload = {
            "count": need - len(accepted),
            "focus": focus,
            "step": {"title": step["title"], "why": step["why"]},
            "typical_good_length": s["typical_good_length"],
            "good_sentences": s["good_count"],
            "weak_sentences": [{"text": x["text"], "avg_score": x["avg_score"]} for x in s["weak"][:5]],
            "do_not_repeat": p["texts"] + [a["hanzi"] for a in accepted],
            "rejected_before": rejected[-8:],
            "profile": profile,
        }
        r = await call(f"sentences#{attempt + 1}", SENTENCES, payload, run)
        for x in r.get("sentences") or []:
            c = llm._clean(x) if isinstance(x, dict) else None
            if not c:
                rejected.append(
                    {
                        "hanzi": _text(x.get("hanzi") if isinstance(x, dict) else x, 40),
                        "problems": ["not usable Traditional Chinese text"],
                    }
                )
                continue
            if c["hanzi"] in p["texts"] or any(a["hanzi"] == c["hanzi"] for a in accepted):
                continue
            problems = focus_check(c["hanzi"], focus)
            if problems:
                rejected.append({"hanzi": c["hanzi"], "problems": problems})
            elif len(accepted) < need:
                accepted.append(c)
        if len(accepted) >= need:
            break
    for c in accepted:
        row = db.add_sentence(c, "coach", "coach")
        p["ids"].append(row["id"])
        p["texts"].append(row["hanzi"])
    p["focus"] = focus
    p["written"], p["rejected"] = len(accepted), len(rejected)
    del p["new"]
    if accepted and LIVE:
        from . import tts  # the audio is made in the background, so Listen plays at once

        db.spawn(
            tts.pregenerate, [(c["hanzi"], r) for c in accepted for r in (0, -35)], tts.DEFAULT_VOICE, db.current_user()
        )


async def pick_deck(step: dict, findings: list[dict], hist: dict, run: str):
    cands = candidates(step, hist)
    if len(cands) < 6:
        return
    ids = set(step["meta"]["finding_ids"])
    payload = {
        "step": {"type": step["type"], "title": step["title"], "why": step["why"], "focus": _focus_of(step)},
        "findings": [f for f in findings if f["id"] in ids] or findings[:4],
        "candidates": cands,
    }
    allowed = {c["z"] for c in cands}
    for attempt in range(3):
        r = await call(f"deck#{attempt + 1}", DECK, payload, run)
        deck = [z for z in dict.fromkeys(str(x).strip() for x in r.get("deck") or []) if z in allowed][:30]
        problems = deck_problems(step, deck, cands) + (
            [f"{len(deck)} valid syllables; pick 12 to 30 candidates"] if len(deck) < 12 else []
        )
        if len(deck) >= 6 and (not problems or attempt == 2):
            step["params"]["deck"] = deck
            step["params"]["deck_why"] = _text(r.get("why"), 300)
            return
        payload = {**payload, "your_last_deck": deck, "problems": problems}


def milestone_menu(d: dict) -> list[dict]:
    menu = []
    for r in d["_skills"][:30]:
        c = {"area": r["area"], "unit": r["unit"], "expected": [r["x"]], "min_acc": 90, "window": 30}
        a, b = milestone_progress(c), milestone_progress({**c, "window": 60})
        menu.append(
            {
                "area": r["area"],
                "unit": r["unit"],
                "expected": [r["x"]],
                "last_30_pct": a["value"],
                "last_60_pct": b["value"],
                "answers": b["n"],
            }
        )
    c = {"area": "speaking", "unit": "score", "expected": [], "min_acc": 90, "window": 20}
    menu.append(
        {
            "area": "speaking",
            "unit": "score",
            "expected": [],
            "last_20_avg": milestone_progress(c)["value"],
            "last_50_avg": milestone_progress({**c, "window": 50})["value"],
        }
    )
    return menu


async def milestones_call(d: dict, findings: list[dict], run: str) -> dict:
    active = d["milestones"]
    gate = d["overview"]["alphabet"]["rule_active"]
    op = d["_open"]
    menu = [m for m in milestone_menu(d) if not (gate and needs_alphabet(m)) and levels.milestone_allowed(m, op)]
    r = await call(
        "milestones",
        MILESTONES + (ALPHABET_MILESTONE_RULE if gate else "") + level_rule(op, "milestones"),
        {"overview": d["overview"], "findings": findings[:15], "active": active, "menu": menu},
        run,
    )
    keep = {_int(x, 0, 10**9, 0) for x in r.get("keep") or []} & {m["id"] for m in active}
    new: list[dict] = []
    for m in r.get("new") or []:
        cm = clean_milestone(m) if isinstance(m, dict) else None
        if cm and gate and needs_alphabet(cm["criterion"]):
            continue
        if cm and not levels.milestone_allowed(cm["criterion"], op):
            continue
        if (
            cm
            and not milestone_progress(cm["criterion"])["reached"]
            and cm["criterion"] not in [x["criterion"] for x in new]
        ):
            new.append(cm)
    return {"keep": sorted(keep), "new": new[:5]}


def apply_review(steps: list[dict], r: dict, diagnosis: str) -> tuple[list[dict], str]:
    verdicts = {}
    for v in r.get("verdicts") or []:
        if isinstance(v, dict) and str(v.get("pos", "")).strip().isdigit():
            verdicts[int(v["pos"])] = v
    drop = set()
    for i, s in enumerate(steps):
        v = verdicts.get(i) or {}
        s["meta"]["review"] = _text(v.get("reason"), 300)
        if v.get("action") == "drop":
            drop.add(i)
        elif v.get("action") == "change":
            if v.get("title"):
                s["title"] = _text(v["title"], 80)
            if v.get("why"):
                s["why"] = _text(v["why"], 500)
            if s["type"] == "speak_sentences":
                p = s["params"]
                p["reps"] = _int(v.get("reps"), 1, 10, p["reps"])
                p["min_score"] = _int(v.get("min_score"), 60, 100, p["min_score"])
                s["target"] = p["reps"] * len(p["ids"])
            elif v.get("target") is not None:
                s["target"] = _int(v["target"], 5, 120, s["target"])
    kept = [i for i in range(len(steps)) if i not in drop]
    if len(kept) < 2:
        kept = list(range(len(steps)))
    rank = {}
    for k, x in enumerate(r.get("order") or []):
        if str(x).strip().isdigit():
            rank.setdefault(int(x), k)
    kept.sort(key=lambda i: rank.get(i, 100 + i))
    return [steps[i] for i in kept], _text(r.get("diagnosis"), 1200) or diagnosis


async def pipeline(d: dict, reason: str, run: str) -> dict:
    _stage("Reading your answers")

    async def analyst(dom):
        try:
            return dom, await call(
                "analyze:" + dom,
                ANALYZE.replace("DOMAIN", DOMAINS[dom]),
                {"overview": d["overview"], "data": d[dom]},
                run,
            )
        except Exception as e:  # noqa: BLE001
            return dom, {"error": str(e)[:300]}

    async def pace():
        try:
            return await call("pace", PACE, {"overview": d["overview"], "pace": d["pace"], "reason": reason}, run)
        except Exception as e:  # noqa: BLE001
            return {"error": str(e)[:300]}

    res = await asyncio.gather(*(analyst(x) for x in DOMAINS), pace())
    analyses, pace_r = dict(res[:-1]), res[-1]
    if all("error" in a for a in analyses.values()):
        raise llm.LLMError("Every analyst call failed: " + next(iter(analyses.values()))["error"])
    findings, strengths, unknown, advanced = [], [], [], []
    for dom, a in analyses.items():
        for i, f in enumerate(a.get("findings") or []):
            if isinstance(f, dict):
                findings.append(
                    {
                        "id": f"{dom}:{_text(f.get('id'), 40) or i + 1}",
                        "domain": dom,
                        "area": _text(f.get("area"), 16),
                        "items": _list(f.get("items"), 12, 40),
                        "problem": _text(f.get("problem"), 400),
                        "context": _text(f.get("context"), 200),
                        "severity": _int(f.get("severity"), 1, 5, 3),
                        "confidence": _int(f.get("confidence"), 1, 5, 3),
                        "drill": _text(f.get("drill"), 200),
                    }
                )
        strengths += [f"{dom}: {x}" for x in _list(a.get("strengths"), 5)]
        unknown += [f"{dom}: {x}" for x in _list(a.get("unknown"), 5)]
        advanced += [f"{dom}: {x}" for x in _list(a.get("too_advanced"), 5)]
    findings.sort(key=lambda f: -f["severity"] * f["confidence"])
    pace = {
        "plan_minutes": _int(pace_r.get("plan_minutes"), 10, 60, PLAN_MINUTES),
        "target_scale": _float(pace_r.get("target_scale"), 0.5, 2.0, 1.0),
        "steps": _int(pace_r.get("steps"), 3, 7, 5),
        "notes": _text(pace_r.get("notes"), 400),
        "avoid": _list(pace_r.get("avoid"), 6),
    }

    _stage("Choosing your next steps")
    s = d["sentences"]
    op = d["_open"]
    rules_on = TONE_RULES_RULE if d["overview"]["tone_rules"]["rule_active"] else ""
    task = PLAN + (ALPHABET_RULE if d["overview"]["alphabet"]["rule_active"] else "") + rules_on + level_rule(op)
    plan = await call(
        "plan",
        task,
        {
            "reason": reason,
            "overview": d["overview"],
            "pace": pace,
            "findings": findings[:30],
            "strengths": strengths,
            "unknown": unknown,
            "too_advanced": advanced,
            "reusable_sentences": {"weak": s["weak"], "library_not_practiced": s["library_not_practiced"]},
            "previous_plans": d["pace"]["previous_plans"],
            "milestones": d["milestones"],
        },
        run,
    )
    known = {x["text"] for x in s["weak"]} | {x["text"] for x in s["library_not_practiced"]}
    steps = [
        c
        for c in (
            clean_step(x, known, pace["target_scale"], op) for x in plan.get("steps") or [] if isinstance(x, dict)
        )
        if c
    ][:7]
    if not steps:
        raise llm.LLMError("The planner's steps could not be measured.")

    _stage("Preparing your drills")
    profile = llm.profile_text(db.get_profile())
    hist = syllable_history()

    async def detail(st):
        try:
            if st["type"] == "speak_sentences" and st["params"].get("new"):
                await write_sentences(st, d, profile, run)
            elif st["type"] in DECK_TYPES and st["params"].get("source") != "sentence":
                await pick_deck(st, findings, hist, run)
        except Exception as e:  # noqa: BLE001
            st["meta"].setdefault("errors", []).append(str(e)[:200])

    await asyncio.gather(*(detail(x) for x in steps))
    for st in steps:
        if st["type"] == "speak_sentences":
            st["params"].pop("new", None)
            st["target"] = st["params"]["reps"] * len(st["params"]["ids"])
    steps = [x for x in steps if x["type"] != "speak_sentences" or x["params"]["ids"]]
    if not steps:
        raise llm.LLMError("No step was left after the details stage.")

    _stage("Checking your plan")
    draft = [
        {
            "pos": i,
            "type": x["type"],
            "title": x["title"],
            "why": x["why"],
            "focus": _focus_of(x),
            "target": x["target"],
            "minutes": x["minutes"],
            "finding_ids": x["meta"]["finding_ids"],
        }
        for i, x in enumerate(steps)
    ]
    review_r, ms_r = await asyncio.gather(
        call(
            "review",
            REVIEW + (ALPHABET_RULE if d["overview"]["alphabet"]["rule_active"] else "") + rules_on + level_rule(op),
            {"draft": draft, "findings": findings[:30], "pace": pace, "overview": d["overview"]},
            run,
        ),
        milestones_call(d, findings, run),
        return_exceptions=True,
    )
    diagnosis = _text(plan.get("diagnosis"), 1200)
    if isinstance(review_r, dict):
        steps, diagnosis = apply_review(steps, review_r, diagnosis)
    return {
        "diagnosis": diagnosis,
        "steps": steps,
        "milestones": ms_r if isinstance(ms_r, dict) else None,
        "findings": findings,
        "strengths": strengths,
        "unknown": unknown,
        "too_advanced": advanced,
        "pace": pace,
        "review": review_r if isinstance(review_r, dict) else {"error": str(review_r)[:300]},
    }


def rules_plan(d: dict) -> dict:
    """A plan without the model: the weak spots, mapped to step types."""
    steps: list[dict] = []
    grouped: dict[str, list] = defaultdict(list)
    for s in d["_skills"]:
        if (s["right_pct"] or 0) >= 90:
            continue
        other = [k for k in s["produced_instead"] if k not in ("?", "∅")]
        a, u, x = s["area"], s["unit"], s["x"]
        why = f"Right {s['right_pct']:.0f}% of the time so far, so a little more practice here pays off."
        if a == "listening" and u == "tone" and x != "5":
            steps.append(
                {
                    "type": "listen_tones",
                    "title": f"Hear tone {x}" + (f" vs tone {other[0]}" if other else ""),
                    "why": why,
                    "tones": [x, *other[:1]],
                    "target": 15,
                }
            )
        elif a == "speaking" and u == "tone" and x == "5":
            steps.append(
                {
                    "type": "speak_sounds",
                    "unit": "tone",
                    "tones": [5],
                    "source": "sentence",
                    "title": "Say the neutral tone in short words",
                    "why": why,
                    "target": 10,
                }
            )
        elif a == "speaking" and u == "tone":
            steps.append(
                {
                    "type": "speak_sounds",
                    "unit": "tone",
                    "tones": [x],
                    "source": "syllable",
                    "title": f"Say tone {x} on single syllables",
                    "why": why,
                    "target": 10,
                }
            )
        elif a == "speaking" and u in ("initial", "final"):
            steps.append(
                {
                    "type": "speak_sounds",
                    "unit": u,
                    "syms": [x, *other[:1]],
                    "source": "syllable",
                    "title": f"Say {x}" + (f" vs {other[0]}" if other else ""),
                    "why": why,
                    "target": 10,
                }
            )
        elif a == "listening" and u in ("initial", "final"):
            steps.append(
                {
                    "type": "listen_sounds",
                    "syms": [x, *other[:1]],
                    "title": f"Hear {x}" + (f" vs {other[0]}" if other else ""),
                    "why": why,
                    "target": 12,
                }
            )
        elif u == "sandhi" and x in RULES:
            steps.append(
                {
                    "type": "tone_rules",
                    "rules": [x],
                    "mode": "speak" if a == "speaking" else "quiz",
                    "title": f"Practice the {RULES[x]['name']}",
                    "why": RULES[x]["short"],
                    "target": 10,
                }
            )
        elif u == "symbol" and a in ("reading", "recognize", "dictation"):
            grouped[a].append(x)
        if len(steps) >= 4:
            break
    verb = {
        "reading": ("read_symbols", "Read "),
        "recognize": ("recognize_symbols", "Recognize "),
        "dictation": ("write_symbols", "Write "),
    }
    for a, syms in grouped.items():
        steps.append(
            {
                "type": verb[a][0],
                "syms": syms[:4],
                "title": verb[a][1] + " ".join(syms[:4]),
                "why": "The symbols that still trip you up most.",
                "target": 8,
            }
        )
    weak = [s for s in d["sentences"]["weak"] if s["id"]][:4]
    if weak:
        steps.append(
            {
                "type": "speak_sentences",
                "sentence_ids": [s["id"] for s in weak],
                "reps": 2,
                "min_score": 85,
                "title": "Repeat your weakest sentences",
                "why": "These sentences are close: a few more tries make them smooth.",
            }
        )
    # Only the exercises the level has unlocked. Without weak spots: a first look at each open exercise.
    op = d.get("_open") or levels.opened()
    steps = [s for s in steps if levels.step_allowed(s["type"], s, op)]
    if not steps:
        first = list(op["symbols"][:6])
        steps = [
            {
                "type": "listen_tones",
                "tones": [1, 2, 3, 4],
                "target": 20,
                "title": "Tone check: all four tones",
                "why": "A first look at how you hear the tones.",
            },
            {
                "type": "read_symbols",
                "syms": first,
                "target": 8,
                "title": "Read the first symbols",
                "why": "A first look at the symbols.",
            },
            {
                "type": "recognize_symbols",
                "syms": first,
                "target": 8,
                "title": "Type the first symbols",
                "why": "A first try at naming them silently.",
            },
            {
                "type": "write_symbols",
                "syms": first,
                "target": 8,
                "title": "Write the first symbols",
                "why": "A first try at writing them.",
            },
            {
                "type": "speak_sounds",
                "unit": "tone",
                "tones": [1, 2, 3, 4],
                "source": "syllable",
                "target": 10,
                "title": "Say single syllables",
                "why": "A first look at how you say the tones.",
            },
        ]
        steps = [s for s in steps if levels.step_allowed(s["type"], s, op)]
    return {
        "diagnosis": "Built by rules from your weak spots, because Bobo's planner was not available.",
        "steps": steps[:6],
        "milestones": None,
    }


def _run_pipeline(d: dict, reason: str, run: str) -> dict:
    return asyncio.run(pipeline(d, reason, run))


def build(reason: str, run_pipeline=None, as_next: bool = False) -> int:
    """Build and save a new plan. run_pipeline(digest, reason, run) -> result can replace the model pipeline in tests.
    as_next: the plan waits (status 'next') until the active plan is finished."""
    _stage("Reading your answers")
    lv = levels.check()  # new unlocks and drops first, so the plan matches the level the learner sees
    d = digest(lv)
    op = d["_open"]
    run = uuid.uuid4().hex[:12]
    error = None
    try:
        out = (run_pipeline or _run_pipeline)(d, reason, run)
        source = "llm"
        if not out.get("steps"):
            raise llm.LLMError("The plan had no steps.")
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        out, source, error = rules_plan(d), "rules", f"{type(e).__name__}: {e}"[:400]
        known = {s["text"] for s in d["sentences"]["weak"]}
        out["steps"] = [c for c in (clean_step(s, known, 1.0, op) for s in out["steps"]) if c]
    # A rule of the app, whatever the model returned: no step of a locked exercise.
    out["steps"] = [s for s in out["steps"] if levels.step_allowed(s["type"], s["params"], op)]
    alpha = alphabet_status()
    out["steps"], removed = alphabet_gate(out["steps"], alpha, op)
    # The tone rules come before sentences: rule steps right after the alphabet steps, and no sentence steps until they are known.
    rs = rules_status(lv)
    n_alpha = sum(1 for s in out["steps"] if (s.get("meta") or {}).get("rule") == "alphabet")
    ruled, removed_r = rules_gate(out["steps"][n_alpha:], rs, op)
    out["steps"] = (out["steps"][:n_alpha] + ruled)[:7]
    removed += removed_r
    # Known items that dropped get a short review right after the alphabet steps.
    review = levels.remediation(lv)
    if review:
        n = sum(1 for s in out["steps"] if (s.get("meta") or {}).get("rule") in ("alphabet", "tone_rules"))
        out["steps"] = (out["steps"][:n] + review + out["steps"][n:])[:7]
        out["diagnosis"] = (
            "Review first: "
            + ", ".join(s["title"].removeprefix("Review: ") for s in review)
            + " slipped below your known level. "
            + (out.get("diagnosis") or "")
        )
    if source == "rules" and alpha["gate"]:
        out["diagnosis"] = (
            "Tone quizzes train your ear, but they do not show that you know the symbols. " + out["diagnosis"]
        )
    if alpha["gate"] and alpha["next_group"]:
        out["diagnosis"] = alphabet_sentence(alpha) + " " + (out.get("diagnosis") or "")
    if rs["gate"]:
        out["diagnosis"] = rules_sentence(rs) + " " + (out.get("diagnosis") or "")
    _stage("Saving your plan")
    models = Counter(r["model"] for r in _q("SELECT model FROM coach_calls WHERE run=? AND ok=1", (run,)))
    model = ", ".join(m for m, _ in models.most_common(3)) or None
    raw = {k: out.get(k) for k in ("findings", "strengths", "unknown", "too_advanced", "pace", "review")}
    raw["alphabet_rule"] = {
        "active": alpha["gate"],
        "known": alpha["known_count"],
        "next": alpha["next_group"],
        "removed_steps": removed,
    }
    raw["tone_rule"] = {
        "active": rs["gate"],
        "known": rs["known"],
        "missing": rs["missing"],
        "removed_steps": removed_r,
    }
    raw["level_rule"] = {
        "level": lv["level"],
        "exercises": lv["exercises"],
        "step_types": lv["step_types"],
        "review": [s["title"] for s in review],
        "drops": lv["drops"],
    }
    now = time.time()
    with db.conn() as c:
        has_active = c.execute("SELECT 1 FROM plans WHERE status='active'").fetchone()
        status = "next" if as_next and has_active else "active"
        c.execute(
            "UPDATE plans SET status='replaced', done_ts=? WHERE status IN "
            + ("('next')" if status == "next" else "('active','next')"),
            (now,),
        )
        pid = c.execute(
            "INSERT INTO plans(ts, status, source, model, diagnosis, reason, digest, raw, error) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id",
            (
                now,
                status,
                source,
                model,
                _text(out.get("diagnosis"), 1200),
                reason,
                json.dumps(d, ensure_ascii=False),
                json.dumps(raw, ensure_ascii=False),
                error,
            ),
        ).fetchone()["id"]
        for i, s in enumerate(out["steps"]):
            c.execute(
                "INSERT INTO steps(plan_id, pos, type, title, why, params, target, minutes) VALUES (?,?,?,?,?,?,?,?)",
                (
                    pid,
                    i,
                    s["type"],
                    s["title"],
                    s["why"],
                    json.dumps({**s["params"], "meta": s.get("meta") or {}}, ensure_ascii=False),
                    s["target"],
                    s["minutes"],
                ),
            )
        c.execute("UPDATE coach_calls SET plan_id=? WHERE run=?", (pid, run))
        ms = out.get("milestones")
        if source == "llm" and ms:
            keep = list(ms.get("keep") or [])
            c.execute(
                "UPDATE milestones SET status='dropped', done_ts=? WHERE status='active' AND criterion NOT LIKE '%\"alphabet\"%'"
                " AND criterion NOT LIKE '%\"level\"%'"
                f" AND id NOT IN ({','.join('?' * len(keep)) or 'NULL'})",
                (now, *keep),
            )
            for m in ms.get("new") or []:
                if (
                    m["criterion"]["unit"] in ("alphabet", "level")
                    or (alpha["gate"] and needs_alphabet(m["criterion"]))
                    or not levels.milestone_allowed(m["criterion"], op)
                ):
                    continue
                c.execute(
                    "INSERT INTO milestones(ts, plan_id, title, why, criterion) VALUES (?,?,?,?,?)",
                    (now, pid, m["title"], m["why"], json.dumps(m["criterion"], ensure_ascii=False)),
                )
        # While the alphabet is learned, milestones that test the symbols wait: the alphabet milestone tracks them.
        if alpha["gate"]:
            for mid, crit in c.execute("SELECT id, criterion FROM milestones WHERE status='active'").fetchall():
                if needs_alphabet(json.loads(crit)):
                    c.execute("UPDATE milestones SET status='dropped', done_ts=? WHERE id=?", (now, mid))
        # Milestones of locked exercises wait for their level.
        for mid, crit in c.execute("SELECT id, criterion FROM milestones WHERE status='active'").fetchall():
            if not levels.milestone_allowed(json.loads(crit), op):
                c.execute("UPDATE milestones SET status='dropped', done_ts=? WHERE id=?", (now, mid))
        # The next level is a milestone of the app from level 2 on (at level 1 the alphabet milestone is the same goal).
        nxt = lv["next"]
        if (
            nxt
            and lv["level"] >= 2
            and not c.execute(
                "SELECT 1 FROM milestones WHERE status='active' AND criterion LIKE ?",
                (f'%"unit": "level", "expected": ["{nxt["n"]}"]%',),
            ).fetchone()
        ):
            goals = lv["levels"][lv["level"] - 1]["goals"]
            crit = {
                "area": "reading",
                "unit": "level",
                "expected": [str(nxt["n"])],
                "min_acc": 100,
                "window": sum(g["need"] for g in goals),
            }
            c.execute(
                "INSERT INTO milestones(ts, plan_id, title, why, criterion) VALUES (?,?,?,?,?)",
                (
                    now,
                    pid,
                    f"Reach level {nxt['n']}: {nxt['title']}",
                    "Unlocks "
                    + ", ".join(o["label"] for o in nxt["opens"])
                    + ". Every item must be known: right on the first try, fast, on more than one day.",
                    json.dumps(crit, ensure_ascii=False),
                ),
            )
        # The alphabet milestone is a rule of the app: it stays until the 37 symbols are known.
        if (
            alpha["known_count"] < 37
            and not c.execute(
                "SELECT 1 FROM milestones WHERE status='active' AND criterion LIKE '%\"alphabet\"%'"
            ).fetchone()
        ):
            m = clean_milestone(
                {
                    "title": "Know the alphabet",
                    "area": "reading",
                    "unit": "alphabet",
                    "min_acc": 100,
                    "why": "Every Bopomofo drill needs the 37 symbols. A symbol counts as known when you say, type, or write it right, without help, several times in a row.",
                }
            )
            c.execute(
                "INSERT INTO milestones(ts, plan_id, title, why, criterion) VALUES (?,?,?,?,?)",
                (now, pid, m["title"], m["why"], json.dumps(m["criterion"], ensure_ascii=False)),
            )
    # The headline and the "How do we know?" story. A failure here never loses the plan: the story can be written again later.
    _stage("Writing your story")
    try:
        from . import story

        story.write(pid, run, live=LIVE and run_pipeline is None)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
    return pid


def story_stats_now() -> dict:
    """The story numbers for a plan saved before the story existed: read from today's stats."""
    return digest()["story"]


def state_milestones() -> list[dict]:
    out = []
    for m in _q("SELECT * FROM milestones WHERE status='active' ORDER BY id"):
        c = json.loads(m["criterion"])
        out.append({k: m[k] for k in ("id", "title", "why")} | {"criterion": c, **milestone_progress(c)})
    return out


def start_story(pid: int) -> bool:
    """Write the headline and story of a saved plan again, in the background. False when the coach is busy."""
    if not LIVE or not _plan_row(pid):
        return False
    if limits.ai_quota()["blocked"]:
        return False
    if not _claim("Writing your story", story=pid):
        return False

    def run():
        from . import story

        story.write(pid)

    _run_job(run)
    return True


def start(reason: str, as_next: bool = False) -> bool:
    """Build a plan in the background. Returns False when one is already being built."""
    if not LIVE:
        return False
    if limits.ai_quota()["blocked"]:
        return False
    if not _claim("Starting", as_next=as_next):
        return False
    _run_job(lambda: build(reason, as_next=as_next))
    return True


# ---------- progress, measured from the answers given inside a step ----------


def _match(expected: str, syms: list[str], exact: bool) -> bool:
    return expected in syms if exact else any(s in expected for s in syms)


def _hit(step: dict, r: dict) -> bool:
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
    t, p, sid = step["type"], step["params"], step["id"]
    if t == "speak_sentences":
        texts = p.get("texts") or []
        rows = [
            r
            for r in _q(
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
    rows = _q(
        "SELECT u.kind, u.expected, u.actual, u.ok, u.help, u.try_n, e.item FROM units u JOIN events e ON e.id = u.event_id"
        f" WHERE {STEP_SQL} AND u.ok IS NOT NULL AND u.kind IN ('tone','initial','final','symbol','sandhi') ORDER BY u.id",
        (sid,),
    )
    mine = [r for r in rows if _hit(step, r)]
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


def _before(step: dict, ts: float) -> dict:
    """The same focus in the 30 days before the plan."""
    since = ts - 30 * 86400
    if step["type"] == "speak_sentences":
        texts = step["params"]["texts"] or [""]
        rows = _q(
            f"SELECT item, score FROM events WHERE area='speaking' AND score IS NOT NULL AND ts>=? AND ts<? AND item IN ({','.join('?' * len(texts))})",
            (since, ts, *texts),
        )
        return {
            "recordings": len(rows),
            "average_score": round(sum(r["score"] for r in rows) / len(rows)) if rows else None,
        }
    rows = _q(
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
    mine = [r for r in rows if _hit(step, r)]
    ok = sum(1 for r in mine if r["ok"] and not r["help"])
    return {"answers": len(mine), "right_pct": stats._pct(ok, len(mine))}


def href(step: dict) -> str:
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
        rows = _q(
            "SELECT score FROM events WHERE area='speaking' AND score IS NOT NULL ORDER BY ts DESC LIMIT ?",
            (c["window"],),
        )
        n = len(rows)
        value = round(sum(r["score"] for r in rows) / n, 1) if n else None
    else:
        rows = _q(
            "SELECT expected, ok, help FROM units WHERE area=? AND kind=? AND try_n=0 AND ok IS NOT NULL ORDER BY id DESC LIMIT 2000",
            (c["area"], c["unit"]),
        )
        exact = c["unit"] in ("tone", "symbol", "initial", "sandhi")
        rows = [r for r in rows if _match(r["expected"], c["expected"], exact)][: c["window"]]
        n = len(rows)
        value = round(100 * sum(1 for r in rows if r["ok"] and not r["help"]) / n, 1) if n else None
    return {"n": n, "value": value, "reached": n >= c["window"] and value is not None and value >= c["min_acc"]}


# ---------- during practice: checkpoints and debriefs ----------


def _plan_row(pid: int | None = None) -> dict | None:
    rows = (
        _q("SELECT * FROM plans WHERE id=?", (pid,))
        if pid
        else _q("SELECT * FROM plans WHERE status='active' ORDER BY id DESC LIMIT 1")
    )
    return rows[0] if rows else None


def _steps(pid: int) -> list[dict]:
    return [
        {**s, "params": json.loads(s["params"])} for s in _q("SELECT * FROM steps WHERE plan_id=? ORDER BY pos", (pid,))
    ]


def _step(sid: int) -> dict | None:
    rows = _q("SELECT * FROM steps WHERE id=?", (sid,))
    return {**rows[0], "params": json.loads(rows[0]["params"])} if rows else None


def _brief(s: dict) -> dict:
    return {"type": s["type"], "title": s["title"], "why": s["why"], "focus": _focus_of(s), "target": s["target"]}


def _ask_sync(stage: str, task: str, payload: dict, step: dict) -> dict:
    return asyncio.run(call(stage, task, payload, uuid.uuid4().hex[:12], step["id"], step["plan_id"]))


def _linked_findings(s: dict) -> list[dict]:
    plan = _plan_row(s["plan_id"])
    ids = set((s["params"].get("meta") or {}).get("finding_ids") or [])
    raw = json.loads(plan["raw"] or "{}") if plan else {}
    return [f for f in raw.get("findings") or [] if isinstance(f, dict) and f.get("id") in ids]


def apply_checkpoint(s: dict, prog: dict, r: dict) -> dict:
    """Apply a checkpoint decision. The model can only shrink the focus to a subset, and the targets stay in bounds."""
    act = r.get("action") if r.get("action") in ("continue", "finish", "extend", "narrow", "easier") else "continue"
    p = dict(s["params"])
    target, status = s["target"], "open"
    sentences = s["type"] == "speak_sentences"
    if act == "finish":
        if prog["tried"] >= 10:
            status = "done"
        else:
            act = "continue"
    elif act == "extend":
        if sentences:
            p["reps"] = _int(r.get("reps"), p["reps"], 10, min(10, p["reps"] + 1))
        else:
            target = _int(r.get("target"), prog["progress"] + 3, 150, s["target"] + 10)
    if act in ("narrow", "easier"):
        tones = [t for t in _tones(r.get("tones")) if t in (p.get("tones") or [])]
        if tones:
            p["tones"] = tones
        syms = [x for x in _syms(r.get("syms")) if x in (p.get("syms") or [])]
        if syms:
            p["syms"] = syms
        rules = [x for x in dict.fromkeys(str(v) for v in (r.get("rules") or [])) if x in (p.get("rules") or [])]
        if rules:
            p["rules"] = rules
        deck = [z for z in dict.fromkeys(str(x).strip() for x in r.get("deck") or []) if z in (p.get("deck") or [])]
        if len(deck) >= 4:
            p["deck"] = deck
        if sentences:
            keep = {_int(x, 0, 10**9, 0) for x in r.get("sentence_ids") or []} & set(p["ids"])
            if keep:
                p["texts"] = [t for i, t in zip(p["ids"], p["texts"], strict=False) if i in keep]
                p["ids"] = [i for i in p["ids"] if i in keep]
        if s["type"] in ("listen_tones", "listen_sounds"):
            # A quiz with one answer is guessable: keep at least two tones or sounds, and a deck with at least two tones.
            if len(p.get("tones") or []) < 2 and s["type"] == "listen_tones":
                p["tones"] = s["params"].get("tones")
            if len(p.get("syms") or []) < 2 and s["type"] == "listen_sounds":
                p["syms"] = s["params"].get("syms")
            by_z = {x["z"]: x["tone"] for x in syllables()}
            if s["type"] == "listen_tones" and p.get("deck") and len({by_z.get(z) for z in p["deck"]}) < 2:
                p["deck"] = s["params"].get("deck")
    if act == "easier":
        if sentences:
            p["min_score"] = _int(r.get("min_score"), 60, p["min_score"], max(60, p["min_score"] - 10))
        else:
            target = _int(r.get("target"), max(5, prog["progress"] + 1), s["target"], max(5, s["target"] - 5))
    if sentences:
        target = p["reps"] * len(p["ids"])
    note = _text(r.get("note"), 400)
    now = time.time()
    with db.conn() as c:
        cur = c.execute(
            "UPDATE steps SET params=?, target=?, status=?, done_ts=? WHERE id=? AND status='open'",
            (json.dumps(p, ensure_ascii=False), target, status, now if status == "done" else None, s["id"]),
        )
        if cur.rowcount == 0:  # the step ended while the model was thinking: its decision is too late
            return {"action": "late", "target": s["target"], "params": s["params"], "status": "late", "note": ""}
        if note:
            c.execute(
                "INSERT INTO coach_notes(ts, plan_id, step_id, kind, text) VALUES (?,?,?,?,?)",
                (now, s["plan_id"], s["id"], "checkpoint:" + act, note),
            )
    return {"action": act, "target": target, "params": p, "status": status, "note": note}


def checkpoint(step_id: int, ask=None) -> dict | None:
    """Mid-step decision from the answers so far. ask(stage, task, payload) -> reply can replace the model in tests."""
    s = _step(step_id)
    if not s or s["status"] != "open":
        return None
    prog = step_progress(s, detail=True)
    payload = {
        "step": _brief(s),
        "progress": {k: prog[k] for k in ("progress", "tried", "right")},
        "last_answers": prog.get("last"),
        "accuracy_by_10": prog.get("blocks"),
        "by_item": prog.get("by_item") or prog.get("items"),
        "findings": _linked_findings(s),
    }
    r = (ask or (lambda st, task, pl: _ask_sync(st, task, pl, s)))("checkpoint", CHECKPOINT, payload)
    out = apply_checkpoint(s, prog, r)
    if out["status"] == "done":
        refresh(check=False)
        if LIVE:
            debrief(step_id)
    return out


def debrief(step_id: int, ask=None) -> str | None:
    s = _step(step_id)
    plan = _plan_row(s["plan_id"]) if s else None
    if not plan:
        return None
    prog = step_progress(s, detail=True)
    payload = {
        "step": _brief(s),
        "inside_step": {k: prog.get(k) for k in ("progress", "tried", "right", "blocks", "by_item", "items")},
        "before_plan_30_days": _before(s, plan["ts"]),
        "findings": _linked_findings(s),
    }
    r = (ask or (lambda st, task, pl: _ask_sync(st, task, pl, s)))("debrief", DEBRIEF, payload)
    note = _text(r.get("note"), 500)
    learner = _text(r.get("learner"), 300)
    if note:
        with db.conn() as c:
            c.execute(
                "INSERT INTO coach_notes(ts, plan_id, step_id, kind, text) VALUES (?,?,?,?,?)",
                (time.time(), s["plan_id"], s["id"], "debrief", note),
            )
    if learner:  # the line the learner sees; the note above stays for the next plan
        with db.conn() as c:
            c.execute(
                "INSERT INTO coach_notes(ts, plan_id, step_id, kind, text) VALUES (?,?,?,?,?)",
                (time.time(), s["plan_id"], s["id"], "debrief:learner", learner),
            )
    return note


def _bg(fn, sid: int):
    def run():
        try:
            fn(sid)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        finally:
            _checking.discard(sid)

    db.spawn(run)


def _promote() -> int | None:
    """Make the plan built in advance the active one. Its steps count answers from now."""
    with db.conn() as c:
        r = c.execute("SELECT id FROM plans WHERE status='next' ORDER BY id DESC LIMIT 1").fetchone()
        if not r:
            return None
        c.execute("UPDATE plans SET status='active', ts=? WHERE id=?", (time.time(), r["id"]))
    return r["id"]


def refresh(check: bool = True) -> dict:
    """Update steps and milestones from the answers. Starts checkpoints, debriefs, and the next plan when needed."""
    done_now, to_check = [], []
    finished = want_next = False
    # Checkpoints and debriefs are AI calls. While AI energy is empty, a due checkpoint stays due until the refill.
    ai_ready = LIVE and check and not limits.ai_quota()["blocked"]
    with _refresh_lock:
        # Levels first: new unlocks, drops, and notices. A failure here never blocks the plan.
        lv = None
        try:
            lv = levels.check()
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        op = {"exercises": lv["exercises"], "symbols": lv["symbols"]} if lv else None
        plan = _plan_row()
        if plan:
            now = time.time()
            with db.conn() as c:
                for s in _steps(plan["id"]):
                    if s["status"] != "open":
                        continue
                    # A step of an exercise the level has not unlocked (a plan from before the levels) is closed.
                    if op and not levels.step_allowed(s["type"], s["params"], op):
                        c.execute(
                            "UPDATE steps SET status='skipped', skip_reason='locked', done_ts=? WHERE id=?",
                            (now, s["id"]),
                        )
                        continue
                    pr = step_progress(s)
                    if pr["progress"] >= s["target"]:
                        c.execute("UPDATE steps SET status='done', done_ts=? WHERE id=?", (now, s["id"]))
                        done_now.append(s["id"])
                    elif ai_ready and pr["tried"] - (s["checked_n"] or 0) >= CHECK_EVERY and s["id"] not in _checking:
                        c.execute("UPDATE steps SET checked_n=? WHERE id=?", (pr["tried"], s["id"]))
                        to_check.append(s["id"])
                left, total = c.execute(
                    "SELECT COUNT(*) FILTER (WHERE status='open'), COUNT(*) FROM steps WHERE plan_id=?", (plan["id"],)
                ).fetchone()
                if total and not left:
                    c.execute("UPDATE plans SET status='done', done_ts=? WHERE id=?", (now, plan["id"]))
                    finished = True
                elif total > 1 and left == 1:
                    want_next = True
        with db.conn() as c:
            for m in c.execute("SELECT id, criterion FROM milestones WHERE status='active'").fetchall():
                if milestone_progress(json.loads(m["criterion"]), lv)["reached"]:
                    c.execute("UPDATE milestones SET status='achieved', done_ts=? WHERE id=?", (time.time(), m["id"]))
        if finished and not _promote():
            start("The previous plan is finished. Build the next one from the new stats.")
    if ai_ready:
        for sid in done_now:
            _bg(debrief, sid)
        for sid in to_check:
            _checking.add(sid)
            _bg(checkpoint, sid)
    if want_next and not _q("SELECT id FROM plans WHERE status='next'"):
        start(
            "One step is left in the current plan. Build the next plan now, so it is ready when this one ends.",
            as_next=True,
        )
    return {"done_now": done_now, "checking": to_check, "finished": finished, "levels": lv}


def skip(step_id: int, reason: str) -> dict:
    reason = reason if reason in ("too_hard", "too_easy", "not_now") else "not_now"
    s = _step(step_id)
    with db.conn() as c:
        c.execute(
            "UPDATE steps SET status='skipped', skip_reason=?, done_ts=? WHERE id=? AND status='open'",
            (reason, time.time(), step_id),
        )
        if s:
            c.execute(
                "INSERT INTO coach_notes(ts, plan_id, step_id, kind, text) VALUES (?,?,?,?,?)",
                (time.time(), s["plan_id"], step_id, "skip", f'Skipped "{s["title"]}": {reason.replace("_", " ")}.'),
            )
    refresh()
    return state()


# ---------- views for the API ----------


def _step_view(s: dict) -> dict:
    meta = s["params"].get("meta") or {}
    note = _q(
        f"SELECT kind, text, ts FROM coach_notes WHERE step_id=? AND {VISIBLE_NOTES} ORDER BY id DESC LIMIT 1",
        (s["id"],),
    )
    return {
        **{
            k: s[k]
            for k in (
                "id",
                "plan_id",
                "pos",
                "type",
                "title",
                "why",
                "target",
                "minutes",
                "status",
                "skip_reason",
                "done_ts",
            )
        },
        "params": {k: v for k, v in s["params"].items() if k != "meta"},
        "area": TYPES[s["type"]],
        "href": href(s),
        "finding_ids": meta.get("finding_ids") or [],
        "review": meta.get("review") or "",
        "note": note[0] if note else None,
        **step_progress(s),
    }


def _calls(plan_id: int) -> dict:
    rows = _q("SELECT ts, stage, model, ms, cost, tokens, ok FROM coach_calls WHERE plan_id=?", (plan_id,))
    build_rows = [r for r in rows if not r["stage"].startswith(("checkpoint", "debrief"))]
    return {
        "count": len(rows),
        "build_count": len(build_rows),
        "failed": sum(1 for r in rows if not r["ok"]),
        "cost": round(sum(r["cost"] or 0 for r in rows), 4),
        "tokens": sum(r["tokens"] or 0 for r in rows),
        "seconds": round(max(r["ts"] for r in build_rows) - min(r["ts"] - (r["ms"] or 0) / 1000 for r in build_rows))
        if build_rows
        else None,
        "models": dict(Counter(r["model"] for r in rows if r["ok"] and r["model"])),
        "stages": dict(Counter(r["stage"].split(":")[0].split("#")[0] for r in rows)),
    }


def state(lv: dict | None = None) -> dict:
    """lv: the level status from refresh(), to avoid reading every answer twice."""
    plan = _plan_row() or (_q("SELECT * FROM plans WHERE status!='next' ORDER BY id DESC LIMIT 1") or [None])[0]
    # The first plan waits for the onboarding and the full profile, so its sentences use the learner's real life.
    # A learner who does not want to wait asks for it on Home (POST /api/coach/plan).
    job = _job()
    if (
        not plan
        and not job["running"]
        and db.get_settings().get("onboarded_at")
        and not llm.profile_missing(db.get_profile())
    ):
        start("First plan for this learner, with the full profile.")
        job = _job()
    midnight = db.day_start(db.local_today())
    lv = lv or levels.status()
    use = _q(
        "SELECT COUNT(*) AS n, SUM(cost) AS cost, COUNT(*) FILTER (WHERE ts>=?) AS today_n, SUM(CASE WHEN ts>=? THEN cost END) AS today_cost FROM coach_calls",
        (midnight, midnight),
    )[0]
    out: dict = {
        "generating": job["running"],
        "stage": job["stage"],
        "building_next": job["running"] and job["next"],
        "error": job["error"],
        "writing_story": job["story"],
        "started": job["started"],
        "plan": None,
        "steps": [],
        "milestones": [],
        "history": [],
        "notes": [],
        "next_ready": bool(_q("SELECT id FROM plans WHERE status='next'")),
        "coach_model": COACH_MODEL,
        "alphabet": alphabet_status(),
        "levels": {k: v for k, v in lv.items() if k != "stars"},
        "ai_quota": limits.ai_quota(),
        "usage": {
            "calls": use["n"] or 0,
            "cost": round(use["cost"] or 0, 4),
            "today_calls": use["today_n"] or 0,
            "today_cost": round(use["today_cost"] or 0, 4),
        },
    }
    if plan:
        raw = json.loads(plan["raw"] or "{}")
        new_answers = _q("SELECT COUNT(*) AS n FROM units WHERE ts>=?", (plan["ts"],))[0]["n"]
        out["plan"] = {
            k: plan[k]
            for k in ("id", "ts", "status", "source", "model", "diagnosis", "headline", "reason", "error", "done_ts")
        } | {
            "has_story": bool(plan.get("story")),
            "new_answers": new_answers,
            "stale": plan["status"] == "active" and new_answers >= STALE_UNITS,
            "findings": raw.get("findings") or [],
            "strengths": raw.get("strengths") or [],
            "unknown": raw.get("unknown") or [],
            "too_advanced": raw.get("too_advanced") or [],
            "pace": raw.get("pace"),
            "calls": _calls(plan["id"]),
        }
        out["steps"] = [_step_view(s) for s in _steps(plan["id"])]
        out["notes"] = _q(
            f"SELECT id, ts, step_id, kind, text FROM coach_notes WHERE plan_id=? AND {VISIBLE_NOTES} ORDER BY id DESC LIMIT 30",
            (plan["id"],),
        )
    for m in _q(
        "SELECT * FROM milestones WHERE status IN ('active','achieved') ORDER BY status='achieved', id DESC LIMIT 20"
    ):
        c = json.loads(m["criterion"])
        out["milestones"].append(
            {k: m[k] for k in ("id", "ts", "title", "why", "status", "done_ts")}
            | {"criterion": c, **milestone_progress(c, lv)}
        )
    for p in _q(
        "SELECT id, ts, status, source, diagnosis, headline, done_ts FROM plans WHERE status!='next' ORDER BY id DESC LIMIT 12"
    ):
        st = _q("SELECT status FROM steps WHERE plan_id=?", (p["id"],))
        out["history"].append(
            {
                **p,
                "steps": len(st),
                "done": sum(1 for s in st if s["status"] == "done"),
                "skipped": sum(1 for s in st if s["status"] == "skipped"),
            }
        )
    return out


def step_state(step_id: int) -> dict | None:
    s = _step(step_id)
    if not s:
        return None
    plan = _plan_row(s["plan_id"])
    steps = _steps(plan["id"])
    nxt = next((x for x in steps if x["status"] == "open" and x["id"] != step_id), None)
    if not nxt and plan["status"] != "active":
        cur = _plan_row()
        nxt = next((x for x in _steps(cur["id"]) if x["status"] == "open"), None) if cur else None
    job = _job()
    return {
        "step": _step_view(s),
        "plan": {"id": plan["id"], "status": plan["status"]},
        "count": len(steps),
        "done": sum(1 for x in steps if x["status"] != "open"),
        "next": _step_view(nxt) if nxt else None,
        "generating": job["running"],
        "stage": job["stage"],
    }
