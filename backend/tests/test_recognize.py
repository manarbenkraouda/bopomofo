"""Recognize: see a symbol, type its pinyin. What is saved, the stats on it, and how the coach uses it. No network calls."""
import time

import pytest

from app import coach, db, stats


@pytest.fixture()
def tmpdb(pg, monkeypatch):
    monkeypatch.setattr(coach, "LIVE", False)
    monkeypatch.setattr(coach, "ALPHABET_GATE", 0)


def answer(area, kind, expected, ok, step=None, try_n=0, item="x", help=False):
    db.add_event({"area": area, "item": item, "ok": ok, "details": {"step": step} if step else {},
                  "units": [{"kind": kind, "expected": expected, "actual": expected if ok else "?", "ok": ok, "try_n": try_n, "help": help}]})


def fake(steps, milestones=None):
    def run(d, reason, run_id):
        return {"diagnosis": "test", "steps": [coach.clean_step(s, set()) for s in steps], "milestones": milestones, "findings": []}
    return run


def test_recognize_answers_keep_the_typed_symbol(tmpdb):
    yesterday = time.time() - 86400
    for i in range(6):  # ㄓ typed as "z" (ㄗ) 4 times out of 6
        got = "ㄗ" if i < 4 else "ㄓ"
        db.add_event({"area": "recognize", "item": "ㄓ", "ok": got == "ㄓ", "first_try": got == "ㄓ", "ms": 1500,
                      "units": [{"kind": "symbol", "expected": "ㄓ", "actual": got, "ok": got == "ㄓ", "extra": {"typed": "z" if got == "ㄗ" else "zh"}}]},
                     ts=yesterday)
    with db.conn() as c:
        u = c.execute("SELECT area, kind, expected, actual, extra FROM units ORDER BY id LIMIT 1").fetchone()
    assert (u["area"], u["kind"], u["expected"], u["actual"]) == ("recognize", "symbol", "ㄓ", "ㄗ") and "z" in u["extra"]
    s = stats.compute(30)
    cell = {(c["expected"], c["actual"]): c["n"] for c in s["confusion"] if c["area"] == "recognize"}
    assert cell == {("ㄓ", "ㄗ"): 4, ("ㄓ", "ㄓ"): 2}
    assert s["areas"]["recognize"]["n"] == 6
    w = next(x for x in s["weak"] if x["area"] == "recognize")
    assert w["verb"] == "typed" and w["href"] == "/recognize?syms=" + stats.quote("ㄓ,ㄗ")
    ch = next(c for c in s["challenges"] if c["id"] == "recognize-syms")
    assert ch["href"].startswith("/recognize?syms=") and "ㄓ" in ch["title"]
    assert db.summary()["symbols_by_area"]["recognize"]["ㄓ"] == {"n": 6, "err": 4}


def test_recognize_steps_count_typed_answers_inside_the_step(tmpdb):
    assert coach.clean_step({"type": "recognize_symbols", "syms": ["zh", "ㄓㄗ"]}, set()) is None  # single Bopomofo symbols only
    s = coach.clean_step({"type": "recognize_symbols", "syms": ["ㄓ", "ㄗ", "x", "ㄓ"], "target": 12}, set())
    assert s["params"] == {"syms": ["ㄓ", "ㄗ"]} and s["target"] == 12
    coach.build("test", run_pipeline=fake([{"type": "recognize_symbols", "syms": ["ㄓ", "ㄗ"], "target": 5}]))
    step = coach.state()["steps"][0]
    assert step["href"].startswith("/recognize?syms=") and step["area"] == "recognize"
    for _ in range(3):
        answer("recognize", "symbol", "ㄓ", True, step=step["id"])
    answer("recognize", "symbol", "ㄓ", True, step=step["id"], try_n=1)  # a second try does not count
    answer("recognize", "symbol", "ㄙ", True, step=step["id"])  # not the focus
    answer("recognize", "symbol", "ㄗ", True)  # outside the step
    answer("recognize", "symbol", "ㄗ", False, step=step["id"])
    assert coach.step_progress(coach._step(step["id"])) == {"progress": 3, "tried": 4, "right": 3}


def test_typed_pinyin_counts_as_knowing_a_symbol_and_feeds_the_coach(tmpdb):
    for actual in ("ㄓ", "ㄓ"):
        db.add_event({"area": "recognize", "item": "ㄓ", "ok": True, "units": [{"kind": "symbol", "expected": "ㄓ", "actual": actual, "ok": True}]})
    for _ in range(3):
        db.add_event({"area": "recognize", "item": "ㄣ", "ok": False, "units": [{"kind": "symbol", "expected": "ㄣ", "actual": "ㄥ", "ok": False}]})
    st = coach.alphabet_status()
    zh = next(x for x in st["symbols"] if x["sym"] == "ㄓ")
    assert "ㄓ" in st["known"] and zh["type"] == "2/2" and zh["reps"] == 2
    assert "ㄣ" in st["learning"]
    d = coach.digest()
    assert d["symbols"]["recognize_mixups"] == [{"shown": "ㄣ", "typed_as": "ㄥ", "times": 3, "of": 3}]
    assert any(m["mode"] == "recognize" and m["needs_alphabet"] for m in d["overview"]["modes"])
    assert any(r["area"] == "recognize" and r["x"] == "ㄣ" for r in d["symbols"]["skills"])
    from app import story
    facts = story.story_facts(d, [], [])
    assert facts["mix.recognize.symbol.ㄣ>ㄥ"]["value"] == 3 and "ㄥ" in facts["mix.recognize.symbol.ㄣ>ㄥ"]["label"]
    assert "mode.recognize.pct" in facts
    plan = coach.rules_plan(d)
    assert any(s["type"] == "recognize_symbols" and "ㄣ" in s["syms"] for s in plan["steps"])
    m = coach.clean_milestone({"title": "Recognize ㄣ", "area": "recognize", "unit": "symbol", "expected": ["ㄣ"], "min_acc": 80, "window": 20})
    assert m and m["criterion"]["area"] == "recognize" and coach.needs_alphabet(m["criterion"])

