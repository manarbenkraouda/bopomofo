"""Placement test: who takes it, how the scores place the learner, and what finish() opens. Token checks are replaced by a fake.
No network calls, no speech model: the voice answers are saved directly, like /api/speech/analyze saves them."""
import time

import pytest
from fastapi.testclient import TestClient

from app import auth, coach, db, levels, main, placement

A = {"Authorization": "Bearer token-a"}
B = {"Authorization": "Bearer token-b"}
ONBOARD = {"name": "Ana", "reasons": [], "goal_min": 15, "timezone": "Europe/Paris"}


@pytest.fixture()
def client(pg, monkeypatch):
    async def fake_user_id(request):
        return {"Bearer token-a": "user_a", "Bearer token-b": "user_b"}.get(request.headers.get("authorization"))
    monkeypatch.setattr(auth, "CLERK_SECRET_KEY", "sk_test_fake")
    monkeypatch.setattr(auth, "user_id", fake_user_id)
    monkeypatch.setattr(coach, "LIVE", False)
    return TestClient(main.app)


def onboard(client, level, bopomofo, headers=A):
    r = client.post("/api/onboarding", json={**ONBOARD, "level": level, "bopomofo": bopomofo}, headers=headers)
    assert r.status_code == 200
    return r.json()


def symbol(client, sym, ok, headers=A):
    ev = {"area": "recognize", "item": sym, "ok": ok, "first_try": ok, "tries": 1,
          "units": [{"kind": "symbol", "expected": sym, "actual": sym if ok else "∅", "ok": ok}], "details": {"placement": True}}
    return client.post("/api/progress/event", json=ev, headers=headers).json()["id"]


def voice(user, mode, text, sounds_ok, tone_ok, ts=None):
    """One recording as stats.log_speaking saves it: an initial, a final, and a tone unit."""
    with db.as_user(user):
        return db.add_event({"area": "speaking", "mode": mode, "item": text, "ok": sounds_ok and tone_ok, "score": 90,
                             "units": [{"kind": "initial", "expected": "ㄅ", "actual": "ㄅ" if sounds_ok else "ㄆ", "ok": sounds_ok},
                                       {"kind": "final", "expected": "ㄚ", "actual": "ㄚ", "ok": True},
                                       {"kind": "tone", "expected": 1, "actual": 1 if tone_ok else 4, "ok": tone_ok}]}, ts=ts)


def unlocks(user="user_a"):
    with db.as_user(user), db.conn() as c:
        return {r["key"] for r in c.execute("SELECT key FROM level_unlocks").fetchall()}


def test_place_needs_the_alphabet_first_then_syllables_then_sentences():
    good = {"cards": 10, "sounds": 90, "tones": 90, "missed": []}
    bad = {"cards": 10, "sounds": 50, "tones": 90, "missed": []}
    few = {"cards": placement.MIN_SYLLABLES - 1, "sounds": 100, "tones": 100, "missed": []}
    alpha = {"right": placement.ALPHA_PASS}
    assert placement.place(alpha, good, good)["level"] == 4
    assert placement.place(alpha, good, bad)["level"] == 3
    assert placement.place(alpha, bad, good)["level"] == 2  # sentences do not count without good syllables
    assert placement.place(alpha, few, good)["level"] == 2  # too few recordings
    assert placement.place({"right": placement.ALPHA_PASS - 1}, good, good)["level"] == 1  # good voice, alphabet not known
    p = placement.place({"right": placement.ALPHA_OPEN}, bad, bad)
    assert p["level"] == 1 and p["chapters"]
    assert not placement.place({"right": placement.ALPHA_OPEN - 1}, bad, bad)["chapters"]
    assert placement.place(None, good, good) == {"level": 1, "alphabet_known": False, "syllables_ok": True, "sentences_ok": True, "chapters": True}


def test_only_everyday_and_fluent_learners_take_the_test(client):
    assert onboard(client, "words", "some")["placement"] == "none"
    assert client.post("/api/placement/finish", json={}, headers=A).status_code == 409
    assert onboard(client, "fluent", "none", headers=B)["placement"] == "due"
    c = client.get("/api/placement", headers=B).json()
    assert c["status"] == "due" and not c["alphabet"] and len(c["syllables"]) == 10 and len(c["sentences"]) == 4
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
    assert res["level"] == 4 and res["alphabet"]["right"] == len(syms) - 2 and res["syllables"]["sounds"] == 100
    assert {"level:2", "level:3", "level:4", "chapter:medials", "chapter:finals"} <= unlocks()
    assert client.get("/api/me", headers=A).json()["placement"] == "done"
    assert client.post("/api/placement/finish", json={}, headers=A).status_code == 409
    with db.as_user("user_a"):
        a = coach.alphabet_status()
        assert a["known_count"] >= len(syms) - 2
        assert coach.digest()["overview"]["placement"]["placed_at_level"] == 4
        # A placed symbol that the learner then misses twice is not known any more.
        s = syms[5]
        for _ in range(2):
            db.add_event({"area": "recognize", "item": s, "ok": False, "first_try": False,
                          "units": [{"kind": "symbol", "expected": s, "actual": "ㄅ", "ok": False}]})
        assert s not in coach.alphabet_status()["known"]


def test_weak_voice_places_at_two_and_answers_of_others_or_old_ones_do_not_count(client):
    onboard(client, "fluent", "some")
    onboard(client, "fluent", "some", headers=B)
    alpha = [symbol(client, s, True) for s in levels.SYMS]
    other = [symbol(client, s, True, headers=B) for s in levels.SYMS]
    old = [voice("user_a", "syllable", t, True, True, ts=time.time() - placement.MAX_AGE - 60) for t in placement.SYLLABLES]
    weak = [voice("user_a", "syllable", t, True, False) for t in placement.SYLLABLES]  # every tone missed
    res = client.post("/api/placement/finish", json={"alphabet_ids": alpha, "voice_ids": old + weak}, headers=A).json()["result"]
    assert res["level"] == 2 and res["syllables"]["cards"] == len(placement.SYLLABLES) and res["syllables"]["tones"] == 0
    # user_b sends user_a's answers: none of them are theirs, so nothing is known.
    res_b = client.post("/api/placement/finish", json={"alphabet_ids": alpha, "voice_ids": weak}, headers=B).json()["result"]
    assert res_b["level"] == 1 and res_b["alphabet"]["right"] == 0 and res_b["syllables"]["cards"] == 0
    assert "level:2" not in unlocks("user_b") and other  # user_b's own answers were not sent


def test_skipping_the_test_starts_at_level_one(client):
    onboard(client, "everyday", "none")
    res = client.post("/api/placement/finish", json={"voice_skipped": True}, headers=A).json()["result"]
    assert res["level"] == 1 and res["alphabet"] is None and res["voice_skipped"] and not res["chapters"]
    assert client.get("/api/me", headers=A).json()["placement"] == "done"
