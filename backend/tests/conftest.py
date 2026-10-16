"""Tests run on the PostgreSQL database in TEST_DATABASE_URL (backend/.env), never on DATABASE_URL.
Each test starts with empty tables and runs as the user "user_test"."""

import os
from pathlib import Path

import pytest
from dotenv import dotenv_values

_env = dotenv_values(Path(__file__).resolve().parent.parent / ".env")
TEST_URL = os.environ.get("TEST_DATABASE_URL") or _env.get("TEST_DATABASE_URL") or ""
os.environ["DATABASE_URL"] = TEST_URL  # set before app.config is imported

from app import db  # noqa: E402

TABLES = (
    "deep_checks, level_built, level_item_days, level_items, level_notices, level_marks, level_unlocks, coach_jobs, usage_log, coach_notes, coach_calls,"
    " milestones, steps, plans, units, events,"
    " days, meta, profile, sentences"
)


@pytest.fixture(scope="session")
def schema():
    if not TEST_URL:
        pytest.skip("TEST_DATABASE_URL is not set")
    db.init()
    yield
    db.close_pool()


@pytest.fixture()
def pg(schema):
    """Empty tables, user "user_test"."""
    with db.conn() as c:
        c.execute(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE")
    token = db.set_user("user_test")
    yield
    db._user.reset(token)


@pytest.fixture()
def client(pg, monkeypatch):
    """An API client where the tokens of tests/users.py sign in as user_a and user_b. The speech model is not loaded."""
    from fastapi.testclient import TestClient

    from app import auth, coach, main

    async def fake_user_id(request):
        return {"Bearer token-a": "user_a", "Bearer token-b": "user_b"}.get(request.headers.get("authorization"))

    monkeypatch.setattr(auth, "CLERK_SECRET_KEY", "sk_test_fake")
    monkeypatch.setattr(auth, "user_id", fake_user_id)
    monkeypatch.setattr(coach.settings, "LIVE", False)  # no plan is built after the onboarding
    return TestClient(main.app)  # not a context manager: the startup does not run
