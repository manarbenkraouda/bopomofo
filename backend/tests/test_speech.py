"""Speech and text tests. Uses Taiwan neural TTS recordings of known text as a stand-in for a learner."""

import asyncio
import hashlib
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app import scoring
from app.asr import recognizer
from app.zhuyin import analyze_text

FIX = Path(__file__).parent / "fixtures"
FIX.mkdir(exist_ok=True)


def clip(text: str, rate: int = -10) -> np.ndarray:
    p = FIX / f"{hashlib.sha1(f'{text}|{rate}'.encode()).hexdigest()[:12]}.mp3"
    if not p.exists():
        import edge_tts

        asyncio.run(edge_tts.Communicate(text, "zh-TW-HsiaoChenNeural", rate=f"{rate:+d}%").save(str(p)))
    a, sr = sf.read(p, dtype="float32")
    if a.ndim > 1:
        a = a.mean(1)
    n = int(len(a) * 16000 / sr)
    return np.interp(np.linspace(0, len(a) - 1, n), np.arange(len(a)), a).astype(np.float32)


@pytest.fixture(scope="session", autouse=True)
def model():
    recognizer._load()
    assert recognizer.ready, recognizer.error


def summary(res):
    return [
        (
            s["expected"]["char"],
            s["heard"] and s["heard"]["zhuyin"],
            s["initial_ok"],
            s["final_ok"],
            s["tone_ok"],
            s["model_tone"],
            s["pitch_tone"],
        )
        for s in res["syllables"]
    ]


def test_correct_sentence_scores_high():
    res = scoring.analyze(clip("我想喝一杯咖啡。"), "我想喝一杯咖啡。")
    print(summary(res), res["heard_raw"], res["timing"])
    assert res["score"] >= 80


def test_tone_sandhi_sentence():
    res = scoring.analyze(clip("你好，我很好。"), "你好，我很好。")
    print(summary(res))
    assert res["score"] >= 75


def test_isolated_syllable_tone_accuracy():
    """Full pipeline on 99 practice syllables x 2 Taiwan voices. Isolated tones are the hardest case."""
    import json
    from collections import Counter

    items = json.loads((Path(__file__).parents[2] / "frontend/public/data/syllables.json").read_text(encoding="utf-8"))
    dirs = [Path(__file__).parents[2] / "frontend/public/audio/syllables", FIX / "male"]
    ok = n = 0
    conf = Counter()
    for d in dirs:
        # Speaker reference as the app learns it: median pitch of this voice's recordings.
        from app import pitch

        tracks = []
        for it in items:
            a, sr = sf.read(d / f"{it['id']}.mp3", dtype="float32")
            a = a.mean(1) if a.ndim > 1 else a
            f = pitch.track(
                np.interp(np.linspace(0, len(a) - 1, int(len(a) * 16000 / sr)), np.arange(len(a)), a).astype(np.float32)
            )
            tracks.append(f[f > 0])
        ref = float(np.median(np.concatenate(tracks)))
        for it in items:
            if "˙" in it["zhuyin"]:
                continue
            a, sr = sf.read(d / f"{it['id']}.mp3", dtype="float32")
            a = a.mean(1) if a.ndim > 1 else a
            a = np.interp(np.linspace(0, len(a) - 1, int(len(a) * 16000 / sr)), np.arange(len(a)), a).astype(np.float32)
            s = scoring.analyze(a, it["char"], ref)["syllables"][0]
            n += 1
            ok += s["tone_ok"]
            conf[(s["expected"]["surface_tone"], s["heard"] and s["heard"]["tone"])] += 1
    print("isolated tone accuracy", ok, "/", n, sorted(conf.items(), key=str))
    # Most remaining errors are TTS tone-1 clips that really fall (measured ~7 semitones), not model errors.
    assert ok / n >= 0.78


def test_wrong_tone_is_reported():
    res = scoring.analyze(clip("馬", 0), "媽")
    s = res["syllables"][0]
    assert not s["tone_ok"]
    assert any("tone" in m.lower() for m in s["messages"])


def test_wrong_syllable_is_reported():
    res = scoring.analyze(clip("你好"), "我好")
    s = res["syllables"][0]
    print(summary(res))
    assert s["initial_ok"] is False or s["final_ok"] is False


def test_analyze_text_taiwan_readings():
    z = {x["char"]: x["zhuyin"] for x in analyze_text("星期研究垃圾嗎") if x["type"] == "syllable"}
    assert z["期"] == "ㄑㄧˊ" and z["究"] == "ㄐㄧㄡˋ" and z["垃"] == "ㄌㄜˋ" and z["嗎"] == "˙ㄇㄚ"
