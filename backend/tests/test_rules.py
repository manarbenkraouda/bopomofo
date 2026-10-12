"""Tone rules (3-3, 不, 一): the syllable tags, the explicit message, the saved units, the stats, the coach steps, and the gate."""
import time

import pytest

from app import coach, db, levels, stats, story
from app.zhuyin import rule_phrases, syllables_of


@pytest.fixture()
def tmpdb(pg, monkeypatch):
    monkeypatch.setattr(coach, "LIVE", False)
    monkeypatch.setattr(coach, "ALPHABET_GATE", 0)
    with db.conn() as c:
        for n in range(2, levels.MAX_LEVEL + 1):
            c.execute("INSERT INTO level_unlocks(key, ts) VALUES (?, ?) ON CONFLICT DO NOTHING", (f"level:{n}", time.time()))


def test_sandhi_tags_the_rule_that_changes_the_tone():
    s = syllables_of("我很好")
    assert [(x["tone"], x["surface_tone"], x["rule"]) for x in s] == [(3, 2, "3-3"), (3, 2, "3-3"), (3, 3, None)]
    assert [x["rule"] for x in syllables_of("不是")] == ["bu", None]
    assert syllables_of("不好")[0]["rule"] is None and syllables_of("不好")[0]["surface_tone"] == 4
    assert syllables_of("一天")[0]["rule"] == "yi" and syllables_of("一天")[0]["surface_tone"] == 4
    assert syllables_of("第一")[1]["rule"] is None and syllables_of("第一")[1]["surface_tone"] == 1


def test_rule_phrases_cover_changes_and_keeps():
    p = rule_phrases()
    by = {x["text"]: x for x in p}
    assert by["你好"]["changes"] and by["你好"]["said_zhuyin"] == "ㄋㄧˊ" and by["你好"]["written"] == 3
    assert not by["不好"]["changes"] and by["不好"]["rule"] == "bu"
    assert not by["星期一"]["changes"] and by["星期一"]["rule"] == "yi"
    for rid in ("3-3", "bu", "yi"):
        assert any(x["rule"] == rid and x["changes"] for x in p)


def _res(text, heard_tones, errors):
    sy = []
    for e, t, err in zip(syllables_of(text), heard_tones, errors):
        ok = t == e["surface_tone"]
        sy.append({"expected": e, "heard": {"initial": e["initial"], "final": e["final"], "tone": t, "zhuyin": e["zhuyin"]},
                   "initial_ok": True, "final_ok": True, "tone_ok": ok, "rule_error": err, "messages": []})
    return {"score": 70, "syllables": sy}


def test_recordings_save_one_sandhi_unit_per_rule_syllable_and_the_stats_count_literal_errors(tmpdb):
    # 我很好 read tone by tone: 我 and 很 said as written tone 3.
    stats.log_speaking("我很好", _res("我很好", [3, 3, 3], ["literal", "literal", None]), "sentence")
    stats.log_speaking("不是", _res("不是", [2, 4], [None, None]), "rule")
    with db.conn() as c:
        un = [dict(r) for r in c.execute("SELECT kind, expected, actual, ok, ctx FROM units WHERE kind='sandhi' ORDER BY id")]
    assert [(u["expected"], u["ok"], u["ctx"]) for u in un] == [("3-3", 0, "我"), ("3-3", 0, "很"), ("bu", 1, "不")]
    r = {x["rule"]: x for x in stats.rule_stats(30)}
    assert r["3-3"]["n"] == 2 and r["3-3"]["literal"] == 2 and r["3-3"]["acc"] == 0
    assert r["bu"]["acc"] == 100 and r["yi"]["n"] == 0
    assert levels._keys_of("sandhi", "3-3") == ["rule:3-3"] and levels._keys_of("sandhi", "x") == []
    facts = story.story_facts(coach.digest(), [], [])
    assert facts["rule.33.literal"]["value"] == 2 and facts["rule.bu.pct"]["value"] == 100 and "rule.yi.pct" not in facts


def test_tone_rule_steps_are_checked_and_count_only_sandhi_answers(tmpdb, monkeypatch):
    monkeypatch.setattr(coach, "RULES_GATE", False)
    s = coach.clean_step({"type": "tone_rules", "rules": ["bu", "nope", "bu"], "mode": "quiz", "target": 8}, set())
    assert s["params"] == {"rules": ["bu"], "mode": "quiz"}
    pid = coach.build("test", run_pipeline=lambda d, reason, run: {"diagnosis": "t", "steps": [s], "milestones": None, "findings": []})
    step = [x for x in coach.state()["steps"] if x["type"] == "tone_rules"][0]
    assert step["href"].startswith("/listening?quiz=rule&rules=bu")
    for unit in ({"kind": "sandhi", "expected": "bu", "actual": 2, "ok": True}, {"kind": "sandhi", "expected": "yi", "actual": 4, "ok": True},
                 {"kind": "tone", "expected": "2", "actual": 2, "ok": True}, {"kind": "sandhi", "expected": "bu", "actual": 4, "ok": False}):
        db.add_event({"area": "listening", "mode": "rule", "item": "不是", "ok": unit["ok"], "details": {"step": step["id"]}, "units": [unit]})
    assert coach.step_progress(coach._step(step["id"])) == {"progress": 1, "tried": 2, "right": 1}
    assert pid


def test_rule_gate_puts_rules_before_sentences(tmpdb):
    rs = coach.rules_status()
    assert rs["open"] and rs["gate"] and set(rs["missing"]) == {"3-3", "bu", "yi"}
    sent = {"type": "speak_sentences", "title": "say sentences", "params": {"texts": ["我很好"], "ids": [1], "reps": 2, "min_score": 80}}
    other = {"type": "listen_tones", "title": "tones", "params": {"tones": [3]}}
    steps, removed = coach.rules_gate([sent, other], rs)
    assert removed == ["say sentences"]
    assert [s["type"] for s in steps][:2] == ["tone_rules", "tone_rules"] and steps[0]["params"].get("learn")
    assert steps[-1]["type"] == "listen_tones" and all(s["type"] != "speak_sentences" for s in steps)

