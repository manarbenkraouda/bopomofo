"""Traditional characters: the course data, the recognize answers, their stats, levels, and the coach steps on them."""

import pytest

from app import characters, coach, db, levels, stats
from tests.test_coach import fake, unlock_all


@pytest.fixture()
def tmpdb(pg, monkeypatch):
    monkeypatch.setattr(coach.settings, "LIVE", False)
    monkeypatch.setattr(coach.settings, "ALPHABET_GATE", 0)
    monkeypatch.setattr(coach.settings, "RULES_GATE", False)
    unlock_all()


def pick(word, picked, source="deck", step=None):
    ok = word == picked
    return db.add_event(
        {
            "area": "characters",
            "mode": "recognize",
            "item": word,
            "ok": ok,
            "first_try": ok,
            "details": {"step": step} if step else {},
            "units": [
                {
                    "kind": "char",
                    "expected": word,
                    "actual": picked,
                    "ok": ok,
                    "ctx": source,
                    "extra": {"lookalike": picked in characters.lookalike(word)},
                }
            ],
        }
    )


def test_course_data_has_a_reading_and_a_meaning_for_every_word():
    deck = characters.deck()
    assert len(deck) == 34 and deck["妳"]["zhuyin"] == "ㄋㄧˇ" and deck["我們"]["zhuyin"] == "ㄨㄛˇ ˙ㄇㄣ"
    assert all(w["english"] and w["zhuyin"] for w in deck.values())
    # Every look-alike is a course word, and no two words share a meaning (the choices must differ).
    assert all(x in deck for g in characters.data()["lookalikes"] for x in g)
    assert len({w["english"] for w in deck.values()}) == len(deck)
    assert characters.lookalike("他") == ["她", "它"]


def test_valid_words_come_from_the_deck_or_the_learner_sentences():
    assert characters.valid("妳")
    assert characters.valid("咖啡", {"我喜歡喝咖啡。"})
    assert not characters.valid("咖啡")
    assert not characters.valid("abc", {"abc"})
    assert not characters.valid("我喜歡喝咖啡", {"我喜歡喝咖啡"})


def test_answers_feed_the_character_stats(tmpdb):
    pick("他", "她")
    pick("他", "他")
    pick("咖啡", "水", source="sentence")
    s = stats.char_stats()
    assert s["sources"]["deck"] == {"n": 2, "ok": 1, "acc": 50.0, "ms": None}
    assert s["sources"]["sentence"]["n"] == 1
    assert {"expected": "他", "picked": "她", "lookalike": True, "n": 1} in s["mixups"]
    assert {"expected": "咖啡", "picked": "水", "lookalike": False, "n": 1} in s["mixups"]
    assert "他" not in s["never"] and "她" in s["never"]
    assert stats.compute()["characters"]["words"][0]["acc"] == 0.0


def test_level_items_are_the_words(tmpdb):
    pick("妳", "妳")
    with db.conn() as c:
        keys = {(r["exercise"], r["item"]) for r in c.execute("SELECT exercise, item FROM level_items")}
    assert ("characters", "char:妳") in keys
    assert levels.exercise_of("/characters?chars=他,她") == "characters"


def test_clean_step_and_milestone_for_characters(tmpdb):
    op = levels.opened()
    db.add_sentence({"hanzi": "我喜歡喝咖啡。"}, "test", "test")
    s = coach.cleaning.clean_step(
        {"type": "characters", "chars": ["他", "她", "他", "咖啡", "火車", 3], "target": 12}, set(), op=op
    )
    assert s["type"] == "characters" and s["params"]["chars"] == ["他", "她", "咖啡"]
    m = coach.cleaning.clean_milestone(
        {"title": "t", "area": "characters", "unit": "char", "expected": ["他", "她"], "min_acc": 90, "window": 20}
    )
    assert m["criterion"]["expected"] == ["他", "她"]
    bad = {"title": "t", "area": "characters", "unit": "tone", "expected": ["4"], "min_acc": 90, "window": 20}
    assert coach.cleaning.clean_milestone(bad) is None


def test_characters_step_counts_only_its_own_words(tmpdb):
    coach.build("test", run_pipeline=fake([{"type": "characters", "chars": ["他", "她"], "target": 3}]))
    st = coach.state()["steps"][0]
    assert st["href"].startswith("/characters?chars=") and st["href"].endswith(f"&step={st['id']}")
    pick("他", "他")  # outside the step
    pick("他", "他", step=st["id"])
    pick("她", "它", step=st["id"])
    pick("水", "水", step=st["id"])  # another word: does not count
    assert coach.progress.step_progress(coach.store.step(st["id"])) == {"progress": 1, "tried": 2, "right": 1}
    c = {"area": "characters", "unit": "char", "expected": ["他", "她"], "min_acc": 50, "window": 3}
    assert coach.progress.milestone_progress(c) == {"n": 3, "value": 66.7, "reached": True}
