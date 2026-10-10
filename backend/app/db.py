"""SQLite storage for sentences and practice history.

History has three tables:
- events: one row per graded answer (a card, a recording, a quiz question).
- units: one row per part of that answer that has an expected value and, when known, what the learner
  actually produced: a tone, an initial, a final, a symbol, a syllable, or a stroke. Confusion tables
  ("tone 3 said as tone 2") are simple GROUP BY queries on this table.
- days: active practice seconds per day, synced from the browser clock.
The old attempts table is kept as an archive. Its rows are copied into events and units once.
"""
from __future__ import annotations

import json
import sqlite3
import time
from collections import defaultdict
from datetime import date, timedelta

from .config import DATA_DIR

DB = DATA_DIR / "zhuyin.db"
UNIT_KINDS = {"tone", "initial", "final", "symbol", "syllable", "stroke", "order"}


def conn():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    return c


def init():
    with conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS sentences (
          id INTEGER PRIMARY KEY AUTOINCREMENT, hanzi TEXT NOT NULL, english TEXT, words TEXT,
          topic TEXT, level TEXT, created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT, area TEXT NOT NULL, item TEXT NOT NULL,
          ok INTEGER NOT NULL, score REAL, details TEXT, created REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS attempts_area ON attempts(area, created);
        CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, day TEXT NOT NULL, area TEXT NOT NULL, mode TEXT,
          item TEXT NOT NULL, ok INTEGER NOT NULL, first_try INTEGER, score REAL, ms INTEGER, tries INTEGER,
          help INTEGER NOT NULL DEFAULT 0, replays INTEGER, legacy INTEGER NOT NULL DEFAULT 0, details TEXT);
        CREATE INDEX IF NOT EXISTS events_day ON events(day, area);
        CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
        CREATE TABLE IF NOT EXISTS units (
          id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          ts REAL NOT NULL, day TEXT NOT NULL, area TEXT NOT NULL, mode TEXT, kind TEXT NOT NULL,
          expected TEXT NOT NULL, actual TEXT, ok INTEGER, pos INTEGER NOT NULL DEFAULT 0, try_n INTEGER NOT NULL DEFAULT 0,
          help INTEGER NOT NULL DEFAULT 0, ctx TEXT, lex TEXT, prev TEXT, next TEXT, source TEXT,
          uncertain INTEGER NOT NULL DEFAULT 0, extra TEXT);
        CREATE INDEX IF NOT EXISTS units_kind ON units(kind, area, expected);
        CREATE INDEX IF NOT EXISTS units_day ON units(day);
        CREATE INDEX IF NOT EXISTS units_event ON units(event_id);
        CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, seconds INTEGER NOT NULL DEFAULT 0, goal_min INTEGER);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS plans (
          id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, status TEXT NOT NULL, source TEXT, model TEXT,
          diagnosis TEXT, reason TEXT, digest TEXT, raw TEXT, error TEXT, done_ts REAL);
        CREATE TABLE IF NOT EXISTS steps (
          id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE, pos INTEGER NOT NULL,
          type TEXT NOT NULL, title TEXT NOT NULL, why TEXT, params TEXT NOT NULL, target INTEGER NOT NULL, minutes INTEGER,
          status TEXT NOT NULL DEFAULT 'open', done_ts REAL, skip_reason TEXT, checked_n INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS milestones (
          id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, plan_id INTEGER, title TEXT NOT NULL, why TEXT,
          criterion TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', done_ts REAL);
        CREATE TABLE IF NOT EXISTS coach_calls (
          id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, run TEXT, plan_id INTEGER, step_id INTEGER, stage TEXT NOT NULL,
          model TEXT, ms INTEGER, cost REAL, tokens INTEGER, ok INTEGER NOT NULL, error TEXT, response TEXT);
        CREATE TABLE IF NOT EXISTS coach_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, plan_id INTEGER, step_id INTEGER, kind TEXT NOT NULL, text TEXT NOT NULL);
        """)
        cols = {r[1] for r in c.execute("PRAGMA table_info(steps)")}
        if "checked_n" not in cols:
            c.execute("ALTER TABLE steps ADD COLUMN checked_n INTEGER NOT NULL DEFAULT 0")
        plan_cols = {r[1] for r in c.execute("PRAGMA table_info(plans)")}
        for col in ("headline", "story"):  # the plan's short headline and its "How do we know?" story (JSON)
            if col not in plan_cols:
                c.execute(f"ALTER TABLE plans ADD COLUMN {col} TEXT")
    backfill()


def get_profile() -> dict:
    with conn() as c:
        r = c.execute("SELECT data FROM profile WHERE id=1").fetchone()
    return json.loads(r["data"]) if r else {}


def set_profile(data: dict) -> dict:
    with conn() as c:
        c.execute("INSERT INTO profile(id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", (json.dumps(data, ensure_ascii=False),))
    return get_profile()


def add_sentence(s: dict, topic: str, level: str) -> dict:
    with conn() as c:
        cur = c.execute("INSERT INTO sentences(hanzi, english, words, topic, level, created) VALUES (?,?,?,?,?,?)",
                        (s["hanzi"], s.get("english", ""), json.dumps(s.get("words", []), ensure_ascii=False), topic, level, time.time()))
        sid = cur.lastrowid
    return get_sentence(sid)


def _row(r) -> dict:
    d = dict(r)
    d["words"] = json.loads(d["words"] or "[]")
    return d


def get_sentence(sid: int) -> dict | None:
    with conn() as c:
        r = c.execute("SELECT * FROM sentences WHERE id=?", (sid,)).fetchone()
    return _row(r) if r else None


def list_sentences(limit: int = 200) -> list[dict]:
    with conn() as c:
        return [_row(r) for r in c.execute("SELECT * FROM sentences ORDER BY id DESC LIMIT ?", (limit,))]


def delete_sentence(sid: int):
    with conn() as c:
        c.execute("DELETE FROM sentences WHERE id=?", (sid,))


def day_of(ts: float) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(ts))


def _b(v) -> int | None:
    return None if v is None else int(bool(v))


def _s(v) -> str | None:
    return None if v is None else str(v)[:64]


def add_event(ev: dict, c: sqlite3.Connection | None = None, ts: float | None = None, legacy: bool = False) -> int:
    """Save one graded answer and its units. ev keys: area, mode, item, ok, first_try, score, ms, tries, help,
    replays, details, units (list of dicts: kind, expected, actual, ok, pos, try_n, help, ctx, lex, prev, next,
    source, uncertain, extra)."""
    ts = ts or time.time()
    day = day_of(ts)
    own = c is None
    c = c or conn()
    try:
        cur = c.execute(
            "INSERT INTO events(ts, day, area, mode, item, ok, first_try, score, ms, tries, help, replays, legacy, details)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (ts, day, ev["area"], ev.get("mode"), str(ev["item"])[:400], int(bool(ev["ok"])), _b(ev.get("first_try")), ev.get("score"),
             ev.get("ms"), ev.get("tries"), int(bool(ev.get("help"))), ev.get("replays"), int(legacy),
             json.dumps(ev.get("details") or {}, ensure_ascii=False)))
        eid = cur.lastrowid
        rows = []
        for u in ev.get("units") or []:
            if u.get("kind") not in UNIT_KINDS or u.get("expected") in (None, ""):
                continue
            rows.append((eid, ts, day, ev["area"], ev.get("mode"), u["kind"], str(u["expected"])[:64], _s(u.get("actual")),
                         _b(u.get("ok")), int(u.get("pos") or 0), int(u.get("try_n") or 0), int(bool(u.get("help"))),
                         _s(u.get("ctx")), _s(u.get("lex")), _s(u.get("prev")), _s(u.get("next")), _s(u.get("source")),
                         int(bool(u.get("uncertain"))), json.dumps(u["extra"], ensure_ascii=False) if u.get("extra") else None))
        c.executemany(
            "INSERT INTO units(event_id, ts, day, area, mode, kind, expected, actual, ok, pos, try_n, help, ctx, lex, prev, next, source, uncertain, extra)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        if own:
            c.commit()
        return eid
    finally:
        if own:
            c.close()


def legacy_event(area: str, item: str, ok: bool, score: float | None, details: dict | None) -> dict:
    """Turn an old-style attempt (area, item, ok, details) into an event with units."""
    d = details or {}
    mode = d.get("mode") or d.get("quiz")
    if area == "writing" and mode == "dictation":
        area, mode = "dictation", None
    if area == "speaking" and not mode:
        mode = "syllable" if len(item) == 1 else "sentence"
    helped = bool(d.get("revealed") or d.get("cheated"))
    marks = {"ˊ": 2, "ˇ": 3, "ˋ": 4, "˙": 5}
    units = [{"kind": "tone", "expected": marks[s["sym"]], "ok": s.get("ok"), "pos": i, "help": helped} if s.get("sym") in marks else
             {"kind": "symbol", "expected": s.get("sym"), "ok": s.get("ok"), "pos": i, "help": helped}
             for i, s in enumerate(d.get("symbols") or []) if s.get("sym")]
    units += [{"kind": "tone", "expected": t.get("tone"), "ok": t.get("ok"), "pos": i}
              for i, t in enumerate((d.get("tones") or []) + (d.get("heard_tones") or [])) if t.get("tone") is not None]
    first = ok if area in ("reading", "dictation") else None
    return {"area": area, "mode": mode, "item": item, "ok": ok, "first_try": first, "score": score,
            "tries": d.get("tries"), "help": helped, "details": d, "units": units}


def backfill():
    """Copy the old attempts rows into events and units, once."""
    with conn() as c:
        if c.execute("SELECT value FROM meta WHERE key='backfill'").fetchone():
            return
        rows = c.execute("SELECT * FROM attempts ORDER BY id").fetchall()
        for r in rows:
            add_event(legacy_event(r["area"], r["item"], bool(r["ok"]), r["score"], json.loads(r["details"] or "{}")),
                      c=c, ts=r["created"], legacy=True)
        c.execute("INSERT INTO meta(key, value) VALUES ('backfill', ?)", (str(len(rows)),))


def save_day(day: str, seconds: int, goal_min: int | None):
    """Active seconds for a day. The browser clock only grows during a day, so keep the larger value."""
    with conn() as c:
        c.execute("INSERT INTO days(day, seconds, goal_min) VALUES (?,?,?) ON CONFLICT(day) DO UPDATE SET "
                  "seconds=MAX(seconds, excluded.seconds), goal_min=COALESCE(excluded.goal_min, goal_min)",
                  (day, max(0, int(seconds)), goal_min))


def summary() -> dict:
    """Short totals for the home screen and for weighting the practice picks."""
    now = time.time()
    with conn() as c:
        ev = c.execute("SELECT area, ok, ts, day FROM events").fetchall()
        sym_rows = c.execute("SELECT area, expected, ok, help FROM units WHERE kind='symbol' AND try_n=0").fetchall()
        tone_rows = c.execute("SELECT expected, ok FROM units WHERE kind='tone' AND area='speaking' AND ok IS NOT NULL").fetchall()
        active = {r[0] for r in c.execute("SELECT day FROM days WHERE seconds > 0")}
        n_sent = c.execute("SELECT COUNT(*) FROM sentences").fetchone()[0]
    areas = defaultdict(lambda: {"total": 0, "ok": 0, "week": 0})
    days = set(active)
    for r in ev:
        a = areas[r["area"]]
        a["total"] += 1
        a["ok"] += r["ok"]
        if now - r["ts"] < 7 * 86400:
            a["week"] += 1
        days.add(r["day"])
    sym = defaultdict(lambda: {"n": 0, "err": 0})
    by_area: dict[str, dict] = defaultdict(lambda: defaultdict(lambda: {"n": 0, "err": 0}))
    for r in sym_rows:
        bad = 0 if (r["ok"] and not r["help"]) else 1
        for d in (sym[r["expected"]], by_area[r["area"]][r["expected"]]):
            d["n"] += 1
            d["err"] += bad
    tones = defaultdict(lambda: {"n": 0, "err": 0})
    for r in tone_rows:
        tones[r["expected"]]["n"] += 1
        tones[r["expected"]]["err"] += 0 if r["ok"] else 1
    return {"areas": dict(areas), "symbols": dict(sym), "symbols_by_area": {k: dict(v) for k, v in by_area.items()},
            "tones": dict(tones), "sentences": n_sent, "day_streak": streak(days), "attempts": len(ev)}


def streak(days: set[str], today: date | None = None) -> int:
    """Days in a row with practice, up to today. A day without practice yet today does not break it."""
    d = today or date.today()
    if d.isoformat() not in days:
        d -= timedelta(days=1)
    n = 0
    while d.isoformat() in days:
        n += 1
        d -= timedelta(days=1)
    return n
