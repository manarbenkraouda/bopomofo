"""Levels: a guided path through the practice modes, with exercises that unlock.

A new learner sees few exercises. More exercises unlock when the learner proves what the level teaches. The proof uses
tests only (first try, no help, not in learn mode): accuracy over the last tests, answer speed, and right answers on
more than one day. Practice time alone never unlocks anything, and a lucky guess cannot unlock anything.

Stars per item (a symbol or a tone) and per exercise:
  ★    seen: tested at least once, or LEARN_REPS right repetitions.
  ★★   accurate: at least min_tests tests, and min_acc percent right in the last "window" tests.
  ★★★  known: ★★, the median time of the right answers in the window at or below the speed limit of the exercise
       (exercises without a timer use accuracy only), and right answers on at least "days" different days (MIN_DAYS, or
       ALPHABET_DAYS for the alphabet exercises of levels 1 and 2).
A level unlocks when every goal of the level before it is met. Unlocks are permanent. When a known item drops (accuracy
under DROP_ACC, or slower than DROP_SLOW x the limit), the learner gets a notice and the coach adds a review step.

Cost: the stars come from one summary row per exercise and item (level_items: counts, right days, and the last tests).
Each answer updates only the rows of the items it tests, in the transaction that saves it (record()). So saving an
answer and checking the level do not read the history, and the cost stays the same after years of practice. The
history is read once per user, to build the summaries (rebuild()).
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass

from . import db
from .numbers import BANDS, band as number_band
from .zhuyin import BOPOMOFO, RULES, SYMS

INITIALS, FINALS, MEDIALS = SYMS[:21], SYMS[21:34], SYMS[34:]
LEARN_REPS = 10  # right repetitions of a new item before the tests from memory start (the coach uses it too)
MIN_DAYS = 2
DROP_ACC = 80
DROP_SLOW = 1.25
SHARE = 0.9  # the level 3 goal over the 37 symbols needs 90% of them (34)
# The alphabet levels (1 Read, 2 Write) ask less, so a learner who knows the alphabet moves on in one short session:
# 80% of the symbols (30 of 37), each with 3 tests at 80% right, on one day, and a slower speed limit.
ALPHABET_SHARE = 0.8
ALPHABET_DAYS = 1
CHAPTER_SHARE = 0.8  # a chapter of level 1 opens when 80% of the chapter before it is accurate (★★)


@dataclass(frozen=True)
class Spec:
    """How one exercise measures an item. ms: speed limit of a right answer, None = no timer."""

    area: str
    mode: str | None
    kinds: tuple[str, ...]
    ms: int | None
    window: int
    min_tests: int
    min_acc: int
    days: int = MIN_DAYS


# Every exercise of the app: label, link, and how it measures (None: a study screen without answers).
# Speed limits are first estimates, not calibrated on real answers yet.
EXERCISES: dict[str, tuple[str, str, Spec | None]] = {
    "symbols": ("Symbols", "/symbols", None),
    "reading": ("Reading", "/reading", Spec("reading", None, ("symbol",), 5000, 10, 3, 80, ALPHABET_DAYS)),
    "recognize": ("Recognize", "/recognize", Spec("recognize", None, ("symbol",), 4000, 10, 3, 80, ALPHABET_DAYS)),
    "listening/tone": ("Tone quiz", "/listening?quiz=tone", Spec("listening", "tone", ("tone",), 4000, 20, 10, 90)),
    "dictation": ("Dictation", "/dictation", Spec("dictation", None, ("symbol",), None, 10, 3, 80, ALPHABET_DAYS)),
    "writing/symbol": (
        "Write symbols",
        "/writing?mode=symbol",
        Spec("writing", "symbol", ("symbol",), None, 10, 3, 80, ALPHABET_DAYS),
    ),
    "listening/zhuyin": (
        "Bopomofo quiz",
        "/listening?quiz=zhuyin",
        Spec("listening", "zhuyin", ("initial", "final", "tone"), 4000, 20, 10, 90),
    ),
    "writing/syllable": (
        "Write syllables",
        "/writing?mode=syllable",
        Spec("writing", "syllable", ("symbol", "tone"), None, 10, 5, 90),
    ),
    "speaking/syllable": (
        "Say syllables",
        "/speaking?source=syllable",
        Spec("speaking", "syllable", ("tone", "initial", "final"), None, 10, 5, 85),
    ),
    # Tone rules (3-3, 不, 一): the written Bopomofo keeps the dictionary tone, so these are learned before sentences.
    "listening/rule": ("Tone rules", "/listening?quiz=rule", Spec("listening", "rule", ("sandhi",), 6000, 10, 6, 90)),
    "speaking/rule": (
        "Say tone rules",
        "/speaking?source=rule",
        Spec("speaking", "rule", ("sandhi",), None, 10, 5, 85),
    ),
    "speaking/sentence": (
        "Say sentences",
        "/speaking?source=sentence",
        Spec("speaking", "sentence", ("tone", "initial", "final"), None, 10, 5, 85),
    ),
    "writing/word": ("Write words", "/writing?mode=word", Spec("writing", "word", ("symbol", "tone"), None, 10, 5, 90)),
    # The words of the learner's own sentences, said one at a time.
    "speaking/word": (
        "Say words",
        "/speaking?source=word",
        Spec("speaking", "word", ("tone", "initial", "final"), None, 10, 5, 85),
    ),
    "sentences": ("Sentences", "/sentences", None),
    "speaking/custom": (
        "Free speaking",
        "/speaking?source=custom",
        Spec("speaking", "custom", ("tone", "initial", "final"), None, 10, 5, 85),
    ),
    # Numbers need no Bopomofo: the learner hears or sees digits. Items: the size bands (num:0-10, num:100-999, ...).
    "numbers/listen": (
        "Hear numbers",
        "/numbers?mode=listen",
        Spec("numbers", "listen", ("number",), 6000, 20, 10, 90),
    ),
    "numbers/speak": (
        "Say numbers",
        "/numbers?mode=speak",
        Spec("numbers", "speak", ("number",), None, 10, 5, 85),
    ),
    # Traditional characters: see a character or word and pick its meaning. Items: char:<the word shown>.
    "characters": ("Characters", "/characters", Spec("characters", None, ("char",), 6000, 10, 5, 85)),
}
TONES4 = ["tone:1", "tone:2", "tone:3", "tone:4"]
TONES5 = [*TONES4, "tone:5"]
RULE_ITEMS = ["rule:" + r for r in RULES]
NEED_SYMS = math.ceil(SHARE * len(SYMS))
NEED_ALPHABET = math.ceil(ALPHABET_SHARE * len(SYMS))  # 30

# The unlock tree. A level opens its exercises; its goals open the next level.
LEVELS: list[dict] = [
    {
        "n": 1,
        "key": "alphabet",
        "title": "Read the alphabet",
        # Characters open here too: the choices are English meanings, so the exercise needs no Bopomofo.
        "opens": ["symbols", "reading", "recognize", "listening/tone", "numbers/listen", "numbers/speak", "characters"],
        "about": "Learn the 37 symbols by sight, train your ear on the four tones, and learn the numbers and first characters.",
        "goals": [
            {
                "key": "read",
                "label": "Read the symbols",
                "items": list(SYMS),
                "modes": ["reading", "recognize"],
                "need": NEED_ALPHABET,
            }
        ],
    },
    {
        "n": 2,
        "key": "write",
        "title": "Write the alphabet",
        "opens": ["dictation", "writing/symbol"],
        "about": "Hear a symbol and write it by hand.",
        "goals": [
            {
                "key": "write",
                "label": "Write the symbols",
                "items": list(SYMS),
                "modes": ["dictation", "writing/symbol"],
                "need": NEED_ALPHABET,
            }
        ],
    },
    {
        "n": 3,
        "key": "syllables",
        "title": "Syllables",
        "opens": ["listening/zhuyin", "writing/syllable", "speaking/syllable", "listening/rule", "speaking/rule"],
        "about": "Put the symbols together: hear, write, and say whole syllables. Learn the tone rules: some tones change in words.",
        "goals": [
            {
                "key": "sounds",
                "label": "Know the sounds in syllables",
                "items": list(SYMS),
                "modes": ["listening/zhuyin", "writing/syllable", "speaking/syllable"],
                "need": NEED_SYMS,
            },
            {"key": "tones", "label": "Hear the four tones", "items": TONES4, "modes": ["listening/tone"], "need": 4},
            {
                "key": "rules",
                "label": "Know the tone rules",
                "items": RULE_ITEMS,
                "modes": ["listening/rule", "speaking/rule"],
                "need": len(RULE_ITEMS),
            },
        ],
    },
    {
        "n": 4,
        "key": "sentences",
        "title": "Words and sentences",
        "opens": ["speaking/sentence", "speaking/word", "writing/word", "sentences"],
        "about": "Say whole sentences and their words, with every tone, and write words.",
        "goals": [
            {
                "key": "speak",
                "label": "Say the five tones in sentences",
                "items": TONES5,
                "modes": ["speaking/sentence"],
                "need": 5,
            }
        ],
    },
    {
        "n": 5,
        "key": "free",
        "title": "Free speaking",
        "opens": ["speaking/custom"],
        "about": "Say anything you want and get it checked.",
        "goals": [],
    },
]
MAX_LEVEL = len(LEVELS)
# The alphabet of level 1 comes in chapters. A chapter opens when 80% of the chapter before it is accurate (★★) by sight.
CHAPTERS = [("initials", "Initials", INITIALS), ("medials", "Medials", MEDIALS), ("finals", "Finals", FINALS)]
CHAPTER_MODES = ["reading", "recognize"]
# Learners who said they read Bopomofo, or who passed the alphabet part of the placement test (placement.py), skip the
# "two days" rule for the alphabet: accuracy and speed still count.
PLACEMENT_MODES = {"reading", "recognize", "dictation", "writing/symbol"}

# Coach step types and the exercise each one needs. speak_sounds depends on its source.
STEP_EXERCISE = {
    "read_symbols": "reading",
    "recognize_symbols": "recognize",
    "listen_tones": "listening/tone",
    "write_symbols": "dictation",
    "listen_sounds": "listening/zhuyin",
    "write_syllables": "writing/syllable",
    "speak_sentences": "speaking/sentence",
    "tone_rules": "listening/rule",
    "numbers": "numbers/listen",
    "characters": "characters",
}


def step_exercise(step_type: str, params: dict | None = None) -> str:
    """Map a coach step and its variant to the exercise needed to run it."""
    if step_type == "speak_sounds":
        src = (params or {}).get("source")
        return "speaking/" + (src if src in ("sentence", "word") else "syllable")
    if step_type == "tone_rules":
        return "speaking/rule" if (params or {}).get("mode") == "speak" else "listening/rule"
    if step_type == "numbers":
        return "numbers/speak" if (params or {}).get("mode") == "speak" else "numbers/listen"
    return STEP_EXERCISE.get(step_type, "")


def exercise_of(href: str) -> str | None:
    """The exercise a link opens (/listening?quiz=tone&tones=1 -> listening/tone). None for other screens."""
    path, _, query = (href or "").partition("?")
    q = dict(p.partition("=")[::2] for p in query.split("&") if p)
    if path == "/listening":
        return {"zhuyin": "listening/zhuyin", "rule": "listening/rule"}.get(q.get("quiz", ""), "listening/tone")
    if path == "/speaking":
        return "speaking/" + (
            q.get("source")
            if q.get("source") in ("syllable", "word", "custom", "rule")
            else "custom"
            if q.get("text")
            else "sentence"
        )
    if path == "/writing":
        return "writing/" + (q.get("mode") if q.get("mode") in ("symbol", "word") else "syllable")
    if path == "/numbers":
        return "numbers/" + ("speak" if q.get("mode") == "speak" else "listen")
    key = path.strip("/")
    return key if key in EXERCISES else None


# ---------- what is open: read from the saved unlocks only (cheap) ----------


def _unlock_keys() -> dict[str, float]:
    if not db.current_user():
        return {}
    with db.conn() as c:
        return {r["key"]: r["ts"] for r in c.execute("SELECT key, ts FROM level_unlocks").fetchall()}


def _level_of(keys) -> int:
    n = 1
    while n < MAX_LEVEL and f"level:{n + 1}" in keys:
        n += 1
    return n


def manual_level() -> int:
    """The level up to which the learner opened the exercises in Settings (settings "open_level"), or 1.
    It opens exercises only. The earned level, the goals, the stars, and the milestones still follow the answers."""
    if not db.current_user():
        return 1
    v = db.get_settings().get("open_level")
    return min(max(v, 1), MAX_LEVEL) if isinstance(v, int) and not isinstance(v, bool) else 1


def _open_symbols(keys, level: int) -> str:
    if level >= 2:
        return SYMS
    out = ""
    for i, (k, _, syms) in enumerate(CHAPTERS):
        if i == 0 or f"chapter:{k}" in keys:
            out += syms
        else:
            break
    return out


def opened(keys: dict | None = None, manual: int | None = None) -> dict:
    """The earned level, the open level, the open exercises, and the open symbols.
    level: from the saved unlocks only. open_level: the higher of level and the Settings override (manual_level)."""
    keys = _unlock_keys() if keys is None else keys
    level = _level_of(keys)
    top = max(level, manual_level() if manual is None else manual)
    ex = [e for lv in LEVELS[:top] for e in lv["opens"]]
    return {"level": level, "open_level": top, "exercises": ex, "symbols": _open_symbols(keys, top)}


def is_open(exercise: str | None, op: dict | None = None) -> bool:
    """Check an exercise against saved unlocks. Non-exercise pages are always allowed."""
    return not exercise or exercise in (op or opened())["exercises"]


def allowed_types(op: dict | None = None) -> list[str]:
    """Return coach step types that the learner's open exercises can support."""
    op = op or opened()
    types = [t for t, e in STEP_EXERCISE.items() if e in op["exercises"]]
    if any(e in op["exercises"] for e in ("speaking/syllable", "speaking/word", "speaking/sentence")):
        types.append("speak_sounds")
    return types


def step_allowed(step_type: str, params: dict | None, op: dict | None = None) -> bool:
    """Check both the coach step type and its variant against the learner's unlocks."""
    return is_open(step_exercise(step_type, params), op)


def milestone_exercises(c: dict) -> list[str]:
    """The exercises that can move a milestone (coach criterion: area, unit)."""
    a, u = c.get("area"), c.get("unit")
    if u in ("alphabet", "level"):
        return []
    if a == "listening":
        if u == "sandhi":
            return ["listening/rule"]
        return ["listening/zhuyin"] if u in ("initial", "final") else ["listening/tone", "listening/zhuyin"]
    if a == "writing":
        return ["writing/symbol", "writing/syllable", "writing/word"]
    if a == "speaking":
        if u == "sandhi":
            return ["speaking/rule", "speaking/sentence", "speaking/word", "speaking/custom"]
        if u == "score":
            return ["speaking/sentence"]
        return ["speaking/syllable", "speaking/word", "speaking/sentence", "speaking/custom"]
    if a == "numbers":
        return ["numbers/listen", "numbers/speak"]
    return [a] if a in EXERCISES else []


def milestone_allowed(c: dict, op: dict | None = None) -> bool:
    """Allow a milestone when it has no exercise filter or at least one measured exercise is open."""
    ex = milestone_exercises(c)
    op = op or opened()
    return not ex or any(e in op["exercises"] for e in ex)


# ---------- stars ----------


def _median(v: list) -> float | None:
    """Return the true median of the supplied times, or None for an empty list."""
    v = sorted(x for x in v if x is not None)
    if not v:
        return None
    m = len(v) // 2
    return v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2


def item_stars(
    tests: list[tuple[bool, int | None, str]],
    reps: int,
    spec: Spec,
    placement: bool = False,
    n_tests: int | None = None,
    right_days: int | None = None,
) -> dict:
    """Stars of one item in one exercise. tests: (right, ms, day) for each test, oldest first (at least the last "window" tests).
    reps: right answers, tests or not. n_tests and right_days: the counts over all tests, when "tests" holds only the last ones."""
    last = tests[-spec.window :]
    n_last = len(last)
    right = [t for t in last if t[0]]
    acc = round(100 * len(right) / n_last) if n_last else None
    ms = _median([t[1] for t in right])
    days = len({t[2] for t in tests if t[0]}) if right_days is None else right_days
    n = len(tests) if n_tests is None else n_tests
    stars = 1 if n or reps >= LEARN_REPS else 0
    accurate = n >= spec.min_tests and acc is not None and acc >= spec.min_acc
    if accurate:
        stars = 2
        fast = spec.ms is None or (
            ms is not None
            and sum(1 for t in right if t[1] is not None) >= min(spec.min_tests, len(right))
            and ms <= spec.ms
        )
        if fast and (days >= spec.days or placement):
            stars = 3
    slow = spec.ms is not None and ms is not None and ms > spec.ms * DROP_SLOW
    return {
        "stars": stars,
        "tests": n,
        "acc": acc,
        "ms": round(ms) if ms is not None else None,
        "days": days,
        "reps": reps,
        "dropped": bool(n_last) and ((acc or 0) < DROP_ACC or slow),
    }


def _keys_of(kind: str, expected: str) -> list[str]:
    if kind == "tone":
        return ["tone:" + expected] if expected in ("1", "2", "3", "4", "5") else []
    if kind == "sandhi":
        return ["rule:" + expected] if expected in RULES else []
    if kind == "number":
        # One item per size band: single numbers repeat too rarely to earn stars.
        return ["num:" + number_band(int(expected))] if expected.isdigit() else []
    if kind == "char":
        return ["char:" + expected] if expected else []
    return list(dict.fromkeys(ch for ch in expected if ch in BOPOMOFO))


def _exercise_key(area: str, mode: str | None) -> str | None:
    if area in ("reading", "recognize", "dictation", "characters"):
        return area
    key = f"{area}/{mode}"
    return key if key in EXERCISES and EXERCISES[key][2] else None


def _is_learn(details) -> bool:
    """Learn mode (the answer is shown first): not a test. Same values as the "learn" flag in events.details."""
    if isinstance(details, str):
        try:
            details = json.loads(details or "{}")
        except ValueError:
            return False
    v = (details or {}).get("learn") if isinstance(details, dict) else None
    return v not in (None, False, 0, "", "false", "0")


def _contribs(area: str, mode: str | None, kind: str, expected, ok, help_, try_n, learn: bool):
    """What one unit of an answer adds: (exercise, item, test, right) for each item it measures.
    A test: first try, not in learn mode. A right test: a right test without help."""
    if ok is None or expected in (None, ""):
        return []
    ex = _exercise_key(area, mode)
    if not ex or kind not in EXERCISES[ex][2].kinds:
        return []
    test = int(try_n or 0) == 0 and not learn
    right = test and bool(ok) and not help_
    return [(ex, item, test, right) for item in _keys_of(kind, str(expected))]


def _push(last: list, entry: list, window: int) -> None:
    """Add a test to the last tests (oldest first) and keep the last "window". Answers come in time order, so this is an
    append; an older answer (a late sync) goes to its place."""
    if not last or (last[-1][0], last[-1][1]) <= (entry[0], entry[1]):
        last.append(entry)
    else:
        i = len(last)
        while i and (last[i - 1][0], last[i - 1][1]) > (entry[0], entry[1]):
            i -= 1
        last.insert(i, entry)
    del last[:-window]


def _values(n_rows: int, n_cols: int, casts: tuple[str, ...] = ()) -> str:
    row = "(" + ",".join("?" + (casts[i] if i < len(casts) else "") for i in range(n_cols)) + ")"
    return ",".join([row] * n_rows)


def _built(c) -> bool:
    """True when the summaries of this user hold the whole history. The first call builds them (once per user)."""
    if c.execute("SELECT 1 FROM level_built").fetchone():
        return True
    # The row lock makes a second request wait here, then see the built summaries.
    if c.execute(
        "INSERT INTO level_built(ts) VALUES (?) ON CONFLICT DO NOTHING RETURNING ts", (time.time(),)
    ).fetchone():
        rebuild(c)
    return False


_HISTORY_SQL = (
    "SELECT u.area, u.mode, u.kind, u.expected, u.ok, u.help, u.try_n, u.day, u.ts, u.event_id, e.ms,"
    " COALESCE(e.details::jsonb ->> 'learn', 'false') NOT IN ('false', '0', '') AS learn"
    " FROM units u JOIN events e ON e.id = u.event_id WHERE u.ok IS NOT NULL"
    " AND u.kind IN ('symbol','tone','initial','final','sandhi','number','char')"
    " ORDER BY u.ts, u.id"
)


def rebuild(c) -> None:
    """Build the summaries of the current user from the whole history (one pass, in time order). Runs once per user,
    after the migration; after that, record() keeps them up to date with each answer."""
    items: dict[tuple, dict] = {}
    days: set[tuple] = set()
    for r in c.execute(_HISTORY_SQL).fetchall():
        for ex, item, test, right in _contribs(
            r["area"], r["mode"], r["kind"], r["expected"], r["ok"], r["help"], r["try_n"], r["learn"]
        ):
            s = items.setdefault((ex, item), {"reps": 0, "tests": 0, "last": []})
            s["reps"] += int(bool(r["ok"]))
            if test:
                s["tests"] += 1
                _push(s["last"], [r["ts"], r["event_id"], right, r["ms"], r["day"]], EXERCISES[ex][2].window)
            if right:
                days.add((ex, item, r["day"]))
    n_days: dict[tuple, int] = {}
    for ex, item, _ in days:
        n_days[(ex, item)] = n_days.get((ex, item), 0) + 1
    c.execute("DELETE FROM level_items")
    c.execute("DELETE FROM level_item_days")
    rows = [
        (ex, item, s["reps"], s["tests"], n_days.get((ex, item), 0), json.dumps(s["last"], ensure_ascii=False))
        for (ex, item), s in items.items()
    ]
    for i in range(0, len(rows), 500):
        part = rows[i : i + 500]
        c.execute(
            "INSERT INTO level_items(exercise, item, reps, tests, right_days, last) VALUES "
            + _values(len(part), 6, ("", "", "::int", "::int", "::int", "::jsonb")),
            tuple(v for r in part for v in r),
        )
    day_rows = sorted(days)
    for i in range(0, len(day_rows), 1000):
        part = day_rows[i : i + 1000]
        c.execute(
            "INSERT INTO level_item_days(exercise, item, day) VALUES " + _values(len(part), 3),
            tuple(v for r in part for v in r),
        )


def record(c, event_id: int, ts: float, day: str, area: str, mode: str | None, ms, details, units: list[dict]) -> None:
    """Update the summaries with one answer, in the transaction that saves it (db.add_event). The cost depends on the
    size of the answer only: the history is never read again. units: kind, expected, ok, help, try_n."""
    if not db.current_user() or not _built(c):
        return  # not built: the build just read the whole history, this answer included
    learn = _is_learn(details)
    add: dict[tuple, dict] = {}
    for u in units:
        for ex, item, test, right in _contribs(
            area, mode, u["kind"], u["expected"], u["ok"], u["help"], u["try_n"], learn
        ):
            a = add.setdefault((ex, item), {"reps": 0, "tests": [], "right": False})
            a["reps"] += int(bool(u["ok"]))
            if test:
                a["tests"].append([ts, event_id, right, ms, day])
            a["right"] = a["right"] or right
    if not add:
        return
    keys = list(add)
    flat = tuple(v for k in keys for v in k)
    # Create the missing rows, then lock the rows of this answer: two answers at the same time update them one after the other.
    c.execute(
        "INSERT INTO level_items(exercise, item) VALUES " + _values(len(keys), 2) + " ON CONFLICT DO NOTHING", flat
    )
    rows = {
        (r["exercise"], r["item"]): r
        for r in c.execute(
            "SELECT exercise, item, reps, tests, right_days, last FROM level_items WHERE (exercise, item) IN (VALUES "
            + _values(len(keys), 2)
            + ") FOR UPDATE",
            flat,
        ).fetchall()
    }
    right_keys = [(ex, item, day) for (ex, item), a in add.items() if a["right"]]
    new_days: set[tuple] = set()
    if right_keys:
        new_days = {
            (r["exercise"], r["item"])
            for r in c.execute(
                "INSERT INTO level_item_days(exercise, item, day) VALUES "
                + _values(len(right_keys), 3)
                + " ON CONFLICT DO NOTHING RETURNING exercise, item",
                tuple(v for k in right_keys for v in k),
            ).fetchall()
        }
    out = []
    for k, a in add.items():
        r = rows[k]
        last = r["last"]
        last = json.loads(last) if isinstance(last, str) else list(last or [])
        for t in a["tests"]:
            _push(last, t, EXERCISES[k[0]][2].window)
        out.append(
            (
                k[0],
                k[1],
                r["reps"] + a["reps"],
                r["tests"] + len(a["tests"]),
                r["right_days"] + (k in new_days),
                json.dumps(last, ensure_ascii=False),
            )
        )
    c.execute(
        "UPDATE level_items AS i SET reps = v.reps, tests = v.tests, right_days = v.right_days, last = v.last FROM (VALUES "
        + _values(len(out), 6, ("", "", "::int", "::int", "::int", "::jsonb"))
        + ") AS v(exercise, item, reps, tests, right_days, last) WHERE i.exercise = v.exercise AND i.item = v.item",
        tuple(v for r in out for v in r),
    )


def all_stars(placement: bool = False) -> dict[str, dict[str, dict]]:
    """Stars per exercise and per item, from the summaries: at most one row per exercise and item, whatever the history."""
    with db.conn() as c:
        _built(c)
        rows = c.execute("SELECT exercise, item, reps, tests, right_days, last FROM level_items").fetchall()
    out: dict[str, dict[str, dict]] = {}
    for r in sorted(rows, key=lambda r: (r["exercise"], r["item"])):  # alphabet order (code points) for stable notices
        ex = r["exercise"]
        if ex not in EXERCISES or not EXERCISES[ex][2]:
            continue
        spec = EXERCISES[ex][2]
        last = r["last"]
        last = json.loads(last) if isinstance(last, str) else (last or [])
        tests = [(bool(t[2]), t[3], t[4]) for t in last]
        out.setdefault(ex, {})[r["item"]] = item_stars(
            tests, r["reps"], spec, placement and ex in PLACEMENT_MODES, n_tests=r["tests"], right_days=r["right_days"]
        )
    return out


def _best(stars: dict, item: str, modes: list[str]) -> int:
    return max((stars.get(m, {}).get(item, {}).get("stars", 0) for m in modes), default=0)


def _goal_view(g: dict, stars: dict) -> dict:
    per = {i: _best(stars, i, g["modes"]) for i in g["items"]}
    done = sum(1 for v in per.values() if v >= 3)
    return {
        "key": g["key"],
        "label": g["label"],
        "modes": g["modes"],
        "need": g["need"],
        "of": len(g["items"]),
        "done": done,
        "accurate": sum(1 for v in per.values() if v >= 2),
        "seen": sum(1 for v in per.values() if v >= 1),
        "met": done >= g["need"],
        "missing": [i for i, v in per.items() if v < 3][:40],
    }


def _chapter_done(stars: dict, syms: str) -> bool:
    return sum(1 for s in syms if _best(stars, s, CHAPTER_MODES) >= 2) >= math.ceil(CHAPTER_SHARE * len(syms))


def _placement() -> bool:
    try:
        s = db.get_settings()
        return s.get("bopomofo") == "reads" or bool(
            ((s.get("placement") or {}).get("result") or {}).get("alphabet_known")
        )
    except Exception:  # noqa: BLE001
        return False


# ---------- saving unlocks, drops, and notices ----------


def _notice(c, kind: str, key: str, title: str, text: str) -> None:
    c.execute(
        "INSERT INTO level_notices(ts, kind, key, title, text) VALUES (?,?,?,?,?)",
        (time.time(), kind, key, title, text),
    )


def _label(item: str) -> str:
    if item.startswith("rule:"):
        return RULES[item[5:]]["name"] if item[5:] in RULES else item
    if item.startswith("num:"):
        return "numbers " + item[4:]
    if item.startswith("char:"):
        return item[5:]
    return ("neutral tone" if item == "tone:5" else "tone " + item[5:]) if item.startswith("tone:") else item


def check() -> dict:
    """Compute the stars, save new unlocks (permanent), find known items that dropped, and write notices. Returns status()."""
    if not db.current_user():
        return status_from({}, {}, [])
    stars = all_stars(_placement())
    keys = _unlock_keys()
    now = time.time()
    with db.conn() as c:
        # Levels: the goals of level n open level n+1. Old history can open several levels at once: one notice for the last one.
        new_levels = []
        while True:
            lv = _level_of(keys)
            if lv >= MAX_LEVEL or not all(_goal_view(g, stars)["met"] for g in LEVELS[lv - 1]["goals"]):
                break
            keys[f"level:{lv + 1}"] = now
            new_levels.append(lv + 1)
            c.execute(
                "INSERT INTO level_unlocks(key, ts) VALUES (?, ?) ON CONFLICT DO NOTHING", (f"level:{lv + 1}", now)
            )
        if new_levels:
            top = LEVELS[new_levels[-1] - 1]
            names = ", ".join(EXERCISES[e][0] for n in new_levels for e in LEVELS[n - 1]["opens"])
            _notice(c, "unlock", f"level:{top['n']}", f"Level {top['n']}: {top['title']}", f"New: {names}.")
        # Chapters of the alphabet (level 1 only; level 2 opens every symbol).
        if _level_of(keys) == 1:
            for i in range(1, len(CHAPTERS)):
                k, name, _ = CHAPTERS[i]
                if f"chapter:{k}" in keys:
                    continue
                if not _chapter_done(stars, CHAPTERS[i - 1][2]):
                    break
                keys[f"chapter:{k}"] = now
                c.execute(
                    "INSERT INTO level_unlocks(key, ts) VALUES (?, ?) ON CONFLICT DO NOTHING", (f"chapter:{k}", now)
                )
                _notice(
                    c,
                    "unlock",
                    f"chapter:{k}",
                    f"New symbols: {name}",
                    "New symbols: " + " ".join(CHAPTERS[i][2]) + ".",
                )
        # Known items: remember them, and notice when one drops or comes back.
        marks = {
            (r["exercise"], r["item"]): r
            for r in c.execute("SELECT exercise, item, dropped_ts FROM level_marks").fetchall()
        }
        dropped, back = {}, {}
        for ex, items in stars.items():
            for item, s in items.items():
                m = marks.get((ex, item))
                if s["stars"] >= 3:
                    if not m:
                        c.execute(
                            "INSERT INTO level_marks(exercise, item, known_ts) VALUES (?,?,?) ON CONFLICT DO NOTHING",
                            (ex, item, now),
                        )
                    elif m["dropped_ts"]:
                        c.execute("UPDATE level_marks SET dropped_ts=NULL WHERE exercise=? AND item=?", (ex, item))
                        back.setdefault(ex, []).append(item)
                elif m and not m["dropped_ts"] and s["dropped"]:
                    c.execute("UPDATE level_marks SET dropped_ts=? WHERE exercise=? AND item=?", (now, ex, item))
                    dropped.setdefault(ex, []).append(item)
        for ex, items in dropped.items():
            _notice(
                c,
                "drop",
                ex,
                f"{EXERCISES[ex][0]}: needs a review",
                " ".join(_label(i) for i in items)
                + (" is" if len(items) == 1 else " are")
                + " less sure than before. Bobo adds a review to your next plan.",
            )
        for ex, items in back.items():
            _notice(
                c,
                "back",
                ex,
                f"{EXERCISES[ex][0]}: back on track",
                " ".join(_label(i) for i in items) + " known again.",
            )
        drops = [
            dict(r)
            for r in c.execute(
                "SELECT exercise, item, dropped_ts FROM level_marks WHERE dropped_ts IS NOT NULL ORDER BY dropped_ts"
            ).fetchall()
        ]
    return status_from(stars, keys, drops)


def status_from(stars: dict, keys: dict, drops: list[dict]) -> dict:
    """Build the level response from supplied stars, saved unlocks, and review notices."""
    op = opened(keys)
    lv = op["level"]
    levels = []
    for L in LEVELS:
        unlocked = L["n"] <= lv
        goals = [_goal_view(g, stars) for g in L["goals"]]
        need = sum(g["need"] for g in goals)
        levels.append(
            {
                "n": L["n"],
                "key": L["key"],
                "title": L["title"],
                "about": L["about"],
                "unlocked": unlocked,
                "unlocked_ts": keys.get(f"level:{L['n']}") if L["n"] > 1 else None,
                # open: its exercises can be practiced, because the learner earned the level or opened it in Settings.
                "open": L["n"] <= op["open_level"],
                "current": L["n"] == lv,
                "opens": [{"key": e, "label": EXERCISES[e][0], "href": EXERCISES[e][1]} for e in L["opens"]],
                "goals": goals,
                "progress": round(100 * sum(min(g["done"], g["need"]) for g in goals) / need) if need else 100,
            }
        )
    chapters = [
        {
            "key": k,
            "title": t,
            "symbols": s,
            "open": s in op["symbols"],
            "accurate": sum(1 for x in s if _best(stars, x, CHAPTER_MODES) >= 2),
            "of": len(s),
        }
        for k, t, s in CHAPTERS
    ]
    return {
        "level": lv,
        "title": LEVELS[lv - 1]["title"],
        "max_level": MAX_LEVEL,
        "open_level": op["open_level"],
        "levels": levels,
        "chapters": chapters,
        "exercises": op["exercises"],
        "symbols": op["symbols"],
        "step_types": allowed_types(op),
        "next": levels[lv] if lv < MAX_LEVEL else None,
        "drops": [d for d in drops if d["exercise"] in op["exercises"]],
        "stars": stars,
        "notices": notices(),
        "rules": {
            "learn_reps": LEARN_REPS,
            "min_days": MIN_DAYS,
            "drop_acc": DROP_ACC,
            "placement": _placement(),
            "speed_ms": {k: v[2].ms for k, v in EXERCISES.items() if v[2] and v[2].ms},
            "days": {k: v[2].days for k, v in EXERCISES.items() if v[2]},
            "min_acc": {k: v[2].min_acc for k, v in EXERCISES.items() if v[2]},
            "window": {k: v[2].window for k, v in EXERCISES.items() if v[2]},
            "min_tests": {k: v[2].min_tests for k, v in EXERCISES.items() if v[2]},
        },
    }


def status() -> dict:
    """Read only: the stars from the answers and the saved unlocks, without saving anything."""
    if not db.current_user():
        return status_from({}, {}, [])
    with db.conn() as c:
        drops = [
            dict(r)
            for r in c.execute(
                "SELECT exercise, item, dropped_ts FROM level_marks WHERE dropped_ts IS NOT NULL ORDER BY dropped_ts"
            ).fetchall()
        ]
    return status_from(all_stars(_placement()), _unlock_keys(), drops)


def notices(limit: int = 10) -> list[dict]:
    """Read the newest unseen level messages for this learner."""
    if not db.current_user():
        return []
    with db.conn() as c:
        return [
            dict(r)
            for r in c.execute(
                "SELECT id, ts, kind, key, title, text FROM level_notices WHERE NOT seen ORDER BY id LIMIT ?", (limit,)
            ).fetchall()
        ]


def mark_seen(ids: list[int]) -> None:
    """Mark only this learner's listed level notices as seen."""
    if not ids:
        return
    with db.conn() as c:
        c.execute(f"UPDATE level_notices SET seen=true WHERE id IN ({','.join('?' * len(ids))})", tuple(ids))


# ---------- for the coach ----------


def coach_view(st: dict) -> dict:
    """What the coach models get: the level, what is open, the next goals, and the known items that dropped."""
    nxt = st["next"]
    return {
        "level": st["level"],
        "of": st["max_level"],
        "title": st["title"],
        "open_exercises": st["exercises"],
        "locked_exercises": [e for e in EXERCISES if e not in st["exercises"]],
        "allowed_step_types": st["step_types"],
        "open_symbols": st["symbols"],
        "next_level": {
            "level": nxt["n"],
            "title": nxt["title"],
            "opens": [o["label"] for o in nxt["opens"]],
            "goals": [
                {
                    "goal": g["label"],
                    "known": g["done"],
                    "need": g["need"],
                    "accurate": g["accurate"],
                    "missing": g["missing"][:12],
                }
                for g in st["levels"][st["level"] - 1]["goals"]
            ],
        }
        if nxt
        else None,
        "dropped": [{"exercise": d["exercise"], "item": _label(d["item"])} for d in st["drops"]],
    }


REMEDY = {
    "reading": "read_symbols",
    "recognize": "recognize_symbols",
    "dictation": "write_symbols",
    "writing/symbol": "write_symbols",
    "listening/tone": "listen_tones",
    "listening/zhuyin": "listen_sounds",
    "writing/syllable": "write_syllables",
    "writing/word": "write_syllables",
    "speaking/syllable": "speak_sounds",
    "speaking/sentence": "speak_sounds",
    "speaking/word": "speak_sounds",
    "speaking/custom": "speak_sounds",
    "listening/rule": "tone_rules",
    "speaking/rule": "tone_rules",
    "numbers/listen": "numbers",
    "numbers/speak": "numbers",
    "characters": "characters",
}


def remediation(st: dict, limit: int = 2) -> list[dict]:
    """Review steps for known items that dropped, in open exercises. A rule of the app, like the alphabet steps."""
    by: dict[str, list[str]] = {}
    for d in st["drops"]:
        by.setdefault(d["exercise"], []).append(d["item"])
    out: list[dict] = []
    meta = {"finding_ids": [], "review": "Added by the level rule: a known item dropped.", "rule": "remediation"}
    for ex, items in by.items():
        t = REMEDY.get(ex)
        rp = {
            "source": {"speaking/sentence": "sentence", "speaking/word": "word"}.get(ex, "syllable"),
            "mode": "speak"
            if ex in ("speaking/rule", "numbers/speak")
            else "listen"
            if ex == "numbers/listen"
            else "quiz",
        }
        if not t or not step_allowed(t, rp, {"exercises": st["exercises"]}):
            continue
        tones = [int(i[5:]) for i in items if i.startswith("tone:")]
        rules = [i[5:] for i in items if i.startswith("rule:")]
        bands = [i[4:] for i in items if i.startswith("num:") and i[4:] in BANDS]
        chars = [i[5:] for i in items if i.startswith("char:")][:12]
        syms = [i for i in items if i in BOPOMOFO][:6]
        names = " ".join(_label(i) for i in items[:6])
        base = {
            "title": f"Review: {names}"[:80],
            "minutes": 4,
            "meta": dict(meta),
            "why": "You knew these well before. A short review brings them back.",
        }
        if t == "tone_rules" and rules:
            out.append({**base, "type": t, "params": {"rules": rules, "mode": rp["mode"]}, "target": 10})
        elif t == "numbers" and bands:
            out.append({**base, "type": t, "params": {"mode": rp["mode"], "bands": bands, "nums": []}, "target": 10})
        elif t == "characters" and chars:
            out.append({**base, "type": t, "params": {"chars": chars}, "target": max(8, 2 * len(chars))})
        elif t in ("read_symbols", "recognize_symbols", "write_symbols") and syms:
            out.append({**base, "type": t, "params": {"syms": syms}, "target": max(6, 2 * len(syms))})
        elif t == "listen_tones" and tones:
            tt = sorted(set([x for x in tones if x != 5] or [1]) | ({1, 4} if len(tones) < 2 else set()))[:4]
            out.append({**base, "type": t, "params": {"tones": tt}, "target": 15})
        elif t == "listen_sounds" and syms:
            out.append({**base, "type": t, "params": {"syms": syms}, "target": 12})
        elif t == "write_syllables" and (syms or tones):
            out.append({**base, "type": t, "params": {"tones": tones, "syms": syms}, "target": 10})
        elif t == "speak_sounds" and (syms or tones):
            unit = "tone" if tones else "initial" if syms[0] in INITIALS else "final"
            src = rp["source"] if rp["source"] != "syllable" else "sentence" if 5 in tones else "syllable"
            out.append(
                {
                    **base,
                    "type": t,
                    "params": {"unit": unit, "tones": tones, "syms": [] if tones else syms, "source": src},
                    "target": 10,
                }
            )
        if len(out) >= limit:
            break
    return out
