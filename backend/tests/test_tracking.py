"""Progress tracking: the event and unit tables, old-format attempts, per-user data, and the statistics built on them."""
import time

import pytest

from app import db, stats


@pytest.fixture()
def tmpdb(pg):
    return None


def test_old_attempts_become_events_with_units(tmpdb):
    """The old attempt format (POST /api/progress/attempt, and rows imported from SQLite) is saved as events and units."""
    old = [("writing", "ㄗ", False, {"symbols": [{"sym": "ㄗ", "ok": False}], "mode": "dictation", "cheated": True}, time.time() - 86400),
           ("writing", "ㄇㄚˇ", True, {"symbols": [{"sym": "ㄇ", "ok": True}, {"sym": "ˇ", "ok": True}], "mode": "syllable"}, time.time()),
           ("speaking", "你好", True, {"tones": [{"tone": 2, "ok": True}, {"tone": 3, "ok": False}]}, time.time())]
    for area, item, ok, details, ts in old:
        db.add_event(db.legacy_event(area, item, ok, None, details), ts=ts, legacy=True)
    with db.conn() as c:
        ev = [dict(r) for r in c.execute("SELECT area, mode, help, legacy FROM events ORDER BY id")]
        un = [dict(r) for r in c.execute("SELECT area, kind, expected, ok FROM units ORDER BY id")]
    assert [e["area"] for e in ev] == ["dictation", "writing", "speaking"]
    assert ev[0]["help"] == 1 and ev[2]["mode"] == "sentence" and all(e["legacy"] == 1 for e in ev)
    assert {"area": "writing", "kind": "tone", "expected": "3", "ok": 1} in un
    assert sum(u["kind"] == "tone" and u["area"] == "speaking" for u in un) == 2
    s = db.summary()
    assert s["symbols"]["ㄗ"] == {"n": 1, "err": 1} and s["tones"]["3"] == {"n": 1, "err": 1}


def test_each_user_sees_only_their_own_data(tmpdb):
    db.add_sentence({"hanzi": "我很好"}, "t", "t")
    db.set_profile({"job": "engineer"})
    db.save_day("2026-10-10", 120, 15)
    db.add_event({"area": "listening", "item": "ㄇㄚˇ", "ok": True, "units": [{"kind": "tone", "expected": "3", "ok": True}]})
    db.set_user("user_other")
    assert db.list_sentences() == [] and db.get_profile() == {} and db.summary()["attempts"] == 0
    db.set_profile({"job": "teacher"})
    db.save_day("2026-10-10", 30, None)
    with db.conn() as c:
        assert c.execute("SELECT COUNT(*) FROM units").fetchone()[0] == 0
        assert c.execute("UPDATE sentences SET hanzi='x'").rowcount == 0  # cannot change the other user's rows
    db.set_user("user_test")
    assert [s["hanzi"] for s in db.list_sentences()] == ["我很好"] and db.get_profile() == {"job": "engineer"}
    with db.conn() as c:
        assert c.execute("SELECT seconds FROM days").fetchall() == [(120,)]


def test_no_user_sees_nothing_and_cannot_write(tmpdb):
    db.add_sentence({"hanzi": "我很好"}, "t", "t")
    db.set_user(None)
    assert db.list_sentences() == []
    with pytest.raises(Exception):
        db.add_sentence({"hanzi": "x"}, "t", "t")


def test_speaking_units_keep_what_was_heard():
    syl = lambda ch, z, ini, fin, t, st: {"char": ch, "zhuyin": z, "initial": ini, "final": fin, "tone": t, "surface_tone": st}  # noqa: E731
    res = {"score": 50, "syllables": [
        {"expected": syl("你", "ㄋㄧˊ", "ㄋ", "ㄧ", 3, 2), "heard": {"initial": "ㄌ", "final": "ㄧ", "tone": 3, "zhuyin": "ㄌㄧˇ"},
         "initial_ok": False, "final_ok": True, "tone_ok": False, "tone_source": "model", "uncertain": True},
        {"expected": syl("好", "ㄏㄠˇ", "ㄏ", "ㄠ", 3, 3), "heard": None, "initial_ok": False, "final_ok": False, "tone_ok": False},
    ]}
    u = stats.speaking_units(res)
    tone = [x for x in u if x["kind"] == "tone"]
    assert tone[0]["expected"] == 2 and tone[0]["actual"] == 3 and tone[0]["lex"] == 3 and tone[0]["next"] == 3 and tone[0]["uncertain"]
    assert tone[1]["actual"] == "?" and tone[1]["prev"] == 2
    assert {"kind": "initial", "expected": "ㄋ", "actual": "ㄌ"}.items() <= next(x for x in u if x["kind"] == "initial").items()


def test_speaking_cheat_and_retry_are_saved(tmpdb):
    """A recording after the cheat (model audio or Pinyin) is helped, and a retry on the same card is not a first try."""
    syl = {"char": "好", "zhuyin": "ㄏㄠˇ", "initial": "ㄏ", "final": "ㄠ", "tone": 3, "surface_tone": 3}
    res = {"score": 95, "syllables": [{"expected": syl, "heard": {"initial": "ㄏ", "final": "ㄠ", "tone": 3, "zhuyin": "ㄏㄠˇ"},
                                       "initial_ok": True, "final_ok": True, "tone_ok": True}]}
    stats.log_speaking("好", res, "syllable")
    stats.log_speaking("好", res, "syllable", help=True, try_n=1)
    with db.conn() as c:
        ev = [dict(r) for r in c.execute("SELECT first_try, tries, help FROM events ORDER BY id")]
        un = [dict(r) for r in c.execute("SELECT event_id, help, try_n FROM units WHERE kind='tone' ORDER BY id")]
    assert ev == [{"first_try": 1, "tries": 1, "help": 0}, {"first_try": 0, "tries": 2, "help": 1}]
    assert [(u["help"], u["try_n"]) for u in un] == [(0, 0), (1, 1)]


def test_speaking_by_text_counts_recordings_per_sentence(tmpdb):
    for score, ts in ((60, 1.0), (92, 2.0), (85, 3.0)):
        db.add_event({"area": "speaking", "mode": "sentence", "item": "你好。", "ok": score >= 80, "score": score}, ts=ts)
    db.add_event({"area": "listening", "mode": "tone", "item": "你好。", "ok": True}, ts=4.0)
    assert db.speaking_by_text() == {"你好。": {"said": 3, "best": 92, "last": 85, "ts": 3.0}}


def test_confusion_weak_and_challenges(tmpdb):
    yesterday = time.time() - 86400
    for i in range(10):  # tone 3 heard as tone 2, 7 times out of 10
        picked = "2" if i < 7 else "3"
        db.add_event({"area": "listening", "mode": "tone", "item": "ㄇㄚˇ", "ok": picked == "3", "ms": 900,
                      "units": [{"kind": "tone", "expected": "3", "actual": picked, "ok": picked == "3"}]}, ts=yesterday)
    db.add_event({"area": "listening", "mode": "tone", "item": "ㄇㄚˇ", "ok": True,
                  "units": [{"kind": "tone", "expected": "3", "actual": "3", "ok": True}]})
    s = stats.compute(30)
    cell = {(c["expected"], c["actual"]): c["n"] for c in s["confusion"] if c["area"] == "listening"}
    assert cell[("3", "2")] == 7 and cell[("3", "3")] == 4
    w = s["weak"][0]
    assert (w["area"], w["kind"], w["expected"]) == ("listening", "tone", "3") and w["top"][0] == ["2", 7]
    assert w["href"] == "/listening?quiz=tone&tones=3,2"
    ch = next(c for c in s["challenges"] if c["id"] == "hear-tone")
    assert ch["progress"] == 1 and "tone 2" in ch["title"]
    assert s["daily"][-1]["day"] == db.local_today().isoformat() and s["daily"][-1]["cards"] == 1

