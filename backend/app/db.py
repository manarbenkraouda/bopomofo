"""PostgreSQL storage for sentences and practice history.

History has three tables:
- events: one row per graded answer (a card, a recording, a quiz question).
- units: one row per part of that answer that has an expected value and, when known, what the learner
  actually produced: a tone, an initial, a final, a symbol, a syllable, or a stroke. Confusion tables
  ("tone 3 said as tone 2") are simple GROUP BY queries on this table.
- days: active practice seconds per day, synced from the browser clock.

Every table has a user_id column (the Clerk user id). Row-level security in the database shows each connection
only the rows of the user set with set_user(), and fills user_id on insert. So the queries in this app never
name the user, and a query cannot read or change the data of another user. Without a user, a connection sees no rows.

The schema is in app/migrations/*.sql, applied in order at startup. SQL uses ? placeholders.
"""
from __future__ import annotations

import contextvars
import json
import queue
import ssl
import threading
import time
from collections import defaultdict
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pg8000.dbapi

from . import config

pg8000.dbapi.paramstyle = "qmark"  # pg8000 reads the style from the module only
UNIT_KINDS = {"tone", "initial", "final", "symbol", "syllable", "stroke", "order"}
MIGRATIONS = Path(__file__).parent / "migrations"
POOL_SIZE = 10
NUMERIC_OID = 1700

_user: contextvars.ContextVar[str | None] = contextvars.ContextVar("user_id", default=None)


def set_user(user_id: str | None) -> contextvars.Token:
    """The user of the current request. Every connection opened after this sees only this user's rows."""
    return _user.set(user_id)


def current_user() -> str | None:
    return _user.get()


@contextmanager
def as_user(user_id: str | None):
    """Run a block as this user, then go back to the user before."""
    token = _user.set(user_id)
    try:
        yield
    finally:
        _user.reset(token)


_background: set[threading.Thread] = set()
_background_lock = threading.Lock()


def spawn(fn, *args) -> threading.Thread:
    """Run fn in a background thread as the current user. wait_background() waits for it before the API stops."""
    ctx = contextvars.copy_context()

    def run():
        try:
            ctx.run(fn, *args)
        finally:
            with _background_lock:
                _background.discard(threading.current_thread())

    t = threading.Thread(target=run, daemon=True)
    with _background_lock:
        _background.add(t)
    t.start()
    return t


def wait_background(timeout: float) -> int:
    """Wait until the background work (coach plans, stories, checkpoints, voices) is done, at most timeout seconds.
    Work started meanwhile is waited for too. Returns how many threads still run."""
    deadline = time.monotonic() + timeout
    while True:
        with _background_lock:
            running = [t for t in _background if t.is_alive()]
        left = deadline - time.monotonic()
        if not running or left <= 0:
            return len(running)
        running[0].join(min(left, 1.0))


# ---------- connections ----------

class Row(tuple):
    """A result row that reads by position or by column name, like sqlite3.Row. dict(row) works."""
    _cols: tuple = ()
    _idx: dict = {}

    def __getitem__(self, k):
        return super().__getitem__(self._idx[k] if isinstance(k, str) else k)

    def keys(self):
        return list(self._cols)


class Result:
    def __init__(self, cur):
        self.rowcount = cur.rowcount
        cols = tuple(d[0] for d in cur.description or ())
        row = type("Row", (Row,), {"_cols": cols, "_idx": {c: i for i, c in enumerate(cols)}})
        self._rows = [row(r) for r in cur.fetchall()] if cur.description else []
        self._at = 0

    def fetchone(self):
        if self._at >= len(self._rows):
            return None
        self._at += 1
        return self._rows[self._at - 1]

    def fetchall(self):
        out, self._at = self._rows[self._at:], len(self._rows)
        return out

    def __iter__(self):
        return iter(self.fetchall())


def _arg(v):
    return int(v) if isinstance(v, bool) else v


class Conn:
    """A pooled connection. execute() takes ? placeholders."""

    def __init__(self, raw):
        self.raw = raw

    def execute(self, sql: str, args=()) -> Result:
        cur = self.raw.cursor()
        cur.execute(sql, tuple(_arg(a) for a in args))
        return Result(cur)

    def executemany(self, sql: str, rows, chunk: int = 200) -> None:
        """INSERT ... VALUES (?,...) for many rows, sent as one multi-row INSERT per chunk."""
        head, sep, values = sql.rpartition(" VALUES ")
        if not sep or not values.strip().startswith("("):
            raise ValueError("executemany takes an INSERT ... VALUES (...) statement")
        rows = [tuple(r) for r in rows]
        for i in range(0, len(rows), chunk):
            part = rows[i:i + chunk]
            self.execute(head + " VALUES " + ",".join([values.strip()] * len(part)), tuple(a for r in part for a in r))


def _connect():
    url = config.DATABASE_URL
    if not url:
        raise RuntimeError("DATABASE_URL is not set. Add it to backend/.env (see backend/.env.example).")
    u = urlparse(url)
    if u.scheme not in ("postgres", "postgresql"):
        raise RuntimeError("DATABASE_URL must start with postgresql://")
    mode = (parse_qs(u.query).get("sslmode") or [""])[0]
    local = u.hostname in ("localhost", "127.0.0.1", "::1")
    if mode == "disable" or (not mode and local):
        ctx = None
    elif mode in ("require", "prefer", "allow"):  # encrypted, certificate not checked (libpq semantics)
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    else:  # verify-ca, verify-full, or no sslmode on a remote host
        ctx = ssl.create_default_context()
    raw = pg8000.dbapi.connect(user=unquote(u.username or ""), password=unquote(u.password or ""), host=u.hostname or "localhost",
                               port=u.port or 5432, database=unquote(u.path.lstrip("/")) or None, ssl_context=ctx,
                               timeout=60, application_name="bopomofo")
    raw.register_in_adapter(NUMERIC_OID, float)  # AVG() and similar: float, not Decimal
    return raw


_pool: queue.LifoQueue = queue.LifoQueue()


def _close(raw):
    try:
        raw.close()
    except Exception:  # noqa: BLE001
        pass


@contextmanager
def conn():
    """A transaction as the current user. Commits at the end, rolls back on an error."""
    uid = _user.get() or ""
    raw = None
    for fresh in (False, True):
        try:
            raw = _pool.get_nowait() if not fresh else _connect()
        except queue.Empty:
            raw = _connect()
        try:
            Conn(raw).execute("SELECT set_config('app.user_id', ?, false)", (uid,))
            break
        except (pg8000.dbapi.InterfaceError, OSError):  # a dropped pooled connection
            _close(raw)
            if fresh:
                raise
    c = Conn(raw)
    try:
        yield c
        raw.commit()
    except BaseException:
        try:
            raw.rollback()
        except Exception:  # noqa: BLE001
            _close(raw)
            raw = None
        raise
    finally:
        if raw is not None:
            if _pool.qsize() < POOL_SIZE:
                _pool.put(raw)
            else:
                _close(raw)


def close_pool():
    while True:
        try:
            _close(_pool.get_nowait())
        except queue.Empty:
            return


# ---------- schema ----------

def init():
    """Check the database role and apply the new migrations. Safe to run from several workers at once."""
    raw = _connect()
    try:
        raw.autocommit = True
        cur = raw.cursor()
        cur.execute("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user")
        if cur.fetchone()[0] and not config.ALLOW_RLS_BYPASS:
            raise RuntimeError("DATABASE_URL logs in as a role that skips row-level security (a superuser or BYPASSRLS), "
                               "so every user would see all data. Use a normal role that owns the database (see README.md).")
        cur.execute("SELECT pg_advisory_lock(727001)")
        try:
            cur.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now())")
            cur.execute("SELECT version FROM schema_migrations")
            done = {r[0] for r in cur.fetchall()}
            for f in sorted(MIGRATIONS.glob("*.sql")):
                if f.name in done:
                    continue
                try:
                    raw.execute_simple("BEGIN;\n" + f.read_text(encoding="utf-8") +
                                       f"\nINSERT INTO schema_migrations(version) VALUES ('{f.name}');\nCOMMIT;")
                except Exception:
                    raw.execute_simple("ROLLBACK")
                    raise
        finally:
            cur.execute("SELECT pg_advisory_unlock(727001)")
    finally:
        _close(raw)


# ---------- profile, sentences, small values ----------

def get_profile() -> dict:
    with conn() as c:
        r = c.execute("SELECT data FROM profile").fetchone()
    return json.loads(r["data"]) if r else {}


def set_profile(data: dict) -> dict:
    with conn() as c:
        c.execute("INSERT INTO profile(data) VALUES (?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data", (json.dumps(data, ensure_ascii=False),))
    return get_profile()


def get_meta(key: str) -> str | None:
    if not _user.get():
        return None
    with conn() as c:
        r = c.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return r["value"] if r else None


def set_meta(key: str, value: str | None):
    with conn() as c:
        if value is None:
            c.execute("DELETE FROM meta WHERE key=?", (key,))
        else:
            c.execute("INSERT INTO meta(key, value) VALUES (?,?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value", (key, value))


# ---------- settings and time zone ----------
# One JSON value per user (meta key "settings"): timezone, goal_min, level, bopomofo, reasons, onboarded_at.

_tz_cache: dict[str, tuple[float, ZoneInfo]] = {}
TZ_CACHE_SECONDS = 60


def valid_timezone(name: str | None) -> str | None:
    """The IANA name if it is a real time zone (Europe/Paris, Asia/Taipei...), else None."""
    if not name or len(name) > 64 or name.startswith(("/", ".")) or ".." in name:
        return None
    try:
        ZoneInfo(name)
        return name
    except (ZoneInfoNotFoundError, ValueError):
        return None


def get_settings() -> dict:
    try:
        v = get_meta("settings")
        return json.loads(v) if v else {}
    except ValueError:
        return {}


def save_settings(changes: dict) -> dict:
    s = {**get_settings(), **changes}
    set_meta("settings", json.dumps(s, ensure_ascii=False))
    _tz_cache.pop(_user.get() or "", None)
    return s


def user_tz() -> ZoneInfo:
    """The current user's time zone. Their days start at midnight there."""
    uid = _user.get()
    hit = _tz_cache.get(uid or "")
    if hit and hit[0] > time.monotonic():
        return hit[1]
    name = valid_timezone(get_settings().get("timezone") if uid else None) or valid_timezone(config.DEFAULT_TIMEZONE) or "UTC"
    tz = ZoneInfo(name)
    if uid:
        _tz_cache[uid] = (time.monotonic() + TZ_CACHE_SECONDS, tz)
    return tz


def local_today() -> date:
    return datetime.now(user_tz()).date()


def day_of(ts: float) -> str:
    return datetime.fromtimestamp(ts, user_tz()).strftime("%Y-%m-%d")


def hour_of(ts: float) -> int:
    return datetime.fromtimestamp(ts, user_tz()).hour


def day_start(d: date) -> float:
    """The time stamp of midnight at the start of day d, in the user's time zone."""
    return datetime.combine(d, datetime.min.time(), tzinfo=user_tz()).timestamp()


def add_sentence(s: dict, topic: str, level: str) -> dict:
    with conn() as c:
        sid = c.execute("INSERT INTO sentences(hanzi, english, words, topic, level, created) VALUES (?,?,?,?,?,?) RETURNING id",
                        (s["hanzi"], s.get("english", ""), json.dumps(s.get("words", []), ensure_ascii=False), topic, level, time.time())).fetchone()["id"]
    return get_sentence(sid)


def _row(r) -> dict:
    d = dict(r)
    d.pop("user_id", None)
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


def speaking_by_text() -> dict[str, dict]:
    """Per spoken text: how many recordings, the best and the last score, and when it was last said."""
    with conn() as c:
        rows = c.execute("SELECT item, score, ts FROM events WHERE area='speaking' AND score IS NOT NULL ORDER BY ts").fetchall()
    out: dict[str, dict] = {}
    for r in rows:
        p = out.setdefault(r["item"], {"said": 0, "best": 0, "last": 0, "ts": 0})
        p["said"] += 1
        p["best"] = max(p["best"], round(r["score"]))
        p["last"] = round(r["score"])
        p["ts"] = r["ts"]
    return out


def _b(v) -> int | None:
    return None if v is None else int(bool(v))


def _s(v) -> str | None:
    return None if v is None else str(v)[:64]


def add_event(ev: dict, c: Conn | None = None, ts: float | None = None, legacy: bool = False) -> int:
    """Save one graded answer and its units. ev keys: area, mode, item, ok, first_try, score, ms, tries, help,
    replays, details, units (list of dicts: kind, expected, actual, ok, pos, try_n, help, ctx, lex, prev, next,
    source, uncertain, extra)."""
    ts = ts or time.time()
    day = day_of(ts)
    if c is None:
        with conn() as own:
            return add_event(ev, own, ts, legacy)
    eid = c.execute(
        "INSERT INTO events(ts, day, area, mode, item, ok, first_try, score, ms, tries, help, replays, legacy, details)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id",
        (ts, day, ev["area"], ev.get("mode"), str(ev["item"])[:400], int(bool(ev["ok"])), _b(ev.get("first_try")), ev.get("score"),
         ev.get("ms"), ev.get("tries"), int(bool(ev.get("help"))), ev.get("replays"), int(legacy),
         json.dumps(ev.get("details") or {}, ensure_ascii=False))).fetchone()["id"]
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
    return eid


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


def save_day(day: str, seconds: int, goal_min: int | None):
    """Active seconds for a day. The browser clock only grows during a day, so keep the larger value."""
    with conn() as c:
        c.execute("INSERT INTO days(day, seconds, goal_min) VALUES (?,?,?) ON CONFLICT(user_id, day) DO UPDATE SET "
                  "seconds=GREATEST(days.seconds, excluded.seconds), goal_min=COALESCE(excluded.goal_min, days.goal_min)",
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
    d = today or local_today()
    if d.isoformat() not in days:
        d -= timedelta(days=1)
    n = 0
    while d.isoformat() in days:
        n += 1
        d -= timedelta(days=1)
    return n

