"""Placement test: learners who say they speak everyday Mandarin or more take it once, after the onboarding.

Two parts, both saved as normal answers through the normal endpoints, so the stats, the stars, and the coach see them:
  1. The alphabet (only when the learner said they know some Bopomofo): each of the 37 symbols, type its sound in pinyin.
     These are Recognize answers (area "recognize", details.placement).
  2. The voice: say 42 single syllables (every initial, medial, and final, and the four tones), then 12 sentences (the neutral tone and
     the tone rules 3-3, 不, 一). These are Speaking answers (modes "syllable" and "sentence");
     the speech model checks each initial, final, and tone, with the tone changes.

finish() reads the saved answers of the test (by event id, only the learner's own rows) and places the learner:
  - ALPHA_PASS symbols or more right: the alphabet is known. Level 2 opens, and the coach counts those symbols as known.
  - The alphabet known and the syllables right (sounds and tones): level 3.
  - Also the sentences right: level 4 (sentences). Free speaking (level 5) still needs the normal goals.
  - ALPHA_OPEN symbols or more right, or good syllables: the three alphabet chapters open at once.
Unlocks are permanent, like the other unlocks. The test only adds unlocks; it never closes anything.
"""
from __future__ import annotations

import time

from . import db, levels
from .zhuyin import analyze_text

# Who takes the test: the onboarding levels "everyday" (intermediate) and "fluent" (advanced).
LEVELS_WITH_TEST = ("everyday", "fluent")
# Thresholds. First estimates, not calibrated on real learners yet.
ALPHA_PASS = levels.NEED_SYMS  # 34 of 37 (90%), the same share as the level 1 goal
ALPHA_OPEN = 22  # 60%: open every alphabet chapter, but the alphabet is not known yet
SOUNDS_PASS = 80  # percent of initials and finals right
TONES_PASS = 75  # percent of tones right
MIN_SYLLABLES = 30  # of 42: fewer recorded syllables (too many skipped), and the syllable part does not count
MIN_SENTENCES = 8  # of 12
MAX_AGE = 6 * 3600  # answers older than this are not part of this test

# The voice test, about 10 minutes with the alphabet. Syllables: each of the 21 initials, the 3 medials, and the 13 finals at least once
# (tests/test_placement.py checks it), alone and in pairs (ㄧㄢ ㄨㄥ ㄩㄝ ...), and 9-12 syllables of each tone. Common characters only.
SYLLABLES = ["八", "婆", "買", "飛", "到", "頭", "難", "冷", "歌", "看", "很", "家", "去", "學", "知", "吃", "水", "熱", "字", "菜", "四",
             "忙", "二", "魚", "五", "衣", "天", "心", "中", "火", "月", "想", "錢", "好", "書", "人", "遠", "雲", "聽", "晚", "要", "對"]
# Sentences: every tone, the neutral tone, the 3-3 rule (also in chains), 不 before tone 4, and 一 before tones 1, 3, and 4.
SENTENCES = [("你好嗎？", "How are you?"), ("你要喝什麼？", "What do you want to drink?"),
             ("這個不太貴。", "This one is not too expensive."), ("我們明天去台北。", "Tomorrow we go to Taipei."),
             ("我不知道。", "I don't know."), ("我想買一杯咖啡。", "I want to buy a cup of coffee."),
             ("一起去吃飯吧！", "Let's go eat together!"), ("他是我的老師。", "He is my teacher."),
             ("這裡的水果很好吃。", "The fruit here is very good."), ("一共多少錢？", "How much is it in total?"),
             ("你喜歡學中文嗎？", "Do you like learning Chinese?"), ("我每天早上喝茶。", "I drink tea every morning.")]


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
    return {"status": (s.get("placement") or {}).get("status") or "none", "alphabet": s.get("bopomofo") in ("some", "reads"),
            "symbols": levels.SYMS,
            "syllables": [{"text": t, "items": analyze_text(t)} for t in SYLLABLES],
            "sentences": [{"text": t, "english": e, "items": analyze_text(t)} for t, e in SENTENCES],
            "result": (s.get("placement") or {}).get("result")}


def _pct(ok: int, n: int) -> int | None:
    return round(100 * ok / n) if n else None


def _rows(event_ids: list[int]) -> list[dict]:
    if not event_ids:
        return []
    ph = ",".join("?" * len(event_ids))
    with db.conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT e.id, e.area, e.mode, e.ts, u.kind, u.expected, u.ok, u.help, u.try_n FROM events e JOIN units u ON u.event_id = e.id"
            f" WHERE e.id IN ({ph}) AND e.ts >= ? ORDER BY u.id", (*event_ids, time.time() - MAX_AGE)).fetchall()]


def score_alphabet(rows: list[dict]) -> dict:
    """Right: a symbol typed right on the first try. Symbols not asked (the test stopped early) count as not known."""
    right = {r["expected"] for r in rows if r["area"] == "recognize" and r["kind"] == "symbol" and r["ok"] and not r["help"]
             and not r["try_n"] and r["expected"] in levels.BOPOMOFO}
    asked = {r["expected"] for r in rows if r["area"] == "recognize" and r["kind"] == "symbol"}
    known = "".join(s for s in levels.SYMS if s in right)
    return {"right": len(known), "of": len(levels.SYMS), "asked": len(asked), "known": known}


def score_voice(rows: list[dict], mode: str) -> dict:
    """Sounds: initials and finals right; tones: tones right. First recording of each card only."""
    rs = [r for r in rows if r["area"] == "speaking" and r["mode"] == mode and not r["try_n"]]
    snd = [r for r in rs if r["kind"] in ("initial", "final") and r["ok"] is not None]
    ton = [r for r in rs if r["kind"] == "tone" and r["ok"] is not None]
    return {"cards": len({r["id"] for r in rs}), "sounds": _pct(sum(bool(r["ok"]) for r in snd), len(snd)),
            "tones": _pct(sum(bool(r["ok"]) for r in ton), len(ton)),
            "missed": sorted({r["expected"] for r in rs if r["kind"] in ("initial", "final") and not r["ok"] and r["expected"] != "∅"})[:20]}


def _good(v: dict, need: int) -> bool:
    return v["cards"] >= need and (v["sounds"] or 0) >= SOUNDS_PASS and (v["tones"] or 0) >= TONES_PASS


def place(alpha: dict | None, syl: dict, sent: dict) -> dict:
    """The level and the unlocks from the scores. Pure: no database."""
    alpha_ok = bool(alpha) and alpha["right"] >= ALPHA_PASS
    syl_ok, sent_ok = _good(syl, MIN_SYLLABLES), _good(sent, MIN_SENTENCES)
    level = 1 + alpha_ok + (alpha_ok and syl_ok) + (alpha_ok and syl_ok and sent_ok)
    chapters = level >= 2 or syl_ok or (bool(alpha) and alpha["right"] >= ALPHA_OPEN)
    return {"level": level, "alphabet_known": alpha_ok, "syllables_ok": syl_ok, "sentences_ok": sent_ok, "chapters": chapters}


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
    keys = [f"level:{n}" for n in range(2, p["level"] + 1)] + (["chapter:medials", "chapter:finals"] if p["chapters"] else [])
    with db.conn() as c:
        before = {r["key"] for r in c.execute("SELECT key FROM level_unlocks").fetchall()}
        for k in keys:
            c.execute("INSERT INTO level_unlocks(key, ts) VALUES (?, ?) ON CONFLICT DO NOTHING", (k, now))
        new_levels = [k for k in keys if k.startswith("level:") and k not in before]
        if new_levels:
            top = levels.LEVELS[p["level"] - 1]
            names = ", ".join(levels.EXERCISES[e][0] for k in new_levels for e in levels.LEVELS[int(k[6:]) - 1]["opens"])
            c.execute("INSERT INTO level_notices(ts, kind, key, title, text) VALUES (?,?,?,?,?)",
                      (now, "unlock", f"level:{top['n']}", f"Placement: level {top['n']}, {top['title']}", f"Open now: {names}."))
    result = {**p, "alphabet": alpha, "syllables": syl, "sentences": sent, "voice_skipped": bool(voice_skipped),
              "title": levels.LEVELS[max(p["level"], levels.opened()["level"]) - 1]["title"], "ts": now}
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
    return {"placed_at_level": r["level"], "alphabet": f"{a['right']} of {a['of']} symbols typed right" if a else "not tested",
            "alphabet_known": r["alphabet_known"],
            "syllables": {k: r["syllables"][k] for k in ("cards", "sounds", "tones", "missed")},
            "sentences": {k: r["sentences"][k] for k in ("cards", "sounds", "tones", "missed")},
            "voice_skipped": r["voice_skipped"], "day": db.day_of(r["ts"])}
