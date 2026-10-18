"""Levels: stars need accuracy, speed, and (from level 3) more than one day; unlocks are permanent; the coach and the stats see only open exercises.
No network calls."""

import json
import time

import pytest

from app import coach, db, levels, stats

DAY = 86400
REC = levels.EXERCISES["recognize"][2]
SYL = levels.EXERCISES["writing/syllable"][2]


@pytest.fixture()
def tmpdb(pg, monkeypatch):
    monkeypatch.setattr(coach.settings, "LIVE", False)
    monkeypatch.setattr(coach.settings, "ALPHABET_GATE", 0)  # the alphabet rule has its own test
    monkeypatch.setattr(coach.settings, "RULES_GATE", False)  # the tone rule gate has its own test


def answer(area, sym, ok, ms=1500, ts=None):
    db.add_event(
        {
            "area": area,
            "item": sym,
            "ok": ok,
            "first_try": ok,
            "ms": ms,
            "units": [{"kind": "symbol", "expected": sym, "actual": sym if ok else "?", "ok": ok}],
        },
        ts=ts,
    )


def know(syms, area="recognize", days=2, n=6):
    """Right, fast answers on several days: every symbol gets three stars."""
    for d in range(days):
        for s in syms:
            for _ in range(n // days):
                answer(area, s, True, ts=time.time() - (days - d) * DAY)


def fake(steps):
    def run(d, reason, run_id):
        return {
            "diagnosis": "test",
            "steps": [c for c in (coach.cleaning.clean_step(s, set()) for s in steps) if c],
            "milestones": None,
            "findings": [],
        }

    return run


def test_stars_need_enough_tests_speed_and_two_days_after_the_alphabet():
    today, yday = "2026-10-12", "2026-10-11"
    # The alphabet (levels 1 and 2): 3 tests at 80% right, fast, on one day.
    assert levels.item_stars([(True, 1000, today)] * 2, 2, REC)["stars"] == 1  # two lucky answers prove nothing
    assert levels.item_stars([(True, 1000, today)] * 3, 3, REC)["stars"] == 3  # one short session is enough
    assert levels.item_stars([(True, 1000, today)] * 4 + [(False, 1000, today)], 5, REC)["stars"] == 3  # 80% right
    assert levels.item_stars([(True, 1000, today)] * 3 + [(False, 1000, today)] * 2, 5, REC)["stars"] == 1  # 60% right
    slow = levels.item_stars([(True, 5500, today)] * 3, 3, REC)
    assert slow["stars"] == 2 and slow["dropped"]  # right but slow: not known
    guess = levels.item_stars([(True, 1000, yday)] * 3 + [(False, 1000, today)] * 3, 6, REC)
    assert guess["stars"] == 1 and guess["acc"] == 50
    assert levels.item_stars([], 0, REC)["stars"] == 0 and levels.item_stars([], levels.LEARN_REPS, REC)["stars"] == 1
    # From level 3: 5 tests at 90% right, on 2 days.
    assert levels.item_stars([(True, None, today)] * 3, 3, SYL)["stars"] == 1
    assert levels.item_stars([(True, None, today)] * 6, 6, SYL)["stars"] == 2  # accurate, one day only
    assert (
        levels.item_stars([(True, None, today)] * 6, 6, SYL, placement=True)["stars"] == 3
    )  # placement skips the day rule
    assert levels.item_stars([(True, None, yday)] * 3 + [(True, None, today)] * 3, 6, SYL)["stars"] == 3


def test_level_two_opens_after_one_short_session_on_most_of_the_alphabet(tmpdb):
    for s in levels.SYMS[: levels.NEED_ALPHABET - 1]:  # 29 symbols, 3 right answers each, today only
        for _ in range(3):
            answer("recognize", s, True)
    assert levels.check()["level"] == 1
    for _ in range(3):
        answer("reading", levels.SYMS[levels.NEED_ALPHABET - 1], True)  # the 30th symbol, in the other mode
    assert levels.NEED_ALPHABET == 30 and levels.check()["level"] == 2


def test_level_one_opens_the_alphabet_and_the_tones_only(tmpdb):
    st = levels.check()
    # Numbers and characters are open from level 1: they do not depend on the alphabet.
    assert st["level"] == 1 and st["exercises"] == [
        "symbols",
        "reading",
        "recognize",
        "listening/tone",
        "numbers/listen",
        "numbers/speak",
        "characters",
    ]
    assert st["symbols"] == levels.INITIALS and set(st["step_types"]) == {
        "read_symbols",
        "recognize_symbols",
        "listen_tones",
        "numbers",
        "characters",
    }
    assert coach.cleaning.clean_step({"type": "write_symbols", "syms": ["ㄅ"]}, set()) is None
    assert coach.cleaning.clean_step({"type": "speak_sounds", "unit": "tone", "tones": [3]}, set()) is None
    assert coach.cleaning.clean_step({"type": "listen_sounds", "syms": ["ㄅ"]}, set()) is None
    assert (
        coach.cleaning.clean_step({"type": "read_symbols", "syms": ["ㄚ"]}, set()) is None
    )  # a finals symbol: its chapter is closed
    assert coach.cleaning.clean_step({"type": "read_symbols", "syms": ["ㄚ", "ㄅ"]}, set())["params"]["syms"] == ["ㄅ"]
    assert coach.cleaning.clean_step({"type": "listen_tones", "tones": [2, 3]}, set())
    plan = coach.fallback.rules_plan(coach.digest.digest())
    assert plan["steps"] and all(levels.step_allowed(s["type"], s, levels.opened()) for s in plan["steps"])


def test_the_coach_never_plans_a_locked_exercise(tmpdb):
    def rogue(d, reason, run_id):  # a model that ignores the level rule
        assert d["overview"]["level"]["level"] == 1 and "dictation" in d["overview"]["level"]["locked_exercises"]
        steps = [
            {
                "type": "write_symbols",
                "title": "w",
                "why": "",
                "params": {"syms": ["ㄅ"]},
                "target": 5,
                "minutes": 5,
                "meta": {},
            },
            {
                "type": "listen_sounds",
                "title": "l",
                "why": "",
                "params": {"syms": ["ㄅ"]},
                "target": 5,
                "minutes": 5,
                "meta": {},
            },
            {
                "type": "listen_tones",
                "title": "t",
                "why": "",
                "params": {"tones": [2, 3]},
                "target": 5,
                "minutes": 5,
                "meta": {},
            },
        ]
        return {"diagnosis": "x", "steps": steps, "milestones": None, "findings": []}

    pid = coach.build("test", run_pipeline=rogue)
    assert [s["type"] for s in coach.state()["steps"]] == ["listen_tones"]
    assert json.loads(coach.store.plan(pid)["raw"])["level_rule"]["level"] == 1
    assert "Use only these step types: read_symbols, recognize_symbols, listen_tones" in coach.prompts.level_rule(
        levels.opened()
    )


def test_chapters_open_when_the_symbols_before_are_accurate(tmpdb):
    for s in levels.INITIALS:  # one day only: accurate (two stars) is enough for a chapter
        for _ in range(5):
            answer("reading", s, True)
    st = levels.check()
    assert st["level"] == 1 and st["symbols"] == levels.INITIALS + levels.MEDIALS
    assert [n["title"] for n in st["notices"]] == ["New symbols: Medials"]
    assert levels.check()["notices"] == st["notices"]  # one notice, not one per check
    levels.mark_seen([n["id"] for n in st["notices"]])
    assert levels.notices() == []


def test_level_two_unlocks_for_good_and_a_drop_brings_a_notice_and_a_review(tmpdb):
    know(levels.SYMS)
    st = levels.check()
    assert st["level"] == 2 and "dictation" in st["exercises"] and "listening/zhuyin" not in st["exercises"]
    assert any(n["kind"] == "unlock" and n["title"] == "Level 2: Write the alphabet" for n in st["notices"])
    assert coach.cleaning.clean_step(
        {"type": "write_symbols", "syms": ["ㄚ"]}, set()
    )  # every symbol is open from level 2
    levels.mark_seen([n["id"] for n in st["notices"]])
    for s in "ㄅㄆㄇㄈ":  # four known symbols drop: the level goal is no longer met
        for _ in range(6):
            answer("recognize", s, False)
    st = levels.check()
    assert st["level"] == 2  # unlocks are permanent
    assert {(d["exercise"], d["item"]) for d in st["drops"]} == {("recognize", s) for s in "ㄅㄆㄇㄈ"}
    drop = [n for n in st["notices"] if n["kind"] == "drop"]
    assert len(drop) == 1 and drop[0]["title"] == "Recognize: needs a review" and "ㄅ ㄆ ㄇ ㄈ" in drop[0]["text"]
    pid = coach.build("test", run_pipeline=fake([{"type": "listen_tones", "tones": [2, 3]}]))
    steps = coach.state()["steps"]
    assert steps[0]["type"] == "recognize_symbols" and steps[0]["params"]["syms"] == list("ㄅㄆㄇㄈ")
    assert json.loads(coach.store.plan(pid)["raw"])["level_rule"]["review"] == ["Review: ㄅ ㄆ ㄇ ㄈ"]
    assert coach.store.plan(pid)["diagnosis"].startswith("Review first: ㄅ ㄆ ㄇ ㄈ")
    m = [x for x in coach.state()["milestones"] if x["criterion"]["unit"] == "level"]
    assert len(m) == 1 and m[0]["title"] == "Reach level 3: Syllables"
    for s in "ㄅㄆㄇㄈ":  # the symbols come back: 10 right answers today (the earlier days still count)
        for _ in range(10):
            answer("recognize", s, True)
    st = levels.check()
    assert st["drops"] == [] and any(n["kind"] == "back" for n in st["notices"])


def test_a_step_from_before_the_levels_is_closed(tmpdb):
    with db.conn() as c:
        c.execute("INSERT INTO level_unlocks(key, ts) VALUES ('level:2', ?)", (time.time(),))
    coach.build(
        "test",
        run_pipeline=fake([{"type": "write_symbols", "syms": ["ㄅ"]}, {"type": "listen_tones", "tones": [2, 3]}]),
    )
    assert [s["type"] for s in coach.state()["steps"]] == ["write_symbols", "listen_tones"]
    with db.conn() as c:
        c.execute("DELETE FROM level_unlocks")  # as for a plan made before the levels existed
    coach.refresh(check=False)
    s = coach.state()["steps"][0]
    assert s["status"] == "skipped" and s["skip_reason"] == "locked"


def test_stats_show_only_open_exercises(tmpdb):
    for _ in range(8):  # old dictation answers, from before the levels
        answer("dictation", "ㄅ", False)
        answer("recognize", "ㄆ", False)
    s = stats.compute(30)
    assert s["levels"]["level"] == 1
    assert not any(levels.exercise_of(w.get("href") or "") == "dictation" for w in s["weak"])
    assert any(levels.exercise_of(w.get("href") or "") == "recognize" for w in s["weak"])
    assert all(levels.is_open(levels.exercise_of(c["href"])) for c in s["challenges"])


def _summaries():
    with db.conn() as c:
        items = {
            (r["exercise"], r["item"]): (r["reps"], r["tests"], r["right_days"], [list(t) for t in r["last"]])
            for r in c.execute("SELECT exercise, item, reps, tests, right_days, last FROM level_items").fetchall()
        }
        days = {tuple(r) for r in c.execute("SELECT exercise, item, day FROM level_item_days").fetchall()}
    return items, days


def test_each_answer_updates_the_summaries_like_a_full_rebuild(tmpdb):
    """The summaries change with each answer (no history scan). They must equal a rebuild from the whole history,
    also with late answers (a sync), learn mode, second tries, help, and answers that measure several items."""
    import random

    rnd = random.Random(7)
    now = time.time()
    for i in range(400):
        area, mode = rnd.choice(
            [
                ("recognize", None),
                ("reading", None),
                ("dictation", None),
                ("listening", "tone"),
                ("listening", "zhuyin"),
                ("writing", "syllable"),
                ("speaking", "syllable"),
            ]
        )
        sym = rnd.choice(levels.SYMS[:6])
        ok = rnd.random() < 0.8
        units = [
            {
                "kind": "symbol",
                "expected": sym + rnd.choice(["", "\u3122"]),
                "ok": ok,
                "try_n": rnd.choice([0, 0, 0, 1]),
                "help": rnd.random() < 0.1,
            },
            {"kind": "tone", "expected": rnd.randint(1, 5), "ok": rnd.random() < 0.7},
            {"kind": "initial", "expected": sym, "ok": None},
        ]
        ts = (
            now - rnd.randint(0, 20) * DAY - (rnd.randint(0, 5) * DAY if i % 10 == 0 else 0)
        )  # every 10th answer is late
        db.add_event(
            {
                "area": area,
                "mode": mode,
                "item": sym,
                "ok": ok,
                "ms": rnd.randint(500, 5000),
                "details": {"learn": rnd.random() < 0.1},
                "units": units,
            },
            ts=ts,
        )
    step_by_step = _summaries()
    stars = levels.all_stars()
    assert step_by_step[0] and step_by_step[1]
    with db.conn() as c:  # as for a learner whose history comes from before the summaries
        c.execute("DELETE FROM level_built")
        c.execute("DELETE FROM level_items")
        c.execute("DELETE FROM level_item_days")
    assert levels.all_stars() == stars  # the first read builds them again from the history
    assert _summaries() == step_by_step


def test_settings_open_levels_without_the_goals_and_keep_the_earned_level(tmpdb):
    db.save_settings({"open_level": 3})
    st = levels.check()
    # The exercises and every symbol open, but the level, the goals, and the notices still follow the answers.
    assert st["level"] == 1 and st["open_level"] == 3 and st["next"]["n"] == 2
    assert {"dictation", "listening/zhuyin"} <= set(st["exercises"]) and st["symbols"] == levels.SYMS
    assert [L["open"] for L in st["levels"]] == [True, True, True, False, False]
    assert [L["unlocked"] for L in st["levels"]] == [True, False, False, False, False]
    assert st["notices"] == [] and levels.opened()["level"] == 1
    assert levels.step_allowed("write_symbols", {})
    assert "level 3 before reaching it" in coach.prompts.level_rule(levels.opened())
    # Back to the progress: the extra exercises close. An earned level never closes.
    db.save_settings({"open_level": 1})
    assert levels.check()["exercises"] == [
        "symbols",
        "reading",
        "recognize",
        "listening/tone",
        "numbers/listen",
        "numbers/speak",
        "characters",
    ]
    know(levels.SYMS)
    assert levels.check()["level"] >= 2 and "dictation" in levels.opened()["exercises"]


def test_settings_accept_only_a_real_level(client):
    h = {"Authorization": "Bearer token-a"}
    assert client.put("/api/settings", json={"open_level": levels.MAX_LEVEL + 1}, headers=h).status_code == 422
    assert client.put("/api/settings", json={"open_level": 0}, headers=h).status_code == 422
    assert client.put("/api/settings", json={"open_level": 2}, headers=h).json()["open_level"] == 2
