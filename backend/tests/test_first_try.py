"""Three attempts without hints count as one first-try result. Raw evidence stays intact."""

import json
import time

import pytest

from app import coach, db, levels, placement, stats
from app.attempts import first_try


@pytest.mark.parametrize("area", ["reading", "recognize", "dictation", "writing"])
@pytest.mark.parametrize(
    "tries,help,good", [(1, False, True), (2, False, True), (3, False, True), (4, False, False), (2, True, False)]
)
def test_card_credit_reaches_stats_levels_and_coach(pg, monkeypatch, area, tries, help, good):
    monkeypatch.setattr(coach.settings, "LIVE", False)
    mode = "symbol" if area == "writing" else None
    with db.conn() as c:
        plan = c.execute("INSERT INTO plans(ts,status) VALUES (1,'active') RETURNING id").fetchone()[0]
        kind = {
            "reading": "read_symbols",
            "recognize": "recognize_symbols",
            "dictation": "write_symbols",
            "writing": "write_syllables",
        }[area]
        sid = c.execute(
            "INSERT INTO steps(plan_id,pos,type,title,why,params,target) VALUES (?,0,?,'test','test',?,5) RETURNING id",
            (plan, kind, json.dumps({"syms": ["ㄅ"]})),
        ).fetchone()[0]
    eid = db.add_event(
        {
            "area": area,
            "mode": mode,
            "item": "ㄅ",
            "ok": good,
            "first_try": good,
            "tries": tries,
            "help": help,
            "details": {"first_try_limit": 3, "step": sid},
            "units": [
                {
                    "kind": "symbol",
                    "expected": "ㄅ",
                    "actual": "ㄅ" if n == tries - 1 else "ㄆ",
                    "ok": n == tries - 1,
                    "try_n": n,
                    "help": help,
                }
                for n in range(tries)
            ],
        }
    )
    with db.conn() as c:
        raw = [dict(r) for r in c.execute("SELECT actual,ok,try_n FROM units WHERE event_id=? ORDER BY id", (eid,))]
        credited = [
            dict(r) for r in c.execute("SELECT ok,help FROM practice_units WHERE event_id=? AND try_n=0", (eid,))
        ]
        summary = c.execute("SELECT tests,last FROM level_items WHERE item='ㄅ'").fetchone()
    assert len(raw) == tries and [r["try_n"] for r in raw] == list(range(tries))
    assert raw[-1]["actual"] == "ㄅ" and all(r["actual"] == "ㄆ" for r in raw[:-1])
    assert len(credited) == 1 and bool(credited[0]["ok"] and not credited[0]["help"]) == good
    assert summary["tests"] == 1 and bool(summary["last"][-1][2]) == good
    rows = stats.compute(None, area)["items"]
    symbol = next(r for r in rows if r["kind"] == "symbol" and r["expected"] == "ㄅ")
    assert symbol["n"] == 1 and symbol["ok"] == int(good)
    step = {"id": sid, "type": kind, "params": {"syms": ["ㄅ"]}}
    assert coach.progress.step_progress(step)["progress"] == int(good)
    assert db.memory(area, mode)["ㄅ"][0][1] == int(good)


def speech_result(ok):
    e = {"char": "八", "zhuyin": "ㄅㄚ", "initial": "ㄅ", "final": "ㄚ", "tone": 1, "surface_tone": 1}
    return {
        "score": 95 if ok else 40,
        "syllables": [
            {
                "expected": e,
                "heard": {
                    "initial": "ㄅ" if ok else "ㄆ",
                    "final": "ㄚ",
                    "tone": 1,
                    "zhuyin": "ㄅㄚ" if ok else "ㄆㄚ",
                },
                "initial_ok": ok,
                "final_ok": True,
                "tone_ok": True,
            }
        ],
    }


@pytest.mark.parametrize("number", [False, True])
@pytest.mark.parametrize(
    "correct_at,help,good", [(1, False, True), (2, False, True), (3, False, True), (4, False, False), (2, True, False)]
)
def test_recordings_count_once_per_card_and_preserve_each_recording(pg, monkeypatch, number, correct_at, help, good):
    monkeypatch.setattr(coach.settings, "LIVE", False)
    for n in range(correct_at):
        kw = {"try_n": n, "help": help and n > 0, "card_id": "one-card"}
        if number:
            stats.log_number_speech(8, speech_result(n == correct_at - 1), **kw)
        else:
            stats.log_speaking("八", speech_result(n == correct_at - 1), "syllable", **kw)
    area, mode, item = ("numbers", "speak", "8") if number else ("speaking", "syllable", "八")
    with db.conn() as c:
        assert c.execute("SELECT COUNT(*) FROM events").fetchone()[0] == correct_at
        assert c.execute("SELECT COUNT(*) FROM practice_events").fetchone()[0] == 1
        ev = c.execute("SELECT first_try FROM practice_events").fetchone()
        assert bool(ev["first_try"]) == good
        units = [
            dict(r)
            for r in c.execute(
                "SELECT ok,help FROM practice_units WHERE kind=? AND try_n=0", ("number" if number else "initial",)
            )
        ]
        assert len(units) == 1 and bool(units[0]["ok"] and not units[0]["help"]) == good
        before = [dict(r) for r in c.execute("SELECT * FROM level_items ORDER BY exercise,item")]
        levels.rebuild(c)
        assert before == [dict(r) for r in c.execute("SELECT * FROM level_items ORDER BY exercise,item")]
    memory = db.memory(area, mode)[item]
    assert len(memory) == 1 and memory[0][1] == int(good)
    # Repeating the same item on a new card is a new test.
    if number:
        stats.log_number_speech(8, speech_result(True), card_id="another-card")
    else:
        stats.log_speaking("八", speech_result(True), "syllable", card_id="another-card")
    assert len(db.memory(area, mode)[item]) == 2


def test_first_try_boundary():
    assert [first_try(True, False, n) for n in range(4)] == [True, True, True, False]
    assert not first_try(True, True, 1)


@pytest.mark.parametrize(
    "area,mode,kind,item,step_type",
    [
        ("listening", "tone", "tone", "2", "listen_tones"),
        ("listening", "rule", "sandhi", "3-3", "tone_rules"),
        ("numbers", "listen", "number", "14", "numbers"),
        ("characters", "recognize", "char", "他", "characters"),
        ("writing", "symbol", "symbol", "ㄅ", "write_syllables"),
    ],
)
@pytest.mark.parametrize("tries,help,good", [(2, False, True), (3, False, True), (4, False, False), (2, True, False)])
def test_separate_submissions_share_one_result(pg, monkeypatch, area, mode, kind, item, step_type, tries, help, good):
    monkeypatch.setattr(coach.settings, "LIVE", False)
    # A retry must not remove progress from another exercise.
    db.add_event(
        {"area": "reading", "item": "ㄆ", "ok": True, "units": [{"kind": "symbol", "expected": "ㄆ", "ok": True}]}
    )
    with db.conn() as c:
        plan = c.execute("INSERT INTO plans(ts,status) VALUES (1,'active') RETURNING id").fetchone()[0]
        sid = c.execute(
            "INSERT INTO steps(plan_id,pos,type,title,why,params,target) VALUES (?,0,?,'test','test','{}',5) RETURNING id",
            (plan, step_type),
        ).fetchone()[0]
        other = dict(c.execute("SELECT * FROM level_items WHERE exercise='reading'").fetchone())
    for n in range(tries):
        ok = n == tries - 1
        db.add_event(
            {
                "area": area,
                "mode": mode,
                "item": item,
                "ok": ok,
                "first_try": first_try(ok, help, n),
                "tries": n + 1,
                "help": help,
                "details": {"first_try_limit": 3, "attempt_card": "card", "step": sid},
                "units": [
                    {
                        "kind": kind,
                        "expected": item,
                        "actual": item if ok else "wrong",
                        "ok": ok,
                        "help": help,
                        "try_n": n,
                    }
                ],
            }
        )
    assert coach.progress.step_progress({"id": sid, "type": step_type, "params": {}})["progress"] == int(good)
    assert len(db.memory(area, mode)[item]) == 1
    assert db.memory(area, mode)[item][0][1] == int(good)
    with db.conn() as c:
        assert dict(c.execute("SELECT * FROM level_items WHERE exercise='reading'").fetchone()) == other
        before = [dict(r) for r in c.execute("SELECT * FROM level_items ORDER BY exercise,item")]
        levels.rebuild(c)
        assert before == [dict(r) for r in c.execute("SELECT * FROM level_items ORDER BY exercise,item")]


def test_old_history_and_learn_repetitions_keep_their_meaning(pg):
    for details in ({}, {"first_try_limit": 3, "learn": True}):
        eid = db.add_event(
            {
                "area": "reading",
                "item": "ㄅ",
                "ok": True,
                "first_try": False,
                "tries": 2,
                "details": details,
                "units": [{"kind": "symbol", "expected": "ㄅ", "ok": n == 1, "try_n": n} for n in range(2)],
            }
        )
        with db.conn() as c:
            assert [
                tuple(r) for r in c.execute("SELECT ok,try_n FROM practice_units WHERE event_id=? ORDER BY id", (eid,))
            ] == [(0, 0), (1, 1)]
    assert len(db.memory("reading")["ㄅ"]) == 1
    assert db.memory("reading")["ㄅ"][0][1] == 0


def test_attempt_groups_are_private_to_each_user(pg):
    for user, ok in [("user_test", False), ("user_other", True)]:
        with db.as_user(user):
            db.add_event(
                {
                    "area": "reading",
                    "item": "ㄅ",
                    "ok": ok,
                    "first_try": ok,
                    "details": {"first_try_limit": 3, "attempt_card": "same-id"},
                    "units": [{"kind": "symbol", "expected": "ㄅ", "ok": ok}],
                }
            )
    for user, ok in [("user_test", False), ("user_other", True)]:
        with db.as_user(user), db.conn() as c:
            assert [tuple(r) for r in c.execute("SELECT user_id,ok FROM practice_events")] == [(user, int(ok))]
            assert [tuple(r) for r in c.execute("SELECT user_id,ok FROM practice_units")] == [(user, int(ok))]


def test_placement_accepts_three_recordings_per_card_and_scores_the_card_once(pg):
    from app.api.levels import PlacementIn

    count = 3 * (len(placement.SYLLABLES) + len(placement.SENTENCES))
    assert len(PlacementIn(voice_ids=list(range(count))).voice_ids) == count
    ids = [stats.log_speaking("八", speech_result(n == 2), "syllable", try_n=n, card_id="card") for n in range(3)]
    score = placement.score_voice(placement._rows(ids), "syllable")
    assert score["cards"] == 1
    assert "ㄅ" in score["symbols"]


def test_retry_time_is_kept_when_a_card_is_counted_once(pg):
    start = time.time() - 180
    for n in range(3):
        db.add_event(
            {
                "area": "reading",
                "item": "ㄅ",
                "ok": n == 2,
                "first_try": n == 2,
                "tries": n + 1,
                "details": {"first_try_limit": 3, "attempt_card": "card"},
                "units": [{"kind": "symbol", "expected": "ㄅ", "ok": n == 2, "try_n": n}],
            },
            ts=start + 60 * n,
        )
    for area in (None, "reading"):
        overview = stats.compute(None, area)["overview"]
        assert overview["cards"] == 1 and overview["minutes"] == 2
    assert stats.records()["total_minutes"]["value"] == 2
