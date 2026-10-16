"""The deep check: CTC alignment logic on synthetic model output, the queue and worker process, and the database writes."""

import io
import threading
import time

import numpy as np
import pytest
import soundfile as sf

from app import config, deep_check
from app import deep_check_core as core
from app.ctc import ctc, ctc_viterbi

# A small vocabulary in the model's format: initials without a digit, finals with the tone digit, [PAD] as the blank.
TOKENS = ["[PAD]", "ㄅ", "ㄆ", "ㄇ", "j"] + [f + str(t) for f in ("ㄚ", "ㄧ") for t in range(1, 6)]
VOCAB = dict(enumerate(TOKENS))
IDX = {t: i for i, t in VOCAB.items()}


def lp_of(frames: list[dict]) -> np.ndarray:
    """Frame log probabilities: each frame gives some tokens a probability, the rest goes to the blank."""
    p = np.full((len(frames), len(TOKENS)), 1e-6)
    for f, d in enumerate(frames):
        for tok, v in d.items():
            p[f, IDX[tok]] = v
        p[f, 0] = max(1e-6, 1 - sum(d.values()))
    p /= p.sum(1, keepdims=True)
    return np.log(p).astype(np.float32)


B = {}  # a blank frame


def syl(initial, final, tone=1, heard=None, initial_ok=True, final_ok=True, tone_ok=True, alt=()):
    return {
        "expected": {"initial": initial, "final": final, "surface_tone": tone, "alt_tones": list(alt)},
        "heard": heard if heard is not None else {"initial": initial, "final": final, "tone": tone},
        "initial_ok": initial_ok,
        "final_ok": final_ok,
        "tone_ok": tone_ok,
    }


def job(frames, syllables, semitones=(), score=None, mic=()):
    return {
        "lp": lp_of(frames),
        "audio_seconds": len(frames) * 0.02,
        "syllables": syllables,
        "semitones": list(semitones),
        "has_ref": False,
        "score": score,
        "mic_pairs": [list(m) for m in mic],
        "vocab": VOCAB,
    }


def ba_frames(b, p, m=0.0):
    """One syllable: an initial frame where ㄅ, ㄆ, ㄇ share the probability, then ㄚ tone 1."""
    ini = {k: v for k, v in (("ㄅ", b), ("ㄆ", p), ("ㄇ", m)) if v}
    return [B, ini, B, {"ㄚ1": 0.9}, {"ㄚ1": 0.9}, B, B]


# ---------- ctc ----------


def test_viterbi_spans():
    frames = [B, {"ㄅ": 0.9}, {"ㄅ": 0.9}, B, {"ㄚ1": 0.9}, {"ㄚ1": 0.9}, B]
    lp = lp_of(frames)
    blank = lp[:, 0].astype(float)
    seq = [lp[:, IDX["ㄅ"]].astype(float), lp[:, IDX["ㄚ1"]].astype(float)]
    assert ctc_viterbi(seq, blank) == [(1, 2), (4, 5)]
    assert ctc_viterbi(seq * 5, blank) is None  # more units than frames
    # The forward score of the right sequence beats a wrong one.
    assert ctc(seq, blank) > ctc([lp[:, IDX["ㄆ"]].astype(float), seq[1]], blank)


# ---------- the check, on synthetic model output ----------


def test_close_initial_is_fixed():
    # The live check heard ㄅ (0.55) but ㄆ (0.40) explains the clip almost as well: a false miss.
    r = core.check(
        job(
            ba_frames(0.55, 0.40),
            [syl("ㄆ", "ㄚ", heard={"initial": "ㄅ", "final": "ㄚ", "tone": 1}, initial_ok=False)],
            score=67,
        )
    )
    assert r["status"] == "done" and r["verdict"] == "false_miss" and r["score_after"] == 100
    p = r["parts"][0]
    assert p["kind"] == "initial" and p["verdict"] == "fixed" and -1.0 <= p["delta"] < 0


def test_clear_initial_stays_a_miss():
    r = core.check(
        job(
            ba_frames(0.95, 0.01),
            [syl("ㄆ", "ㄚ", heard={"initial": "ㄅ", "final": "ㄚ", "tone": 1}, initial_ok=False)],
            score=67,
        )
    )
    assert r["verdict"] == "real_miss" and r["score_after"] == 67 and r["parts"][0]["verdict"] == "real"


def test_margins_by_pair():
    # The same ratio (about 2.3 nats): too far for b/p (margin 1.0), close enough for m/b, a nasal pair (margin 3.0).
    bp = core.check(
        job(
            ba_frames(0.8, 0.08), [syl("ㄆ", "ㄚ", heard={"initial": "ㄅ", "final": "ㄚ", "tone": 1}, initial_ok=False)]
        )
    )
    mb = core.check(
        job(
            ba_frames(0.8, 0, 0.08),
            [syl("ㄇ", "ㄚ", heard={"initial": "ㄅ", "final": "ㄚ", "tone": 1}, initial_ok=False)],
        )
    )
    assert bp["parts"][0]["verdict"] == "real" and mb["parts"][0]["verdict"] == "fixed"
    # A pair the learner confirmed by typing gets the large margin too.
    typed = core.check(
        job(
            ba_frames(0.8, 0.08),
            [syl("ㄆ", "ㄚ", heard={"initial": "ㄅ", "final": "ㄚ", "tone": 1}, initial_ok=False)],
            mic=[("initial", "ㄆ", "ㄅ")],
        )
    )
    assert typed["parts"][0]["verdict"] == "fixed"


def test_missing_syllable():
    weak = [B, {"ㄇ": 0.9}, {"ㄚ1": 0.9}, B, {"ㄇ": 0.6}, {"ㄚ1": 0.6}, B]
    gone = [B, {"ㄇ": 0.9}, {"ㄚ1": 0.9}, B, B, B, B]
    miss = syl("ㄇ", "ㄚ", heard=False, initial_ok=False, final_ok=False, tone_ok=False)
    miss["heard"] = None
    found = core.check(job(weak, [syl("ㄇ", "ㄚ"), miss]))
    assert found["verdict"] == "false_miss" and found["score_before"] == 50 and found["score_after"] == 100
    lost = core.check(job(gone, [syl("ㄇ", "ㄚ"), miss]))
    assert lost["verdict"] == "real_miss" and all(p["verdict"] == "real" for p in lost["parts"])


def test_tone_needs_the_model_and_the_pitch():
    frames = [
        B,
        {"ㄅ": 0.9},
        B,
        {"ㄚ1": 0.5, "ㄚ4": 0.4},
        {"ㄚ1": 0.5, "ㄚ4": 0.4},
        {"ㄚ1": 0.5, "ㄚ4": 0.4},
        B,
        B,
        B,
        B,
    ]
    s = syl("ㄅ", "ㄚ", 1, heard={"initial": "ㄅ", "final": "ㄚ", "tone": 4}, tone_ok=False)
    flat = core.check(job(frames, [s], semitones=[0.0] * 20))
    fall = core.check(job(frames, [s], semitones=list(np.linspace(6, -6, 20))))
    t = next(p for p in flat["parts"] if p["kind"] == "tone")
    assert t["verdict"] == "fixed" and t["p_tone"] >= 0.5 and t["pitch_tone"] == 1 and flat["verdict"] == "false_miss"
    t = next(p for p in fall["parts"] if p["kind"] == "tone")
    assert t["verdict"] == "unsure" and t["pitch_tone"] == 4 and fall["verdict"] == "real_miss"
    # A clear tone 4 in the model output stays a miss.
    clear = [B, {"ㄅ": 0.9}, B] + [{"ㄚ4": 0.9}] * 3 + [B] * 4
    t = next(p for p in core.check(job(clear, [s]))["parts"] if p["kind"] == "tone")
    assert t["verdict"] == "real" and t["best_tone"] == 4


# ---------- the queue and the worker process ----------


def test_full_queue_skips_and_submit_never_waits(monkeypatch):
    monkeypatch.setattr(config, "DEEP_CHECK", "shadow")
    gate = threading.Event()
    monkeypatch.setattr(deep_check, "runner", lambda j: (gate.wait(10), {"status": "error", "error": "test"})[1])
    monkeypatch.setattr(deep_check, "save", lambda *a: False)
    deep_check.start(lambda: VOCAB)
    try:
        j = {"user_id": "user_test", "event_id": 1, "mode": "shadow", "check": {}}
        assert deep_check.submit(j) == "queued"
        for _ in range(50):  # the dispatcher takes the first job and waits on it
            if deep_check._q.empty():
                break
            time.sleep(0.02)
        t0 = time.perf_counter()
        got = [deep_check.submit(j) for _ in range(deep_check.QUEUE_SIZE + 2)]
        assert time.perf_counter() - t0 < 0.1
        assert got.count("queued") == deep_check.QUEUE_SIZE and got[-2:] == ["skipped", "skipped"]
    finally:
        gate.set()
        deep_check.stop(drain=2)


def test_stop_is_bounded_when_a_job_hangs(monkeypatch):
    monkeypatch.setattr(config, "DEEP_CHECK", "shadow")
    monkeypatch.setattr(deep_check, "runner", lambda j: (time.sleep(30), {})[1])
    monkeypatch.setattr(deep_check, "save", lambda *a: False)
    deep_check.start(lambda: VOCAB)
    deep_check.submit({"user_id": None, "event_id": 1, "mode": "shadow", "check": {}})
    time.sleep(0.3)
    t0 = time.perf_counter()
    deep_check.stop(drain=2)
    assert time.perf_counter() - t0 < 5
    assert deep_check.submit({"user_id": None, "event_id": 2, "mode": "shadow", "check": {}}) == "skipped"


def test_worker_process_runs_and_is_replaced(monkeypatch):
    monkeypatch.setattr(deep_check, "runner", None)
    monkeypatch.setattr(deep_check, "_vocab_fn", lambda: VOCAB)
    monkeypatch.setattr(deep_check, "_stop", threading.Event())  # not stopping: the full job time applies
    j = job(
        ba_frames(0.55, 0.40), [syl("ㄆ", "ㄚ", heard={"initial": "ㄅ", "final": "ㄚ", "tone": 1}, initial_ok=False)]
    )
    del j["vocab"]  # the worker gets the vocabulary once, when it starts
    try:
        assert deep_check._check(j)["verdict"] == "false_miss"
        for p in list(deep_check._pool._processes.values()):
            p.kill()
            p.join(5)
        results = [deep_check._check(j) for _ in range(2)]
        assert results[-1]["verdict"] == "false_miss"  # a new worker took over
    finally:
        deep_check._reset_pool(kill=True)


def test_analyze_never_sends_or_saves_the_model_output(pg, monkeypatch):
    from fastapi import UploadFile

    from app import coach, scoring
    from app.api.speech import speech_analyze
    from app.asr import recognizer
    from app.zhuyin import analyze_text

    coach.LIVE = False
    monkeypatch.setattr(config, "DEEP_CHECK", "shadow")
    monkeypatch.setattr(recognizer, "session", object())  # ready, without the model
    lp = lp_of(ba_frames(0.55, 0.40))
    e = analyze_text("破")[0]
    fake = {
        "text": "破",
        "score": 67,
        "speaker_hz": None,
        "extra": [],
        "heard_raw": "ㄅㄛ4",
        "syllables": [
            {
                "expected": e,
                "heard": {"initial": "ㄅ", "final": e["final"], "tone": e["surface_tone"], "zhuyin": "ㄅㄛˋ"},
                "initial_ok": False,
                "final_ok": True,
                "tone_ok": True,
                "messages": [],
            }
        ],
        "pitch": {"times": [], "semitones": [], "ref_hz": 200.0},
        "timing": {"infer_seconds": 0.1, "audio_seconds": 0.16},
        "_lp": lp,
        "_has_ref": False,
    }
    monkeypatch.setattr(scoring, "analyze", lambda *a, **k: dict(fake))
    jobs = []
    monkeypatch.setattr(deep_check, "submit", lambda j: (jobs.append(j), "queued")[1])
    buf = io.BytesIO()
    sf.write(buf, (0.3 * np.sin(np.arange(16000) / 16000 * 2 * np.pi * 220)).astype(np.float32), 16000, format="WAV")
    buf.seek(0)
    out = speech_analyze(
        audio=UploadFile(file=buf, filename="a.wav"), text="破", mode="syllable", step="", help="", try_n=""
    )
    assert "_lp" not in out and "_has_ref" not in out and out["deep_check"] == "queued"
    assert jobs and jobs[0]["check"]["lp"] is lp and jobs[0]["event_id"] == out["event_id"]
    from app import db

    with db.conn() as c:
        details = c.execute("SELECT details FROM events WHERE id=?", (out["event_id"],)).fetchone()["details"]
    assert "_lp" not in str(details) and "log_prob" not in str(details)


# ---------- the database ----------

SYL = {"char": "破", "zhuyin": "ㄆㄛˋ", "initial": "ㄆ", "final": "ㄛ", "tone": 4, "surface_tone": 4}
FIXED = {
    "status": "done",
    "verdict": "false_miss",
    "score_before": 67,
    "score_after": 100,
    "version": "dc1",
    "seconds": 0.1,
    "parts": [
        {"pos": 0, "kind": "initial", "expected": "ㄆ", "heard": "ㄅ", "rival": "ㄅ", "verdict": "fixed", "delta": -0.3}
    ],
}


def miss(try_n=0) -> int:
    from app import stats

    res = {
        "score": 67,
        "syllables": [
            {
                "expected": SYL,
                "heard": {"initial": "ㄅ", "final": "ㄛ", "tone": 4, "zhuyin": "ㄅㄛˋ"},
                "initial_ok": False,
                "final_ok": True,
                "tone_ok": True,
            }
        ],
    }
    return stats.log_speaking("破", res, "syllable", try_n=try_n)


def units(eid):
    from app import db

    with db.conn() as c:
        return {
            r["kind"]: dict(r)
            for r in c.execute("SELECT kind, actual, ok, source, extra FROM units WHERE event_id=?", (eid,))
        }


def event(eid):
    from app import db

    with db.conn() as c:
        return dict(c.execute("SELECT ok, score, first_try, details FROM events WHERE id=?", (eid,)).fetchone())


def deep_notices():
    from app import db

    with db.conn() as c:
        return [
            dict(r)
            for r in c.execute("SELECT id, title, text, key FROM level_notices WHERE kind='deep_fix' AND NOT seen")
        ]


@pytest.fixture()
def dbt(pg):
    from app import coach

    coach.LIVE = False


def test_shadow_changes_nothing(dbt):
    eid = miss()
    assert not deep_check.save(eid, "shadow", FIXED)
    assert units(eid)["initial"]["ok"] == 0 and event(eid)["ok"] == 0 and event(eid)["score"] == 67
    r = deep_check.result(eid)
    assert r["verdict"] == "false_miss" and r["applied"] is False and not deep_notices()


def test_apply_fixes_the_answer_and_merges_the_notices(dbt):
    a = miss()
    assert deep_check.save(a, "apply", FIXED)
    u = units(a)
    assert (
        u["initial"]["ok"] == 1 and u["initial"]["source"] == "deep_check" and '"heard": "ㄅ"' in u["initial"]["extra"]
    )
    assert u["syllable"]["ok"] == 1
    e = event(a)
    assert e["ok"] == 1 and e["score"] == 100 and e["first_try"] == 1 and "deep_fix" in e["details"]
    n = deep_notices()
    assert len(n) == 1 and n[0]["title"] == "Answer corrected" and n[0]["text"] == deep_check.NOTICE_ONE
    assert deep_check.result(a)["notice_id"] == n[0]["id"]
    b = miss()
    deep_check.save(b, "apply", FIXED)
    n = deep_notices()
    assert len(n) == 1 and n[0]["text"] == "2 previous answers were corrected after further analysis, good job!"
    assert deep_check.result(a)["notice_id"] == deep_check.result(b)["notice_id"] == n[0]["id"]
    s = deep_check.summary()
    assert s["corrected"] == 2 and s["top_pairs"][0]["expected"] == "ㄆ" and s["top_pairs"][0]["n"] == 2


def test_one_check_per_answer(dbt):
    eid = miss()
    deep_check.save(eid, "shadow", FIXED)
    assert not deep_check.save(eid, "apply", FIXED)  # the second check of the same answer is not stored or applied
    assert event(eid)["ok"] == 0
    from app import db

    with db.conn() as c:
        assert c.execute("SELECT COUNT(*) FROM deep_checks").fetchone()[0] == 1


def test_typed_check_wins(dbt):
    from app import typed_fix

    ids = [miss(try_n=n) for n in range(3)]
    typed_fix.confirm_speaking(ids, "bo")  # the learner says they said b: a real miss
    assert not deep_check.save(ids[-1], "apply", FIXED)
    assert units(ids[-1])["initial"]["source"] != "deep_check" and event(ids[-1])["ok"] == 0


def test_partial_fix_keeps_the_answer_wrong(dbt):
    eid = miss()
    part = {**FIXED, "verdict": "partial", "score_after": 78}
    assert deep_check.save(eid, "apply", part)
    e = event(eid)
    assert e["ok"] == 0 and e["score"] == 78 and not deep_notices()


def test_users_are_kept_apart(dbt):
    from app import db

    eid = miss()
    deep_check.save(eid, "shadow", FIXED)
    db.set_user("user_other")
    try:
        assert deep_check.result(eid) is None and deep_check.summary()["checked"] == 0
    finally:
        db.set_user("user_test")
    assert deep_check.result(eid) is not None


def test_coach_gets_pairs_fixed_three_times(dbt):
    for _ in range(3):
        deep_check.save(miss(), "apply", FIXED)
    assert deep_check.coach_pairs() == [{"kind": "initial", "expected": "ㄆ", "heard": "ㄅ", "fixes": 3}]
