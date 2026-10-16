"""Reading quiz: the symbol-name check on real recordings shipped with the app.

MOE recordings of the 37 symbol names, plus the recorded syllables that are also symbol names (ㄍㄜ, ㄕˋ ...).
Other recorded syllables (ㄇㄚ, ㄋㄧˇ ...) stand in for a learner who says something else.
"""

import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from app import symbols
from app.asr import recognizer

PUB = Path(__file__).parents[2] / "frontend" / "public"
AS_SYMBOL = {
    "ㄍㄜ": "ㄍ",
    "ㄕˋ": "ㄕ",
    "ㄖˋ": "ㄖ",
    "ㄑㄧ": "ㄑ",
    "ㄔ": "ㄔ",
    "ㄗˋ": "ㄗ",
    "ㄙˋ": "ㄙ",
    "ㄩˊ": "ㄩ",
    "ㄩˇ": "ㄩ",
    "ㄦˋ": "ㄦ",
    "ㄦˇ": "ㄦ",
    "ㄦˊ": "ㄦ",
    "ㄢ": "ㄢ",
    "ㄣ": "ㄣ",
    "ㄜˊ": "ㄜ",
    "ㄡ": "ㄡ",
    "ㄛ": "ㄛ",
    "ㄨˇ": "ㄨ",
    "ㄎㄜˇ": "ㄎ",
    "ㄞˋ": "ㄞ",
}
# Measured on 2026-10-10 with leveling: 50 of 57 names pass; 6 of 79 other syllables pass as their closest name.
MAX_MISSED = 7
MAX_OTHER_PASSED = 6


def load(p: Path) -> np.ndarray:
    a, sr = sf.read(p, dtype="float32")
    if a.ndim > 1:
        a = a.mean(1)
    return np.interp(np.linspace(0, len(a) - 1, int(len(a) * 16000 / sr)), np.arange(len(a)), a).astype(np.float32)


@pytest.fixture(scope="module", autouse=True)
def model():
    recognizer._load()
    assert recognizer.ready, recognizer.error


def test_every_symbol_has_a_name():
    table = json.loads((PUB / "data" / "moe-table.json").read_text(encoding="utf-8"))
    assert {r["sym"] for r in table} == set(symbols.NAMES)


def test_correct_names_pass():
    table = json.loads((PUB / "data" / "moe-table.json").read_text(encoding="utf-8"))
    clips = [(r["sym"], PUB / "audio" / "symbols" / f"F{r['audio'][1:]}.wav") for r in table]
    sylls = json.loads((PUB / "data" / "syllables.json").read_text(encoding="utf-8"))
    clips += [
        (AS_SYMBOL[s["zhuyin"]], PUB / "audio" / "syllables" / f"{s['id']}.mp3")
        for s in sylls
        if s["zhuyin"] in AS_SYMBOL
    ]
    missed = [f"{sym}->{r['heard']}({r['fit']})" for sym, p in clips if not (r := symbols.check(load(p), sym))["ok"]]
    # The MOE clips are slow and drawn out, which is the hardest case for the model.
    assert len(missed) <= MAX_MISSED, missed


def test_other_syllables_do_not_pass():
    sylls = json.loads((PUB / "data" / "syllables.json").read_text(encoding="utf-8"))
    passed = []
    for s in sylls:
        if s["zhuyin"] in AS_SYMBOL:
            continue
        a = load(PUB / "audio" / "syllables" / f"{s['id']}.mp3")
        best = symbols.check(a, "ㄅ")["ranking"][0]
        r = symbols.check(a, best)  # the most favourable target for this clip
        if r["ok"]:
            passed.append(f"{s['zhuyin']}->{best}({r['fit']})")
    assert len(passed) <= MAX_OTHER_PASSED, passed


def test_quiet_microphone_still_passes():
    """A quiet microphone (-30 dB, 0.3 s of room noise around the sound, as the listener sends it).
    Measured: without leveling 38 of 57 pass, with the TTS leveling 53 of 57 pass."""
    table = json.loads((PUB / "data" / "moe-table.json").read_text(encoding="utf-8"))
    clips = [(r["sym"], PUB / "audio" / "symbols" / f"F{r['audio'][1:]}.wav") for r in table]
    sylls = json.loads((PUB / "data" / "syllables.json").read_text(encoding="utf-8"))
    clips += [
        (AS_SYMBOL[s["zhuyin"]], PUB / "audio" / "syllables" / f"{s['id']}.mp3")
        for s in sylls
        if s["zhuyin"] in AS_SYMBOL
    ]
    rng = np.random.default_rng(3)
    missed = []
    for sym, p in clips:
        a = load(p)
        a = a / max(1e-6, np.abs(a).max()) * 0.5 * 10 ** (-30 / 20)
        a = np.concatenate([np.zeros(4800, np.float32), a, np.zeros(4800, np.float32)]) + rng.normal(
            0, 0.0005, len(a) + 9600
        ).astype(np.float32)
        if not (r := symbols.check(a, sym))["ok"]:
            missed.append(f"{sym}->{r['heard']}({r['fit']})")
    assert len(missed) <= 5, missed
