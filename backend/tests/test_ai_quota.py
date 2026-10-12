"""Daily AI energy: server timing, user isolation, and paid-work admission. No provider calls."""
import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from app import coach, db, limits, llm
from tests.test_auth import A, B, client  # noqa: F401


def at(day, zone="Europe/Paris"):
    return datetime.fromisoformat(day).replace(tzinfo=ZoneInfo(zone)).timestamp()


def freeze(monkeypatch, value):
    clock = [value]
    monkeypatch.setattr(limits.time, "time", lambda: clock[0])
    monkeypatch.setattr(limits, "AI_DAILY_LIMIT_USD", 1.0)
    monkeypatch.setattr(limits, "AI_DAILY_CALLS", 400)
    return clock


def test_ai_wait_ends_at_local_midnight(client, monkeypatch):
    clock = freeze(monkeypatch, at("2026-10-11T23:59:59"))
    with db.as_user("user_a"):
        db.save_settings({"timezone": "Europe/Paris"})
        limits.record("ai", 1.0)
    r = client.get("/api/ai/quota", headers=A)
    q = r.json()
    assert r.headers["cache-control"] == "no-store"
    assert q["blocked"] and q["remaining_percent"] == 0
    assert q["resets_at"] == at("2026-10-12T00:00:00") and q["resets_at"] - q["server_now"] == 1
    r = client.post("/api/text/translate", json={"text": "你好"}, headers=A)
    assert r.status_code == 429 and r.json()["ai_quota"] == q and r.headers["retry-after"] == "1"
    clock[0] = q["resets_at"]
    q = client.get("/api/ai/quota", headers=A).json()
    assert not q["blocked"] and q["remaining_percent"] == 100 and q["calls"] == 0 and q["cost"] == 0

    async def translate(text):
        limits.check_ai()
        limits.record("ai", 0.1)
        return {"english": "Hello", "words": []}

    monkeypatch.setattr(llm, "translate", translate)
    r = client.post("/api/text/translate", json={"text": "你好"}, headers=A)
    assert r.status_code == 200 and r.json()["ai_quota"]["remaining_percent"] == 90


@pytest.mark.parametrize("day,next_day,hours", [
    ("2026-03-29T00:00:00", "2026-03-30T00:00:00", 23),
    ("2026-10-25T00:00:00", "2026-10-26T00:00:00", 25),
])
def test_refill_follows_daylight_saving_days(client, monkeypatch, day, next_day, hours):
    freeze(monkeypatch, at(day))
    with db.as_user("user_a"):
        db.save_settings({"timezone": "Europe/Paris"})
    q = client.get("/api/ai/quota", headers=A).json()
    assert q["resets_at"] == at(next_day) and q["resets_at"] - q["period_started_at"] == hours * 3600


def test_quota_is_private_and_counts_calls_without_cost(client, monkeypatch):
    freeze(monkeypatch, at("2026-10-11T12:00:00"))
    monkeypatch.setattr(limits, "AI_DAILY_CALLS", 2)
    with db.as_user("user_a"):
        limits.record("ai")
        limits.record("ai")
    assert client.get("/api/ai/quota").status_code == 401
    assert client.get("/api/ai/quota", headers=A).json()["blocked"]
    q = client.get("/api/ai/quota", headers=B).json()
    assert q["user_id"] == "user_b" and q["calls"] == 0 and q["remaining_percent"] == 100
    # Reading the countdown adds no usage, practice answer, or coach call.
    with db.as_user("user_b"), db.conn() as c:
        assert c.execute("SELECT COUNT(*) FROM usage_log").fetchone()[0] == 0
        assert c.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0
        assert c.execute("SELECT COUNT(*) FROM coach_calls").fetchone()[0] == 0


def test_manual_and_background_coach_wait_without_starting_jobs(client, monkeypatch):
    freeze(monkeypatch, at("2026-10-11T12:00:00"))
    started = []
    monkeypatch.setattr(coach, "LIVE", True)
    monkeypatch.setattr(db, "spawn", lambda *args: started.append(args))
    with db.as_user("user_a"):
        limits.record("ai", 1.0)
        db.save_settings({"onboarded_at": 1})
        with db.conn() as c:
            pid = c.execute("INSERT INTO plans(ts,status) VALUES (?,?) RETURNING id", (limits.time.time(), "active")).fetchone()[0]
        assert coach.start("new plan") is False
        assert coach.start_story(pid) is False
    assert client.post("/api/coach/plan", json={"reason": "new plan"}, headers=A).status_code == 429
    assert client.post(f"/api/coach/plan/{pid}/story", headers=A).status_code == 429
    r = client.get("/api/coach", headers=A)
    assert r.status_code == 200 and r.json()["ai_quota"]["blocked"] and not r.json()["generating"]
    assert started == []


def test_coach_does_not_retry_another_model_on_quota(pg, monkeypatch):
    calls = []

    async def denied(*args, **kwargs):
        calls.append(True)
        raise limits.LimitReached("Wait for the refill.")

    monkeypatch.setattr(llm, "_chat", denied)
    with pytest.raises(limits.LimitReached):
        asyncio.run(coach.call("test", "test", {}, "test"))
    assert calls == [True]


def test_due_checkpoint_waits_for_the_refill(pg, monkeypatch):
    freeze(monkeypatch, at("2026-10-11T12:00:00"))
    monkeypatch.setattr(coach, "ALPHABET_GATE", 0)  # keep the tone step; this test is about the checkpoint wait
    monkeypatch.setattr(coach, "RULES_GATE", False)  # the tone rule gate has its own test
    coach.build("test", run_pipeline=lambda *args: {"steps": [coach.clean_step({"type": "listen_tones", "tones": [2, 3], "target": 50}, set())], "diagnosis": "x"})
    sid = coach.state()["steps"][0]["id"]
    for _ in range(coach.CHECK_EVERY):
        db.add_event({"area": "listening", "item": "x", "ok": True, "details": {"step": sid},
                      "units": [{"kind": "tone", "expected": "3", "actual": "3", "ok": True}]})
    started = []
    monkeypatch.setattr(coach, "LIVE", True)
    monkeypatch.setattr(coach, "_bg", lambda fn, *args: started.append(fn.__name__))
    limits.record("ai", 1.0)
    assert coach.refresh()["checking"] == [] and started == []
    assert coach._step(sid)["checked_n"] == 0  # still due
    with db.conn() as c:
        c.execute("DELETE FROM usage_log")
    assert coach.refresh()["checking"] == [sid] and started == ["checkpoint"]
