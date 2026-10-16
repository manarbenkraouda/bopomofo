"""Story: the headline and the "How do we know?" cards. The model is replaced by fakes; no network."""

import asyncio
import json

import pytest

from app import coach, db, story


@pytest.fixture()
def tmpdb(pg, monkeypatch):
    monkeypatch.setattr(coach.settings, "LIVE", False)
    monkeypatch.setattr(coach.settings, "ALPHABET_GATE", 30)
    monkeypatch.setattr(coach.settings, "RULES_GATE", False)  # the tone rule gate has its own test


FACTS = {
    "tone.listen.4.pct": {"key": "tone.listen.4.pct", "label": "tone 4 right by ear", "value": 78.6, "unit": "%"},
    "practice.minutes.7d": {"key": "practice.minutes.7d", "label": "minutes", "value": 36, "unit": "min"},
    "practice.minutes_by_day": {
        "key": "practice.minutes_by_day",
        "label": "per day",
        "series": True,
        "unit": "min",
        "values": [3, 0, 33],
        "labels": ["a", "b", "c"],
    },
}


def test_numbers_come_only_from_facts():
    card, errors = story.clean_card(
        {
            "blocks": [
                {"type": "text", "props": {"text": "Tone 4 is right {tone.listen.4.pct} of the time."}},
                {"type": "big_number", "props": {"value": {"$fact": "practice.minutes.7d"}, "label": "minutes"}},
            ]
        },
        FACTS,
    )
    assert not errors and card["blocks"][0]["props"]["text"] == "Tone 4 is right 79% of the time."
    assert (
        story.check_text("{practice.minutes.7d} minutes of practice", 140, FACTS, "t", [], True)
        == "36 minutes of practice"
    )  # no doubled unit
    assert card["blocks"][1]["props"]["value"]["value"] == 36 and card["blocks"][1]["props"]["value"]["unit"] == "min"
    # A digit typed by the model, or an unknown fact, fails the strict check; the loose check drops the block.
    bad = {
        "blocks": [
            {"type": "text", "props": {"text": "You practiced 36 minutes."}},
            {"type": "ring", "props": {"value": {"$fact": "nope"}, "label": "x"}},
            {"type": "headline", "props": {"text": "Fine."}},
        ]
    }
    card, errors = story.clean_card(bad, FACTS)
    assert card is None and any("digit" in e for e in errors) and any("unknown fact" in e for e in errors)
    card, _ = story.clean_card(bad, FACTS, strict=False)
    assert [b["type"] for b in card["blocks"]] == ["headline"]
    # A series fact cannot be a single number, and a ring needs a percentage.
    _, errors = story.clean_card(
        {"blocks": [{"type": "ring", "props": {"value": {"$fact": "practice.minutes.7d"}, "label": "x"}}]}, FACTS
    )
    assert errors


def test_catalog_limits():
    blocks = (
        [{"type": "dance", "props": {}}]
        + [{"type": "big_number", "props": {"value": {"$fact": "practice.minutes.7d"}, "label": "m"}}] * 3
        + [{"type": "text", "props": {"text": "word " * 60}}]
    )
    card, errors = story.clean_card({"blocks": blocks}, FACTS, strict=False)
    assert [b["type"] for b in card["blocks"]] == [
        "big_number",
        "big_number",
        "text",
    ]  # unknown type dropped, max 2 charts
    assert len(card["blocks"][2]["props"]["text"]) <= 140 and any("unknown type" in e for e in errors)
    assert (
        story.clean_card({"blocks": [{"type": "dance"}]}, FACTS, strict=False)[0] is None
    )  # nothing left: the card is dropped
    one = {"id": "x", "mood": "warm", "seconds": 6, "blocks": [{"type": "headline", "props": {"text": "Hi"}}]}
    cards = story.finish([dict(one, blocks=list(one["blocks"])) for _ in range(5)], [])
    assert cards[-1]["blocks"][-1]["type"] == "cta" and sum(b["type"] == "cta" for c in cards for b in c["blocks"]) == 1
    assert [c["id"] for c in cards] == ["c1", "c2", "c3", "c4", "c5"]
    assert "symbol_grid" in story.catalog_text() and "[chart]" in story.catalog_text()


def test_headline_check():
    ok, _ = story.check_headline(
        "Your ears speak fluent tone; your eyes are still meeting the symbols. Today we fix that.", gate=True
    )
    assert ok
    assert story.check_headline("One. Two. Three.", gate=False)[0] is None
    assert story.check_headline("You are right 86% of the time.", gate=False)[0] is None
    assert story.check_headline("Tone 2 keeps sneaking up. This plan tames it.", gate=False)[
        0
    ]  # a tone name is not a number
    assert (
        story.check_headline("Your tones are lovely. Keep going.", gate=True)[0] is None
    )  # the alphabet must be mentioned


def test_model_story_and_fallback(tmpdb):
    pid = coach.build(
        "test",
        run_pipeline=lambda d, r, run: {
            "diagnosis": "x",
            "findings": [],
            "milestones": None,
            "steps": [coach.cleaning.clean_step({"type": "listen_tones", "tones": [2, 3]}, set())],
        },
    )
    plan = coach.store.plan(pid)
    assert plan["headline"] and json.loads(plan["story"])["source"] == "rules"  # no model in tests: the fixed story
    st = coach.state()
    assert st["plan"]["headline"] == plan["headline"] and st["plan"]["has_story"] and st["history"][0]["headline"]
    spec = story.get(pid)
    assert (
        3 <= len(spec["cards"]) <= 10 and spec["cards"][-1]["blocks"][-1]["type"] == "cta" and spec["context"]["steps"]
    )

    calls = []

    async def ask(stage, task, payload):
        calls.append(stage)
        if stage.startswith("headline"):
            # The first headline has a number: it is sent back with the problems.
            return {
                "headline": "Your ears are 86% there."
                if stage.endswith("#1")
                else "Your ears are ahead; your eyes are still meeting the symbols. We fix that today."
            }
        if stage == "story:outline":
            return {"cards": [{"id": f"c{i}", "topic": "t", "facts": [], "mood": "calm"} for i in range(6)]}
        if stage.endswith("#1") and stage.startswith("story:card2"):
            return {
                "card": {"blocks": [{"type": "text", "props": {"text": "You did 36 minutes."}}]}
            }  # a typed number: retried
        return {
            "card": {
                "mood": "bright",
                "blocks": [
                    {"type": "headline", "props": {"text": "You know {alphabet.known} so far."}},
                    {"type": "symbol_grid", "props": {"highlight": ["ㄒ", "x"]}},
                ],
            }
        }

    d = json.loads(plan["digest"])
    out = story.make(d, coach.store.steps(pid), coach.planner.state_milestones(), None, [], ask)
    assert out["headline_source"] == "llm" and "86" not in out["headline"] and out["story"]["source"] == "llm"
    assert "story:card2#2" in calls and "headline#2" in calls
    cards = out["story"]["cards"]
    assert len(cards) == 6 and cards[0]["blocks"][0]["props"]["text"] == "You know 0 so far."
    assert cards[0]["blocks"][1]["props"]["highlight"] == ["ㄒ"] and cards[-1]["blocks"][-1]["type"] == "cta"

    async def broken(stage, task, payload):
        raise RuntimeError("no credit")

    out = story.make(d, coach.store.steps(pid), coach.planner.state_milestones(), None, [], broken)
    assert out["story"]["source"] == "rules" and out["headline"] == story.template_headline(True) and out["errors"]


def test_older_plan_gets_a_story(tmpdb):
    pid = coach.build(
        "test",
        run_pipeline=lambda d, r, run: {
            "diagnosis": "x",
            "findings": [],
            "milestones": None,
            "steps": [coach.cleaning.clean_step({"type": "listen_tones", "tones": [2, 3]}, set())],
        },
    )
    d = json.loads(coach.store.plan(pid)["digest"])
    d.pop("story")
    with db.conn() as c:  # a plan saved before the story existed
        c.execute("UPDATE plans SET headline=NULL, story=NULL, digest=? WHERE id=?", (json.dumps(d), pid))
    assert story.get(pid) is None and not coach.state()["plan"]["has_story"]
    story.write(pid, live=False)
    assert story.get(pid)["cards"] and coach.state()["plan"]["has_story"]
    assert asyncio.iscoroutinefunction(coach.model.call)
