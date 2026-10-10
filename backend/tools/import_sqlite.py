r"""Copy the old SQLite data (backend/data/zhuyin.db) into PostgreSQL, as the data of one Clerk user.

    .venv\Scripts\python tools\import_sqlite.py --user user_xxx [--sqlite data\zhuyin.db]

Run it once, for an account that has no data yet. Row ids are kept, so the links between rows (units to events,
steps to plans, step ids inside answers) stay right. It writes to DATABASE_URL from backend/.env, in one transaction.
Find your user id with "clerk users list" or in the Clerk dashboard.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import db  # noqa: E402

# In order: rows that others point to come first.
TABLES = ["sentences", "events", "units", "days", "profile", "plans", "steps", "milestones", "coach_calls", "coach_notes"]
WITH_ID = {"sentences", "events", "units", "plans", "steps", "milestones", "coach_calls", "coach_notes"}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--user", required=True, help="Clerk user id (user_...)")
    ap.add_argument("--sqlite", default=str(ROOT / "data" / "zhuyin.db"))
    a = ap.parse_args()
    if not a.user.startswith("user_"):
        sys.exit("--user must be a Clerk user id (user_...)")
    src = sqlite3.connect(a.sqlite)
    src.row_factory = sqlite3.Row
    have = {r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type='table'")}

    db.init()
    db.set_user(a.user)
    try:
        counts = copy(src, have, a.user)
    except Exception as e:  # noqa: BLE001
        if "23505" in str(e):  # unique violation: another account already uses some of these ids
            sys.exit("Some row ids are already used by another account, so the links between rows cannot be kept. "
                     "Import into a database that has no other accounts yet. Nothing was imported.")
        raise
    src.close()
    print("Imported for", a.user + ":", ", ".join(f"{k} {v}" for k, v in counts.items()) or "nothing")


def copy(src: sqlite3.Connection, have: set[str], user: str) -> dict:
    counts = {}
    with db.conn() as c:
        if c.execute("SELECT (SELECT COUNT(*) FROM events) + (SELECT COUNT(*) FROM sentences) + (SELECT COUNT(*) FROM plans)").fetchone()[0]:
            sys.exit(f"{user} already has data in PostgreSQL. Nothing was imported.")
        for t in TABLES:
            if t not in have:
                continue
            pg_cols = {r[0] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_name=?", (t,))} - {"user_id"}
            rows = src.execute(f"SELECT * FROM {t}").fetchall()
            if not rows:
                continue
            cols = [k for k in rows[0].keys() if k in pg_cols]
            c.executemany(f"INSERT INTO {t}({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                          [[r[k] for k in cols] for r in rows])
            counts[t] = len(rows)
        # Old attempts that the SQLite app never copied into events (very old databases only).
        if "attempts" in have and not ("meta" in have and src.execute("SELECT 1 FROM meta WHERE key='backfill'").fetchone()):
            n = 0
            for r in src.execute("SELECT * FROM attempts ORDER BY id"):
                db.add_event(db.legacy_event(r["area"], r["item"], bool(r["ok"]), r["score"], json.loads(r["details"] or "{}")),
                             c=c, ts=r["created"], legacy=True)
                n += 1
            counts["attempts"] = n
        # The id counters must start after the copied ids (and after the ids of other users).
        for t in WITH_ID:
            c.execute(f"SELECT setval(pg_get_serial_sequence('{t}', 'id'), GREATEST((SELECT last_value FROM {t}_id_seq),"
                      f" COALESCE((SELECT MAX(id) FROM {t}), 1)))")
    return counts


if __name__ == "__main__":
    main()
