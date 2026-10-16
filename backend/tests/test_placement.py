"""Placement test: who takes it, how the scores place the learner, and what finish() opens. Token checks are replaced by a fake.
No network calls, no speech model: the voice answers are saved directly, like /api/speech/analyze saves them."""

import time
from collections import Counter

import pytest
from fastapi.testclient import TestClient

from app import auth, coach, db, levels, main, placement
from app.zhuyin import analyze_text

A = {"Authorization": "Bearer token-a"}
B = {"Authorization": "Bearer token-b"}
ONBOARD = {"name": "Ana", "reasons": [], "goal_min": 15, "timezone": "Europe/Paris"}


@pytest.fixture()
def client(pg, monkeypatch):
    async def fake_user_id(request):
        return {"Bearer token-a": "user_a", "Bearer token-b": "user_b"}.get(request.headers.get("authorization"))

    monkeypatch.setattr(auth, "CLERK_SECRET_KEY", "sk_test_fake")
    monkeypatch.setattr(auth, "user_id", fake_user_id)
    monkeypatch.setattr(coach.settings, "LIVE", False)
    return TestClient(main.app)


def onboard(client, level, bopomofo, headers=A):
    r = client.post("/api/onboarding", json={**ONBOARD, "level": level, "bopomofo": bopomofo}, headers=headers)
    assert r.status_code == 200
    return r.json()


def symbol(client, sym, ok, headers=A):
    ev = {
        "area": "recognize",
        "item": sym,
        "ok": ok,
        "first_try": ok,
        "tries": 1,
        "units": [{"kind": "symbol", "expected": sym, "actual": sym if ok else "∅", "ok": ok}],
        "details": {"placement": True},
    }
    return client.post("/api/progress/event", json=ev, headers=headers).json()["id"]


def voice(user, mode, text, sounds_ok, tone_ok, ts=None):
    """One recording as stats.log_speaking saves it: an initial, a final, and a tone unit per syllable of the text."""
    units = []
    for i in analyze_text(text):
        if i["type"] == "syllable":
            units += [
                {
                    "kind": "initial",
                    "expected": i["initial"] or "∅",
                    "actual": i["initial"] if sounds_ok else "ㄆ",
                    "ok": sounds_ok,
                },
                {"kind": "final", "expected": i["final"], "actual": i["final"], "ok": sounds_ok},
                {
                    "kind": "tone",
                    "expected": i["surface_tone"],
                    "actual": i["surface_tone"] if tone_ok else 0,
                    "ok": tone_ok,
                },
            ]
    with db.as_user(user):
        return db.add_event(
            {"area": "speaking", "mode": mode, "item": text, "ok": sounds_ok and tone_ok, "score": 90, "units": units},
            ts=ts,
        )


def unlocks(user="user_a"):
    with db.as_user(user), db.conn() as c:
        return {r["key"] for r in c.execute("SELECT key FROM level_unlocks").fetchall()}


def test_place_compares_the_proven_items_with_the_level_goals():
    need = levels.NEED_SYMS
    good = {
        "cards": 3,
        "symbols": levels.SYMS[:need],
        "tones": [1, 2, 3, 4, 5],
        "missed": [],
    }  # no minimum of recordings
    few_syms = {**good, "symbols": levels.SYMS[: need - 1]}
    three_tones = {**good, "tones": [1, 2, 3]}
    none = {"cards": 0, "symbols": "", "tones": [], "missed": []}
    alpha = {"right": levels.NEED_ALPHABET, "asked": 37}  # the level 1 goal: 30 of 37
    assert placement.place(alpha, good, good)["level"] == 4
    assert (
        placement.place(alpha, good, {**good, "tones": [1, 2, 3, 4]})["level"] == 3
    )  # no neutral tone in the sentences
    assert placement.place(alpha, few_syms, good)["level"] == 2  # sentences do not count without the syllable goals
    assert placement.place(alpha, three_tones, good)["level"] == 2
    assert (
        placement.place({"right": levels.NEED_ALPHABET - 1, "asked": 37}, good, good)["level"] == 1
    )  # good voice, alphabet not known
    p = placement.place({"right": 3, "asked": 37}, none, none)
    assert (
        p["level"] == 1 and p["chapters"]
    )  # the alphabet part was taken: every chapter opens, the stats show the gaps
    assert not placement.place({"right": 0, "asked": 0}, none, none)["chapters"]
    assert placement.place(None, good, good) == {
        "level": 1,
        "alphabet_known": False,
        "syllables_ok": True,
        "sentences_ok": True,
        "chapters": True,
    }


def test_a_voice_item_is_proven_when_it_is_more_often_right_than_wrong():
    def rec(i, kind, expected, ok, try_n=0):
        return {
            "id": i,
            "area": "speaking",
            "mode": "syllable",
            "kind": kind,
            "expected": expected,
            "ok": ok,
            "try_n": try_n,
        }

    rows = [
        rec(1, "final", "ㄧㄢ", True),
        rec(2, "final", "ㄧ", False),
        rec(3, "final", "ㄧ", True),
        rec(4, "final", "ㄢ", False),
        rec(5, "tone", 3, True),
        rec(5, "initial", "∅", False),
        rec(6, "initial", "ㄅ", False),
        rec(6, "initial", "ㄅ", True, try_n=1),
    ]
    v = placement.score_voice(rows, "syllable")
    assert v["symbols"] == "ㄧ" and v["tones"] == [
        3
    ]  # ㄧ: 2 right, 1 wrong. ㄢ: 1 and 1 (not proven). A second try does not count.
    assert v["missed"] == ["ㄅ", "ㄢ"] and v["cards"] == 6


def test_the_voice_part_covers_every_symbol_every_tone_and_every_tone_rule():
    syl = [[i for i in analyze_text(t) if i["type"] == "syllable"] for t in placement.SYLLABLES]
    assert all(len(s) == 1 for s in syl) and len(set(placement.SYLLABLES)) == len(placement.SYLLABLES)
    assert set(levels.SYMS) <= set("".join(s[0]["zhuyin"] for s in syl))  # all 37 symbols
    tones = Counter(s[0]["surface_tone"] for s in syl)
    assert all(tones[t] >= 8 for t in (1, 2, 3, 4))
    sent = [i for t, _ in placement.SENTENCES for i in analyze_text(t) if i["type"] == "syllable"]
    assert {"3-3", "bu", "yi"} <= {i.get("rule") for i in sent} and any(i["surface_tone"] == 5 for i in sent)


def test_only_everyday_and_fluent_learners_take_the_test(client):
    assert onboard(client, "words", "some")["placement"] == "none"
    assert client.post("/api/placement/finish", json={}, headers=A).status_code == 409
    assert onboard(client, "fluent", "none", headers=B)["placement"] == "due"
    c = client.get("/api/placement", headers=B).json()
    assert c["status"] == "due" and not c["alphabet"]
    assert len(c["syllables"]) == len(placement.SYLLABLES) and len(c["sentences"]) == len(placement.SENTENCES)
    assert c["sentences"][0]["items"][0]["zhuyin"]  # the Bopomofo comes from the same analyzer as Speaking


def test_a_good_test_opens_level_four_counts_the_symbols_and_runs_once(client):
    assert onboard(client, "everyday", "reads")["placement"] == "due"
    syms = levels.SYMS
    alpha = [symbol(client, s, i >= 2) for i, s in enumerate(syms)]  # 35 of 37 right
    vids = [voice("user_a", "syllable", t, True, True) for t in placement.SYLLABLES]
    vids += [voice("user_a", "sentence", t, True, True) for t, _ in placement.SENTENCES]
    r = client.post("/api/placement/finish", json={"alphabet_ids": alpha, "voice_ids": vids}, headers=A)
    assert r.status_code == 200
    res = r.json()["result"]
    assert res["level"] == 4 and res["alphabet"]["right"] == len(syms) - 2 and res["syllables"]["symbols"] == syms
    assert res["syllables"]["tones"] == [1, 2, 3, 4] and res["sentences"]["tones"] == [1, 2, 3, 4, 5]
    assert {"level:2", "level:3", "level:4", "chapter:medials", "chapter:finals"} <= unlocks()
    assert client.get("/api/me", headers=A).json()["placement"] == "done"
    assert client.post("/api/placement/finish", json={}, headers=A).status_code == 409
    with db.as_user("user_a"):
        a = coach.alphabet_status()
        assert a["known_count"] >= len(syms) - 2
        assert coach.digest.digest()["overview"]["placement"]["placed_at_level"] == 4
        # A placed symbol that the learner then misses twice is not known any more.
        s = syms[5]
        for _ in range(2):
            db.add_event(
                {
                    "area": "recognize",
                    "item": s,
                    "ok": False,
                    "first_try": False,
                    "units": [{"kind": "symbol", "expected": s, "actual": "ㄅ", "ok": False}],
                }
            )
        assert s not in coach.alphabet_status()["known"]


def test_weak_voice_places_at_two_and_answers_of_others_or_old_ones_do_not_count(client):
    onboard(client, "fluent", "some")
    onboard(client, "fluent", "some", headers=B)
    alpha = [symbol(client, s, True) for s in levels.SYMS]
    other = [symbol(client, s, True, headers=B) for s in levels.SYMS]
    old = [
        voice("user_a", "syllable", t, True, True, ts=time.time() - placement.MAX_AGE - 60) for t in placement.SYLLABLES
    ]
    weak = [voice("user_a", "syllable", t, True, False) for t in placement.SYLLABLES]  # every tone missed
    res = client.post("/api/placement/finish", json={"alphabet_ids": alpha, "voice_ids": old + weak}, headers=A).json()[
        "result"
    ]
    assert (
        res["level"] == 2 and res["syllables"]["cards"] == len(placement.SYLLABLES) and res["syllables"]["tones"] == []
    )
    assert res["syllables"]["symbols"] == levels.SYMS  # the sounds are proven, only the tones are missing
    # user_b sends user_a's answers: none of them are theirs, so nothing is known.
    res_b = client.post("/api/placement/finish", json={"alphabet_ids": alpha, "voice_ids": weak}, headers=B).json()[
        "result"
    ]
    assert res_b["level"] == 1 and res_b["alphabet"]["right"] == 0 and res_b["syllables"]["cards"] == 0
    assert "level:2" not in unlocks("user_b") and other  # user_b's own answers were not sent


def test_skipping_the_test_starts_at_level_one(client):
    onboard(client, "everyday", "none")
    res = client.post("/api/placement/finish", json={"voice_skipped": True}, headers=A).json()["result"]
    assert res["level"] == 1 and res["alphabet"] is None and res["voice_skipped"] and not res["chapters"]
    assert client.get("/api/me", headers=A).json()["placement"] == "done"
