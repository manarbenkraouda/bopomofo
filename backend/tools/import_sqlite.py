r"""Copy the old SQLite data (backend/data/zhuyin.db) into PostgreSQL, as the data of one Clerk user.

    .venv\Scripts\python tools\import_sqlite.py --user user_xxx [--sqlite data\zhuyin.db] [--speaker data\speaker.json]

Sign up and finish the onboarding first, then run this once. Find the user id with "clerk users list".
The account must have no answers and no sentences yet. The rows get new ids, and every link between them is
kept: units to events, steps to plans, step ids inside answers, sentence ids inside steps. The first coach plan
that the onboarding built (from no answers) is replaced by the imported plans. The onboarding answers stay; the old
profile only fills the facts the onboarding left empty. It writes to DATABASE_URL in one transaction.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import db, llm  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--user", required=True, help="Clerk user id (user_...)")
    ap.add_argument("--sqlite", default=str(ROOT / "data" / "zhuyin.db"))
    ap.add_argument("--speaker", default=str(ROOT / "data" / "speaker.json"), help="old pitch reference, if any")
    a = ap.parse_args()
    if not a.user.startswith("user_"):
        sys.exit("--user must be a Clerk user id (user_...)")
    src = sqlite3.connect(a.sqlite)
    src.row_factory = sqlite3.Row
    db.init()
    db.set_user(a.user)
    counts = copy(src, a.user, Path(a.speaker))
    src.close()
    print("Imported for", a.user + ":", ", ".join(f"{k} {v}" for k, v in counts.items()) or "nothing")


def rows(src: sqlite3.Connection, table: str) -> list[dict]:
    have = {r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    return [dict(r) for r in src.execute(f"SELECT * FROM {table} ORDER BY rowid")] if table in have else []


def copy(src: sqlite3.Connection, user: str, speaker: Path) -> dict:
    counts: dict[str, int] = {}
    with db.conn() as c:
        if c.execute("SELECT (SELECT COUNT(*) FROM events) + (SELECT COUNT(*) FROM sentences)").fetchone()[0]:
            sys.exit(f"{user} already has answers or sentences in PostgreSQL. Nothing was imported.")
        cols = {
            t: {r[0] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_name=?", (t,))}
            - {"id", "user_id"}
            for t in ("sentences", "events", "units", "plans", "steps", "milestones", "coach_calls", "coach_notes")
        }

        def insert(table: str, data: list[dict], fix=lambda r: r) -> dict[int, int]:
            """Insert rows with new ids. Returns old id -> new id."""
            new: dict[int, int] = {}
            for r in data:
                r = fix(dict(r))
                keys = [k for k in r if k in cols[table]]
                nid = c.execute(
                    f"INSERT INTO {table}({', '.join(keys)}) VALUES ({', '.join('?' * len(keys))}) RETURNING id",
                    [r[k] for k in keys],
                ).fetchone()["id"]
                new[r["id"]] = nid
            counts[table] = len(data)
            return new

        # The onboarding's first plan was built from no answers: the imported plans replace it.
        for t in ("coach_notes", "coach_calls", "milestones", "steps", "plans"):
            c.execute(f"DELETE FROM {t}")

        sent = insert("sentences", rows(src, "sentences"))
        plans = insert("plans", rows(src, "plans"))

        def fix_step(r):
            r["plan_id"] = plans[r["plan_id"]]
            p = json.loads(r["params"] or "{}")
            if isinstance(p.get("ids"), list):
                p["ids"] = [sent.get(i, i) for i in p["ids"]]
            r["params"] = json.dumps(p, ensure_ascii=False)
            return r

        steps = insert("steps", [r for r in rows(src, "steps") if r["plan_id"] in plans], fix_step)

        def link(r):
            if r.get("plan_id") is not None:
                r["plan_id"] = plans.get(r["plan_id"])
            if r.get("step_id") is not None:
                r["step_id"] = steps.get(r["step_id"])
            return r

        insert("milestones", rows(src, "milestones"), link)
        insert("coach_calls", rows(src, "coach_calls"), link)
        insert("coach_notes", rows(src, "coach_notes"), link)

        def fix_event(r):
            d = json.loads(r["details"] or "{}")
            if isinstance(d.get("step"), int):
                d["step"] = steps.get(d["step"])
            r["details"] = json.dumps(d, ensure_ascii=False)
            return r

        events = insert("events", rows(src, "events"), fix_event)

        units = [u for u in rows(src, "units") if u["event_id"] in events]
        ukeys = [k for k in (units[0] if units else {}) if k in cols["units"]]
        if units:
            c.executemany(
                f"INSERT INTO units({', '.join(ukeys)}) VALUES ({', '.join('?' * len(ukeys))})",
                [[events[u[k]] if k == "event_id" else u[k] for k in ukeys] for u in units],
            )
        counts["units"] = len(units)

        days = rows(src, "days")
        for d in days:
            c.execute(
                "INSERT INTO days(day, seconds, goal_min) VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET "
                "seconds=GREATEST(days.seconds, excluded.seconds)",
                (d["day"], d["seconds"], d.get("goal_min")),
            )
        counts["days"] = len(days)

        # Old attempts that the SQLite app never copied into events (very old databases only).
        meta = {r["key"]: r["value"] for r in rows(src, "meta")}
        if "backfill" not in meta:
            old = rows(src, "attempts")
            for r in old:
                db.add_event(
                    db.legacy_event(r["area"], r["item"], bool(r["ok"]), r["score"], json.loads(r["details"] or "{}")),
                    c=c,
                    ts=r["created"],
                    legacy=True,
                )
            counts["attempts"] = len(old)

    # The profile: the onboarding answers stay, the old facts fill the rest.
    old_profile = next((json.loads(r["data"]) for r in rows(src, "profile")), {})
    now = db.get_profile()
    merged = {
        **{k: v for k, v in old_profile.items() if k in llm.PROFILE_LABELS and str(v).strip()},
        **{k: v for k, v in now.items() if str(v).strip()},
    }
    if merged != now:
        db.set_profile(merged)
        counts["profile facts added"] = len(merged) - len(now)
    if speaker.exists() and not db.get_meta("speaker"):
        db.set_meta("speaker", speaker.read_text())
        counts["pitch reference"] = 1
    return counts


if __name__ == "__main__":
    main()
