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

TABLES = "coach_jobs, usage_log, coach_notes, coach_calls, milestones, steps, plans, units, events, days, meta, profile, sentences"


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
