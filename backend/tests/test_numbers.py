"""Numbers: the characters of a number, the listen and speak answers, their stats, and the coach steps on them."""

import pytest

from app import coach, db, levels, numbers, stats
from tests.test_coach import fake, unlock_all


@pytest.fixture()
def tmpdb(pg, monkeypatch):
    monkeypatch.setattr(coach.settings, "LIVE", False)
    monkeypatch.setattr(coach.settings, "ALPHABET_GATE", 0)
    monkeypatch.setattr(coach.settings, "RULES_GATE", False)
    unlock_all()


@pytest.mark.parametrize(
    ("n", "said"),
    [
        (0, "零"),
        (10, "十"),
        (15, "十五"),
        (20, "二十"),
        (22, "二十二"),
        (110, "一百一十"),
        (200, "兩百"),
        (205, "兩百零五"),
        (2000, "兩千"),
        (2022, "兩千零二十二"),
        (10005, "一萬零五"),
        (10500, "一萬零五百"),
        (20000, "兩萬"),
        (150000, "十五萬"),
        (2000000, "兩百萬"),
        (99999999, "九千九百九十九萬九千九百九十九"),
    ],
)
def test_hanzi_follows_taiwan_usage(n, said):
    assert numbers.hanzi(n) == said


def test_hanzi_rejects_numbers_out_of_range():
    with pytest.raises(ValueError):
        numbers.hanzi(numbers.MAX + 1)


def test_band_and_error_kinds():
    assert [numbers.band(n) for n in (0, 10, 11, 99, 100, 9999, 10000)] == [
        "0-10",
        "0-10",
        "11-99",
        "11-99",
        "100-999",
        "1000-9999",
        "10000+",
    ]
    assert numbers.error_of(14, 40) == "teens" and numbers.error_of(40, 14) == "teens"
    assert numbers.error_of(41, 14) == "order"
    assert numbers.error_of(30, 300) == "place" and numbers.error_of(205, 25) == "place"
    assert numbers.error_of(123, 124) == "digit"
    assert numbers.error_of(4, 10) == "4-10"
    assert numbers.error_of(7, 7000) == "place"
    assert numbers.error_of(7, 52) == "other"
    assert numbers.error_of(5, 5) is None


def listen(n, picked, step=None):
    ok = n == picked
    return db.add_event(
        {
            "area": "numbers",
            "mode": "listen",
            "item": str(n),
            "ok": ok,
            "details": {"step": step} if step else {},
            "units": [
                {
                    "kind": "number",
                    "expected": str(n),
                    "actual": str(picked),
                    "ok": ok,
                    "ctx": numbers.band(n),
                    "extra": {"hanzi": numbers.hanzi(n), "error": numbers.error_of(n, picked)},
                }
            ],
        }
    )


def fake_result(chars, wrong_tone=()):
    """A speech result for the characters: every syllable heard, the tones in wrong_tone said wrong."""
    sy = []
    for i, c in enumerate(chars):
        bad = i in wrong_tone
        sy.append(
            {
                "expected": {"char": c, "zhuyin": "x", "initial": "", "final": "", "tone": "4", "surface_tone": "4"},
                "heard": {"tone": "2" if bad else "4", "initial": "", "final": ""},
                "tone_ok": not bad,
                "initial_ok": True,
                "final_ok": True,
            }
        )
    return {"score": 50 if wrong_tone else 95, "syllables": sy, "heard_raw": chars}


def test_listen_answers_feed_the_number_stats(tmpdb):
    listen(14, 40)
    listen(14, 14)
    listen(250, 205)
    s = stats.number_stats()
    assert s["modes"]["listen"]["n"] == 3 and s["modes"]["listen"]["acc"] == 33.3
    assert {"mode": "listen", "error": "teens", "n": 1} in s["errors"]
    assert {"expected": "14", "picked": "40", "error": "teens", "n": 1} in s["mixups"]
    assert [b["band"] for b in s["bands"]] == ["11-99", "100-999"]
    assert s["missed"][0]["number"] in ("14", "250")


def test_spoken_number_saves_one_number_unit_and_the_syllables(tmpdb):
    stats.log_number_speech(205, fake_result("兩百零五"))
    stats.log_number_speech(14, fake_result("十四", wrong_tone=(1,)))
    with db.conn() as c:
        rows = [
            dict(r)
            for r in c.execute("SELECT area, mode, kind, expected, actual, ok, ctx, extra FROM units ORDER BY id")
        ]
    num = [r for r in rows if r["kind"] == "number"]
    assert [(r["expected"], r["actual"], r["ok"], r["ctx"]) for r in num] == [
        ("205", "205", 1, "100-999"),
        ("14", "?", 0, "11-99"),
    ]
    assert all(r["area"] == "numbers" and r["mode"] == "speak" for r in rows)
    assert '"error": "tone"' in num[1]["extra"] and '"wrong": "四"' in num[1]["extra"]
    s = stats.number_stats()
    assert s["modes"]["speak"]["n"] == 2 and {"mode": "speak", "error": "tone", "n": 1} in s["errors"]


def test_level_items_group_numbers_by_size(tmpdb):
    listen(14, 14)
    listen(15, 15)
    with db.conn() as c:
        keys = {(r["exercise"], r["item"]) for r in c.execute("SELECT exercise, item FROM level_items")}
    assert ("numbers/listen", "num:11-99") in keys


def test_clean_step_and_milestone_for_numbers(tmpdb):
    op = levels.opened()
    s = coach.cleaning.clean_step(
        {
            "type": "numbers",
            "mode": "speak",
            "bands": ["11-99", "huge"],
            "nums": [14, 14, "x", -1, 10**9],
            "target": 12,
        },
        set(),
        op=op,
    )
    assert s["type"] == "numbers" and s["params"]["mode"] == "speak"
    assert s["params"]["bands"] == ["11-99"] and s["params"]["nums"] == [14]
    s = coach.cleaning.clean_step({"type": "numbers", "target": 10}, set(), op=op)
    assert s["params"] == {"mode": "listen", "bands": [], "nums": []}
    m = coach.cleaning.clean_milestone(
        {"title": "t", "area": "numbers", "unit": "number", "expected": ["10000+"], "min_acc": 90, "window": 20}
    )
    assert m["criterion"]["expected"] == ["10000+"] and m["criterion"]["unit"] == "number"
    assert (
        coach.cleaning.clean_milestone(
            {"title": "t", "area": "numbers", "unit": "tone", "expected": ["4"], "min_acc": 90, "window": 20}
        )
        is None
    )


def test_numbers_step_counts_only_its_own_numbers(tmpdb):
    coach.build(
        "test",
        run_pipeline=fake([{"type": "numbers", "mode": "listen", "bands": ["11-99"], "target": 3}]),
    )
    st = coach.state()["steps"][0]
    assert st["href"].startswith("/numbers?mode=listen&bands=11-99") and st["href"].endswith(f"&step={st['id']}")
    listen(14, 14)  # outside the step
    listen(14, 14, step=st["id"])
    listen(14, 40, step=st["id"])
    listen(250, 250, step=st["id"])  # another size: does not count
    assert coach.progress.step_progress(coach.store.step(st["id"])) == {"progress": 1, "tried": 2, "right": 1}
    c = {"area": "numbers", "unit": "number", "expected": ["11-99"], "min_acc": 50, "window": 3}
    assert coach.progress.milestone_progress(c) == {"n": 3, "value": 66.7, "reached": True}
