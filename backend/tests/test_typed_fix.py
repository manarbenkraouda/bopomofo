"""Typed Pinyin checks: after missed recordings, the learner types the sound they said, and mic mix-ups stop counting as errors."""

import pytest

from app import coach, db, stats, typed_fix


@pytest.fixture(autouse=True)
def _db(pg):
    coach.settings.LIVE = False


SYL = {"char": "破", "zhuyin": "ㄆㄛˋ", "initial": "ㄆ", "final": "ㄛ", "tone": 4, "surface_tone": 4}


def miss(heard_initial="ㄅ", tone_ok=True, try_n=0, help=False) -> int:
    """One recording of 破 where the model heard another initial."""
    res = {
        "score": 40,
        "syllables": [
            {
                "expected": SYL,
                "heard": {
                    "initial": heard_initial,
                    "final": "ㄛ",
                    "tone": 4 if tone_ok else 2,
                    "zhuyin": heard_initial + "ㄛˋ",
                },
                "initial_ok": False,
                "final_ok": True,
                "tone_ok": tone_ok,
            }
        ],
    }
    return stats.log_speaking("破", res, "syllable", help=help, try_n=try_n)


def units(eid):
    with db.conn() as c:
        return {
            r["kind"]: dict(r)
            for r in c.execute(
                "SELECT kind, expected, actual, ok, source, extra FROM units WHERE event_id=?"
                " AND try_n=(SELECT MIN(try_n) FROM units WHERE event_id=?)",
                (eid, eid),
            )
        }


def event(eid):
    with db.conn() as c:
        return dict(c.execute("SELECT ok, first_try, details FROM events WHERE id=?", (eid,)).fetchone())


def test_parse_syllable():
    assert typed_fix.parse_syllable("po") == ("ㄆ", "ㄛ")
    assert typed_fix.parse_syllable(" Pō ") == ("ㄆ", "ㄛ")
    assert typed_fix.parse_syllable("lv3") == ("ㄌ", "ㄩ")
    assert typed_fix.parse_syllable("an") == ("∅", "ㄢ")
    assert typed_fix.parse_syllable("zhi") == ("ㄓ", "∅")
    for bad in ("", "xyz", "po po", "ㄆㄛ", "hello"):
        assert typed_fix.parse_syllable(bad) is None, bad


def test_match_fixes_the_sounds_and_keeps_the_tones():
    ids = [miss(try_n=0), miss(try_n=1), miss(tone_ok=False, try_n=2)]
    out = typed_fix.confirm_speaking(ids, "po")
    assert out["match"] and out["fixed"] == 3
    u = units(ids[0])
    assert u["initial"]["ok"] == 1 and u["initial"]["actual"] == "ㄆ" and u["initial"]["source"] == "typed"
    assert '"heard": "ㄅ"' in u["initial"]["extra"] and u["syllable"]["ok"] == 1
    assert event(ids[0])["ok"] == 1 and event(ids[0])["first_try"] == 1 and "typed_fix" in event(ids[0])["details"]
    assert event(ids[1])["ok"] == 1 and event(ids[1])["first_try"] == 0
    # The third recording also had a wrong tone: the tone stays wrong, so the answer stays wrong.
    assert units(ids[2])["tone"]["ok"] == 0 and event(ids[2])["ok"] == 0


def test_no_match_keeps_the_misses_and_saves_what_was_typed():
    ids = [miss(try_n=n) for n in range(3)]
    out = typed_fix.confirm_speaking(ids, "bo")
    assert not out["match"] and out["fixed"] == 0
    assert all(event(i)["ok"] == 0 for i in ids) and units(ids[0])["initial"]["ok"] == 0
    with db.conn() as c:
        typed = [
            dict(r)
            for r in c.execute("SELECT kind, actual, ok, try_n, source FROM units WHERE source='typed' ORDER BY kind")
        ]
    assert typed == [
        {"kind": "final", "actual": "ㄛ", "ok": 1, "try_n": 3, "source": "typed"},
        {"kind": "initial", "actual": "ㄅ", "ok": 0, "try_n": 3, "source": "typed"},
    ]
    assert typed_fix.mic_pairs() == []  # a real mix-up is not a mic mix-up


def test_bad_input_and_other_users():
    ids = [miss(try_n=n) for n in range(3)]
    with pytest.raises(ValueError):
        typed_fix.confirm_speaking(ids, "xyz")
    db.set_user("user_other")
    with pytest.raises(ValueError):
        typed_fix.confirm_speaking(ids, "po")
    db.set_user("user_test")
    assert units(ids[0])["initial"]["ok"] == 0


def test_five_confirmations_fix_the_older_misses_of_the_pair():
    old = miss()
    for n in range(typed_fix.PAIR_CONFIRMATIONS):
        out = typed_fix.confirm_speaking([miss()], "po")
        assert units(old)["initial"]["ok"] == (1 if n == typed_fix.PAIR_CONFIRMATIONS - 1 else 0), n
    assert out["pairs_confirmed"] == [
        {"area": "speaking", "kind": "initial", "expected": "ㄆ", "heard": "ㄅ", "fixed": 1}
    ]
    assert units(old)["initial"]["source"] == "pair_fix" and event(old)["ok"] == 1
    assert typed_fix.apply_pairs() == []  # running again changes nothing
    pairs = stats.compute(days=None)["mic_pairs"]
    assert pairs == [
        {"area": "speaking", "kind": "initial", "expected": "ㄆ", "heard": "ㄅ", "n": 5, "confirmed": True}
    ]
    assert coach.digest.digest()["sounds"]["mic_pairs"] == pairs


def test_reading_typed_units_count_as_pairs():
    """Reading sends the fixed units itself (POST /api/progress/event): they count for the pair like the speaking checks."""
    for n in range(2):
        db.add_event(
            {
                "area": "reading",
                "item": "ㄆ",
                "ok": True,
                "first_try": True,
                "tries": 3,
                "units": [
                    {
                        "kind": "symbol",
                        "expected": "ㄆ",
                        "actual": "ㄆ",
                        "ok": True,
                        "try_n": t,
                        "source": "typed",
                        "extra": {"heard": "ㄅ", "typed": "p", "confirm": f"r{n}"},
                    }
                    for t in range(3)
                ],
            }
        )
    assert typed_fix.mic_pairs() == [
        {"area": "reading", "kind": "symbol", "expected": "ㄆ", "heard": "ㄅ", "n": 2, "confirmed": False}
    ]
