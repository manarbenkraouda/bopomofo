"""Placement test: learners who say they speak everyday Mandarin or more take it once, after the onboarding.

Two parts, both saved as normal answers through the normal endpoints, so the stats, the stars, and the coach see them:
  1. The alphabet (only when the learner said they know some Bopomofo): each of the 37 symbols, type its sound in pinyin.
     These are Recognize answers (area "recognize", details.placement).
  2. The voice: say 42 single syllables (every initial, medial, and final, and the four tones), then 12 sentences (the neutral tone and
     the tone rules 3-3, 不, 一). These are Speaking answers (modes "syllable" and "sentence");
     the speech model checks each initial, final, and tone, with the tone changes.

The test only fills the stats and loads the level before the first plan. There is no pass mark and no minimum number of
recordings: an item that the learner did not answer is not proven, and that is all. finish() reads the saved answers of the
test (by event id, only the learner's own rows), finds the items they prove, and compares them with the goals of the levels
(levels.py), so the level is the one the answers show:
  - A symbol is proven when it is typed right on the first try. In the voice parts, a symbol or a tone is proven when its
    first recordings are more often right than wrong.
  - The level 1 goal met with the typed symbols (30 of 37): the alphabet is known. Level 2 opens, and the coach counts those symbols as known.
  - Also the level 3 goals for sounds and tones met with the syllables (34 of 37 symbols, the 4 tones): level 3.
  - Also the level 4 goal met with the sentences (the 5 tones): level 4. Free speaking (level 5) still needs the normal goals.
  - The alphabet part taken, or a symbol proven by voice: the three alphabet chapters open at once.
Unlocks are permanent, like the other unlocks. The test only adds unlocks; it never closes anything.
"""

from __future__ import annotations

import time
from collections import Counter

from . import db, levels
from .zhuyin import analyze_text

# Who takes the test: the onboarding levels "everyday" (intermediate) and "fluent" (advanced).
LEVELS_WITH_TEST = ("everyday", "fluent")
MAX_AGE = 6 * 3600  # answers older than this are not part of this test

# The voice test, about 10 minutes with the alphabet. Syllables: each of the 21 initials, the 3 medials, and the 13 finals at least once
# (tests/test_placement.py checks it), alone and in pairs (ㄧㄢ ㄨㄥ ㄩㄝ ...), and 9-12 syllables of each tone. Common characters only.
SYLLABLES = [
    "八",
    "婆",
    "買",
    "飛",
    "到",
    "頭",
    "難",
    "冷",
    "歌",
    "看",
    "很",
    "家",
    "去",
    "學",
    "知",
    "吃",
    "水",
    "熱",
    "字",
    "菜",
    "四",
    "忙",
    "二",
    "魚",
    "五",
    "衣",
    "天",
    "心",
    "中",
    "火",
    "月",
    "想",
    "錢",
    "好",
    "書",
    "人",
    "遠",
    "雲",
    "聽",
    "晚",
    "要",
    "對",
]
# Sentences: every tone, the neutral tone, the 3-3 rule (also in chains), 不 before tone 4, and 一 before tones 1, 3, and 4.
SENTENCES = [
    ("你好嗎？", "How are you?"),
    ("你要喝什麼？", "What do you want to drink?"),
    ("這個不太貴。", "This one is not too expensive."),
    ("我們明天去台北。", "Tomorrow we go to Taipei."),
    ("我不知道。", "I don't know."),
    ("我想買一杯咖啡。", "I want to buy a cup of coffee."),
    ("一起去吃飯吧！", "Let's go eat together!"),
    ("他是我的老師。", "He is my teacher."),
    ("這裡的水果很好吃。", "The fruit here is very good."),
    ("一共多少錢？", "How much is it in total?"),
    ("你喜歡學中文嗎？", "Do you like learning Chinese?"),
    ("我每天早上喝茶。", "I drink tea every morning."),
]


def due(settings: dict | None = None) -> bool:
    s = db.get_settings() if settings is None else settings
    return (s.get("placement") or {}).get("status") == "due"


def on_onboarding(level: str) -> None:
    """Called when the onboarding is saved: the test is due for the intermediate and advanced levels, once."""
    s = db.get_settings()
    if level in LEVELS_WITH_TEST and (s.get("placement") or {}).get("status") != "done":
        db.save_settings({"placement": {"status": "due", "ts": time.time()}})


def content() -> dict:
    """What the test asks. One source for the page: the Bopomofo and the tones come from the same analyzer as Speaking."""
    s = db.get_settings()
    return {
        "status": (s.get("placement") or {}).get("status") or "none",
        "alphabet": s.get("bopomofo") in ("some", "reads"),
        "symbols": levels.SYMS,
        "syllables": [{"text": t, "items": analyze_text(t)} for t in SYLLABLES],
        "sentences": [{"text": t, "english": e, "items": analyze_text(t)} for t, e in SENTENCES],
        "result": (s.get("placement") or {}).get("result"),
    }


def _rows(event_ids: list[int]) -> list[dict]:
    if not event_ids:
        return []
    ph = ",".join("?" * len(event_ids))
    with db.conn() as c:
        return [
            dict(r)
            for r in c.execute(
                "SELECT e.id, e.area, e.mode, e.ts, u.kind, u.expected, u.ok, u.help, u.try_n FROM events e JOIN units u ON u.event_id = e.id"
                f" WHERE e.id IN ({ph}) AND e.ts >= ? ORDER BY u.id",
                (*event_ids, time.time() - MAX_AGE),
            ).fetchall()
        ]


def score_alphabet(rows: list[dict]) -> dict:
    """Right: a symbol typed right on the first try. Symbols not asked (the test stopped early) count as not known."""
    right = {
        r["expected"]
        for r in rows
        if r["area"] == "recognize"
        and r["kind"] == "symbol"
        and r["ok"]
        and not r["help"]
        and not r["try_n"]
        and r["expected"] in levels.BOPOMOFO
    }
    asked = {r["expected"] for r in rows if r["area"] == "recognize" and r["kind"] == "symbol"}
    known = "".join(s for s in levels.SYMS if s in right)
    return {"right": len(known), "of": len(levels.SYMS), "asked": len(asked), "known": known}


def score_voice(rows: list[dict], mode: str) -> dict:
    """The symbols and tones the recordings prove: first recording of each card only, more often right than wrong."""
    rs = [r for r in rows if r["area"] == "speaking" and r["mode"] == mode and not r["try_n"]]
    right, wrong = Counter(), Counter()
    for r in rs:
        if r["kind"] in ("initial", "final", "tone") and r["ok"] is not None:
            for k in levels._keys_of(r["kind"], str(r["expected"])):
                (right if r["ok"] else wrong)[k] += 1
    symbols = "".join(s for s in levels.SYMS if right[s] > wrong[s])
    return {
        "cards": len({r["id"] for r in rs}),
        "symbols": symbols,
        "tones": [int(t[5:]) for t in levels.TONES5 if right[t] > wrong[t]],
        "missed": [s for s in levels.SYMS if s in wrong and s not in symbols][:20],
    }


def place(alpha: dict | None, syl: dict, sent: dict) -> dict:
    """The level and the unlocks from the proven items and the goals of the levels. Pure: no database."""
    alpha_ok = bool(alpha) and alpha["right"] >= levels.NEED_ALPHABET  # the level 1 goal
    syl_ok = len(syl["symbols"]) >= levels.NEED_SYMS and {1, 2, 3, 4} <= set(
        syl["tones"]
    )  # the level 3 goals for sounds and tones
    sent_ok = {1, 2, 3, 4, 5} <= set(sent["tones"])  # the level 4 goal
    level = 1 + alpha_ok + (alpha_ok and syl_ok) + (alpha_ok and syl_ok and sent_ok)
    chapters = bool(alpha and alpha["asked"]) or bool(syl["symbols"] or sent["symbols"])
    return {
        "level": level,
        "alphabet_known": alpha_ok,
        "syllables_ok": syl_ok,
        "sentences_ok": sent_ok,
        "chapters": chapters,
    }


def finish(alphabet_ids: list[int], voice_ids: list[int], voice_skipped: bool) -> dict:
    """Score the test, save the unlocks and the result, and return the result."""
    s = db.get_settings()
    alpha_on = s.get("bopomofo") in ("some", "reads")
    rows = _rows(sorted(set(alphabet_ids) | set(voice_ids)))
    alpha = score_alphabet([r for r in rows if r["id"] in set(alphabet_ids)]) if alpha_on else None
    voice = [r for r in rows if r["id"] in set(voice_ids)]
    syl, sent = score_voice(voice, "syllable"), score_voice(voice, "sentence")
    p = place(alpha, syl, sent)
    now = time.time()
    keys = [f"level:{n}" for n in range(2, p["level"] + 1)] + (
        ["chapter:medials", "chapter:finals"] if p["chapters"] else []
    )
    with db.conn() as c:
        before = {r["key"] for r in c.execute("SELECT key FROM level_unlocks").fetchall()}
        for k in keys:
            c.execute("INSERT INTO level_unlocks(key, ts) VALUES (?, ?) ON CONFLICT DO NOTHING", (k, now))
        new_levels = [k for k in keys if k.startswith("level:") and k not in before]
        if new_levels:
            top = levels.LEVELS[p["level"] - 1]
            names = ", ".join(
                levels.EXERCISES[e][0] for k in new_levels for e in levels.LEVELS[int(k[6:]) - 1]["opens"]
            )
            c.execute(
                "INSERT INTO level_notices(ts, kind, key, title, text) VALUES (?,?,?,?,?)",
                (
                    now,
                    "unlock",
                    f"level:{top['n']}",
                    f"Placement: level {top['n']}, {top['title']}",
                    f"Open now: {names}.",
                ),
            )
    result = {
        **p,
        "alphabet": alpha,
        "syllables": syl,
        "sentences": sent,
        "voice_skipped": bool(voice_skipped),
        "title": levels.LEVELS[max(p["level"], levels.opened()["level"]) - 1]["title"],
        "ts": now,
    }
    db.save_settings({"placement": {**(s.get("placement") or {}), "status": "done", "result": result}})
    return result


def result() -> dict | None:
    return ((db.get_settings().get("placement") or {}).get("result")) or None


def known_symbols() -> str:
    """Symbols the learner typed right in a passed alphabet test. The coach counts them as known (see coach.alphabet_status)."""
    r = result()
    return (r.get("alphabet") or {}).get("known", "") if r and r.get("alphabet_known") else ""


def coach_view() -> dict | None:
    """What the coach models get: the placement result, without the internal fields."""
    r = result()
    if not r:
        return None
    a = r.get("alphabet")
    return {
        "placed_at_level": r["level"],
        "alphabet": f"{a['right']} of {a['of']} symbols typed right" if a else "not tested",
        "alphabet_known": r["alphabet_known"],
        "syllables": _voice_view(r["syllables"]),
        "sentences": _voice_view(r["sentences"]),
        "voice_skipped": r["voice_skipped"],
        "day": db.day_of(r["ts"]),
    }


def _voice_view(v: dict) -> dict:
    return {
        "recorded": v.get("cards", 0),
        "symbols_said_right": v.get("symbols", ""),
        "tones_said_right": v.get("tones", []),
        "symbols_missed": v.get("missed", []),
    }
