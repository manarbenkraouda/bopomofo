"""The API needs a Clerk sign-in, and each signed-in user reaches only their own data. Token checks are replaced by a fake."""

import numpy as np

from app import auth, coach, db, llm, tts
from tests.users import A, B


def test_sign_in_is_required(client):
    assert client.get("/api/profile").status_code == 401
    assert client.get("/api/stats").status_code == 401
    assert client.get("/api/progress/memory", params={"area": "reading"}).status_code == 401
    assert client.get("/api/profile", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/api/health").status_code == 200 and client.get("/api/health").json()["speaker_hz"] is None
    assert client.get("/api/tts/voices").status_code == 200
    assert client.get("/api/tts", params={"text": "你好"}).status_code == 401
    assert client.post("/api/tts/cache/clear").status_code == 401


def test_review_memory_is_per_user(client):
    ev = {"area": "listening", "mode": "tone", "item": "ㄇㄚˇ", "ok": True, "first_try": True, "units": []}
    assert client.post("/api/progress/event", json=ev, headers=A).status_code == 200
    a = client.get("/api/progress/memory", params={"area": "listening", "mode": "tone"}, headers=A).json()
    assert [g for _, g, *_ in a["items"]["ㄇㄚˇ"]] == [1] and a["now"] >= a["items"]["ㄇㄚˇ"][0][0]
    assert (
        client.get("/api/progress/memory", params={"area": "listening", "mode": "zhuyin"}, headers=A).json()["items"]
        == {}
    )
    assert (
        client.get("/api/progress/memory", params={"area": "listening", "mode": "tone"}, headers=B).json()["items"]
        == {}
    )


def test_each_user_clears_only_their_own_audio(client, monkeypatch, tmp_path):
    class Voice:
        def generate(self, text, sid=0, speed=1.0):
            return tts._Audio(np.full(2205, 0.1, np.float32), 22050)

    monkeypatch.setattr(tts, "DATA_DIR", tmp_path)
    monkeypatch.setattr(tts, "_engines", {"kokoro": Voice(), "breeze2": Voice()})
    for user in (A, B):
        r = client.get("/api/tts", params={"text": "你好"}, headers=user)
        assert r.status_code == 200 and r.headers["cache-control"].startswith("private")
    assert client.post("/api/tts/cache/clear", headers=B).json()["files"] == 1
    assert len(list((tmp_path / "tts" / "user_a").glob("*.wav"))) == 1  # A keeps their audio
    assert not list((tmp_path / "tts" / "user_b").glob("*.wav"))


def test_each_user_reaches_only_their_data(client):
    assert client.put("/api/profile", json={"name": "Ana"}, headers=A).json() == {"name": "Ana"}
    assert client.get("/api/profile", headers=B).json() == {}
    ev = {
        "area": "listening",
        "mode": "tone",
        "item": "ㄇㄚˇ",
        "ok": True,
        "units": [{"kind": "tone", "expected": "3", "ok": True}],
    }
    assert client.post("/api/progress/event", json=ev, headers=A).json()["ok"]
    assert client.get("/api/progress/summary", headers=A).json()["attempts"] == 1
    assert client.get("/api/progress/summary", headers=B).json()["attempts"] == 0
    assert "ㄇㄚˇ" in client.get("/api/stats/export.csv", headers=A).text
    assert "ㄇㄚˇ" not in client.get("/api/stats/export.csv", headers=B).text


def test_no_secret_key_means_no_access(client, monkeypatch):
    monkeypatch.setattr(auth, "CLERK_SECRET_KEY", "")
    assert client.get("/api/profile", headers=A).status_code == 503
    assert client.get("/api/health").status_code == 200


ONBOARD = {
    "name": "Ana",
    "reasons": ["travel", "family"],
    "level": "words",
    "bopomofo": "none",
    "goal_min": 15,
    "timezone": "Asia/Taipei",
}


def test_onboarding_saves_the_answers(client):
    me = client.get("/api/me", headers=A).json()
    assert not me["onboarded"] and not me["timezone_set"]
    assert client.post("/api/onboarding", json={**ONBOARD, "timezone": "Mars/Base"}, headers=A).status_code == 400
    assert client.post("/api/onboarding", json={**ONBOARD, "reasons": ["money"]}, headers=A).status_code == 422
    me = client.post("/api/onboarding", json=ONBOARD, headers=A).json()
    assert (
        me["onboarded"]
        and me["timezone"] == "Asia/Taipei"
        and me["goal_min"] == 15
        and me["sentence_level"] == "beginner"
    )
    p = client.get("/api/profile", headers=A).json()
    assert (
        p["name"] == "Ana"
        and "Bopomofo" in p["level"]
        and p["why_mandarin"].startswith("I learn Mandarin to travel in Taiwan")
    )
    assert not client.get("/api/me", headers=B).json()["onboarded"]  # another user is not onboarded
    me = client.put("/api/settings", json={"timezone": "Europe/Paris", "goal_min": 30}, headers=A).json()
    assert (me["timezone"], me["goal_min"]) == ("Europe/Paris", 30)
    assert client.put("/api/settings", json={"timezone": "../etc/passwd"}, headers=A).status_code == 400


def test_days_follow_the_learner_time_zone(pg):
    ts = 1791590400.0  # 2026-10-10 00:00 UTC: 08:00 on 10 October in Taipei, 20:00 on 9 October in New York
    db.save_settings({"timezone": "Asia/Taipei"})
    assert db.day_of(ts) == "2026-10-10"
    db.add_event({"area": "listening", "item": "x", "ok": True}, ts=ts)
    db.save_settings({"timezone": "America/New_York"})
    assert db.day_of(ts) == "2026-10-09" and db.hour_of(ts) == 20
    with db.conn() as c:
        assert c.execute("SELECT day FROM events").fetchone()[0] == "2026-10-10"  # saved with the zone of that moment


def test_first_plan_waits_for_the_onboarding_and_the_full_profile(pg, monkeypatch):
    started = []
    monkeypatch.setattr(coach.planner, "start", lambda reason, as_next=False: started.append(reason) or False)
    coach.state()
    assert started == []
    db.save_settings({"onboarded_at": 1.0})
    db.set_profile({"name": "Ana", "level": "I am new to Mandarin."})
    coach.state()
    assert started == []  # the profile is not complete: Home asks for it first
    db.set_profile(dict.fromkeys(llm.PROFILE_LABELS, "x"))
    coach.state()
    assert started == ["First plan for this learner, with the full profile."]


def test_onboarding_does_not_start_a_plan(client, monkeypatch):
    started = []
    monkeypatch.setattr(coach.planner, "start", lambda reason, as_next=False: started.append(reason) or False)
    assert client.post("/api/onboarding", json=ONBOARD, headers=A).json()["onboarded"]
    assert started == []
