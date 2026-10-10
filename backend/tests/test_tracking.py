"""Progress tracking: the event and unit tables, the copy of old attempts, and the statistics built on them."""
import json
import time
from datetime import date

import pytest

from app import db, stats


@pytest.fixture()
def tmpdb(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB", tmp_path / "t.db")
    return tmp_path


def legacy(c, area, item, ok, details, ts):
    c.execute("INSERT INTO attempts(area, item, ok, score, details, created) VALUES (?,?,?,?,?,?)", (area, item, int(ok), None, json.dumps(details), ts))


def test_backfill_copies_old_attempts_once(tmpdb):
    with db.conn() as c:
        c.executescript("CREATE TABLE attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, area TEXT NOT NULL, item TEXT NOT NULL,"
                        " ok INTEGER NOT NULL, score REAL, details TEXT, created REAL NOT NULL);")
        legacy(c, "writing", "ㄗ", False, {"symbols": [{"sym": "ㄗ", "ok": False}], "mode": "dictation", "cheated": True}, time.time() - 86400)
        legacy(c, "writing", "ㄇㄚˇ", True, {"symbols": [{"sym": "ㄇ", "ok": True}, {"sym": "ˇ", "ok": True}], "mode": "syllable"}, time.time())
        legacy(c, "speaking", "你好", True, {"tones": [{"tone": 2, "ok": True}, {"tone": 3, "ok": False}]}, time.time())
    db.init()
    db.init()  # a second start must not copy again
    with db.conn() as c:
        ev = [dict(r) for r in c.execute("SELECT area, mode, help FROM events ORDER BY id")]
        un = [dict(r) for r in c.execute("SELECT area, kind, expected, ok FROM units ORDER BY id")]
    assert [e["area"] for e in ev] == ["dictation", "writing", "speaking"]
    assert ev[0]["help"] == 1 and ev[2]["mode"] == "sentence"
    assert {"area": "writing", "kind": "tone", "expected": "3", "ok": 1} in un
    assert sum(u["kind"] == "tone" and u["area"] == "speaking" for u in un) == 2
    s = db.summary()
    assert s["symbols"]["ㄗ"] == {"n": 1, "err": 1} and s["tones"]["3"] == {"n": 1, "err": 1}


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


def test_confusion_weak_and_challenges(tmpdb):
    db.init()
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
    assert s["daily"][-1]["day"] == date.today().isoformat() and s["daily"][-1]["cards"] == 1

