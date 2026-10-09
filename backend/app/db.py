"""SQLite storage for sentences and practice attempts."""
from __future__ import annotations

import json
import sqlite3
import time
from collections import defaultdict

from .config import DATA_DIR

DB = DATA_DIR / "zhuyin.db"


def conn():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
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
        """)


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


def add_attempt(area: str, item: str, ok: bool, score: float | None, details: dict | None):
    with conn() as c:
        c.execute("INSERT INTO attempts(area, item, ok, score, details, created) VALUES (?,?,?,?,?,?)",
                  (area, item, int(ok), score, json.dumps(details or {}, ensure_ascii=False), time.time()))


def summary() -> dict:
    now = time.time()
    with conn() as c:
        rows = c.execute("SELECT area, ok, score, details, created FROM attempts ORDER BY id DESC LIMIT 5000").fetchall()
        n_sent = c.execute("SELECT COUNT(*) FROM sentences").fetchone()[0]
    areas = defaultdict(lambda: {"total": 0, "ok": 0, "week": 0})
    sym = defaultdict(lambda: {"n": 0, "err": 0})
    tones = defaultdict(lambda: {"n": 0, "err": 0})
    days = set()
    for r in rows:
        a = areas[r["area"]]
        a["total"] += 1
        a["ok"] += r["ok"]
        if now - r["created"] < 7 * 86400:
            a["week"] += 1
        days.add(time.strftime("%Y-%m-%d", time.localtime(r["created"])))
        d = json.loads(r["details"] or "{}")
        for s in d.get("symbols", []):
            sym[s["sym"]]["n"] += 1
            sym[s["sym"]]["err"] += 0 if s["ok"] else 1
        for t in d.get("tones", []):
            tones[str(t["tone"])]["n"] += 1
            tones[str(t["tone"])]["err"] += 0 if t["ok"] else 1
    streak = 0
    day = now
    while time.strftime("%Y-%m-%d", time.localtime(day)) in days:
        streak += 1
        day -= 86400
    return {"areas": dict(areas), "symbols": dict(sym), "tones": dict(tones), "sentences": n_sent, "day_streak": streak, "attempts": len(rows)}
