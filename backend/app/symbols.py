"""Check which Bopomofo symbol name the learner said.

Free transcription is weak on one short isolated sound. Here the question is narrower: which of the
37 symbol names (ㄅ = ㄅㄛ, ㄓ = ㄓ, ㄧ = ㄧ ...) fits the audio best? Each name is a short sequence of
model tokens. Tones are merged, because symbol names have no fixed tone. Each name gets a CTC score,
and the best name wins.
"""
from __future__ import annotations

import json
import re
import time

import numpy as np
import soundfile as sf

from . import db
from .asr import recognizer
from .config import DATA_DIR, SAVE_QUIZ_CLIPS
from .tts import level

CLIPS = DATA_DIR / "quiz_clips"
KEEP_CLIPS = 300

VOWELS = "ㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦㄧㄨㄩ"
# Spoken name of each symbol, as model tokens (finals without the tone digit). The extra spellings
# match how the model writes a drawn-out name: ㄞ as ㄚ+ㄧ, a long ㄧ as two ㄧ, and so on.
NAMES: dict[str, list[list[str]]] = {
    **{s: [[s, "ㄛ"], [s, "ㄨㄛ"]] for s in "ㄅㄆㄇㄈ"},
    **{s: [[s, "ㄜ"]] for s in "ㄉㄊㄋㄌㄍㄎㄏ"},
    **{s: [[s, "ㄧ"], [s, "ㄧ", "j", "ㄧ"]] for s in "ㄐㄑㄒ"},
    **{s: [[s, "ㄭ+"]] for s in "ㄓㄔㄕㄖ"},
    **{s: [[s, "ㄭ-"]] for s in "ㄗㄘㄙ"},
    **{s: [[s]] for s in "ㄚㄛㄜㄢㄣㄤㄥㄨㄩ"},
    "ㄧ": [["ㄧ"], ["ㄧ", "j", "ㄧ"]],
    "ㄝ": [["ㄝ"], ["ㄧㄝ"]],
    "ㄞ": [["ㄞ"], ["ㄚ", "ㄧ"], ["ㄚ", "j", "ㄧ"]],
    "ㄟ": [["ㄟ"], ["ㄟ", "j", "ㄧ"]],
    "ㄠ": [["ㄠ"], ["ㄚ", "ㄨ"], ["ㄚ", "ㄡ"]],
    "ㄡ": [["ㄡ"], ["ㄛ", "ㄨ"]],
    "ㄦ": [["ㄦ"], ["r"]],
}
# The model rarely recognizes these five names on their own. Measured on 129 clips (MOE recordings,
# recorded syllables, Windows zh-TW voice): ㄗ is heard as ㄓ, ㄘ and ㄙ as ㄕ ㄔ ㄑ, ㄖ as ㄩ, ㄝ as ㄟ.
# For these targets, the listed neighbours also pass, and the result says so.
LENIENT: dict[str, str] = {"ㄗ": "ㄓㄕ", "ㄘ": "ㄔㄕㄑ", "ㄙ": "ㄕㄘㄑㄔ", "ㄖ": "ㄩ", "ㄝ": "ㄟ"}
# How well the best name explains the speech, compared with free decoding (log probability per speech
# frame). It rejects noise and whole words. At -2.0, 48 of 55 real recordings of names pass overall,
# and 8 of 81 other recorded syllables (ㄇㄚ, ㄋㄧˇ ...) still look like a symbol name.
MIN_FIT = -2.0

_groups: tuple[dict[str, list[int]], list[int]] | None = None


def _vocab_groups(size: int):
    """One group of vocabulary ids per initial or final (all tones together), plus one blank group."""
    global _groups
    if _groups is None:
        units: dict[str, list[int]] = {}
        blank = [i for i in range(size) if i not in recognizer.vocab]  # ids beyond the vocab file are special tokens
        for i, tok in recognizer.vocab.items():
            if tok in ("[PAD]", "|", "[UNK]", "<s>", "</s>"):
                blank.append(i)
            else:
                units.setdefault(tok[:-1] if tok[-1:].isdigit() else tok, []).append(i)
        _groups = (units, blank)
    return _groups


def _ctc(seq: list[np.ndarray], blank: np.ndarray) -> float:
    """Log probability of the unit sequence over the whole clip (CTC forward pass)."""
    ext = [blank]
    for u in seq:
        ext += [u, blank]
    emit = np.stack(ext, axis=1)  # (frames, states)
    n = emit.shape[1]
    neg = -1e30
    a = np.full(n, neg)
    a[0], a[1] = emit[0, 0], emit[0, 1]
    odd = np.arange(n) % 2 == 1
    for f in range(1, emit.shape[0]):
        step = np.concatenate([[neg], a[:-1]])
        skip = np.where(odd, np.concatenate([[neg, neg], a[:-2]]), neg)  # skip a blank between two units
        a = np.logaddexp(np.logaddexp(a, step), skip) + emit[f]
    return float(np.logaddexp(a[-1], a[-2]))


def scores_from_log_probs(lp: np.ndarray) -> dict[str, float]:
    """Log probability of every symbol name over the whole clip (higher is better)."""
    units, blank_ids = _vocab_groups(lp.shape[1])
    group = {k: np.logaddexp.reduce(lp[:, v], axis=1) for k, v in units.items()}
    blank = np.logaddexp.reduce(lp[:, blank_ids], axis=1)
    out = {}
    for sym, variants in NAMES.items():
        best = -np.inf
        for v in variants:
            leads = ([], ["j"]) if v[0] in VOWELS or v[0] == "r" else ([],)
            for lead in leads:
                best = max(best, _ctc([group[u] for u in lead + v], blank))
        out[sym] = best
    return out


def judge(lp: np.ndarray, target: str) -> dict:
    if target not in NAMES:
        raise ValueError(f"Unknown symbol: {target}")
    s = scores_from_log_probs(lp)
    ranked = sorted(s, key=s.get, reverse=True)
    best = ranked[0]
    _, blank_ids = _vocab_groups(lp.shape[1])
    speech = max(1, int((~np.isin(lp.argmax(1), blank_ids)).sum()))
    fit = (s[best] - float(lp.max(1).sum())) / speech
    symbol_like = fit >= MIN_FIT
    exact = best == target
    lenient = not exact and best in LENIENT.get(target, "")
    return {
        "target": target,
        "ok": symbol_like and (exact or lenient),
        "lenient": symbol_like and lenient,
        "heard": best if symbol_like else None,
        "closest": best,
        "fit": round(fit, 2),
        "ranking": [k for k in ranked[:5]],
    }


def check(audio: np.ndarray, target: str) -> dict:
    # Same leveling as the TTS output (gain to -18 dBFS, 3:1 compressor, limiter). A quiet recording
    # would otherwise sink under the padding noise below.
    a = level(audio, 16000)
    # The model needs a little silence around a short sound to catch the initial consonant (ㄅ in ㄅㄛ).
    # This is the same padding as in the measurements above: 0.5 s each side with faint noise.
    pad = np.zeros(8000, np.float32)
    a = np.concatenate([pad, a, pad])
    a += np.random.default_rng(0).normal(0, 0.002, len(a)).astype(np.float32)
    return judge(recognizer.log_probs(a), target)


def save_clip(audio: np.ndarray, result: dict) -> None:
    """Keep the learner's recent quiz clips (local data folder, one folder per user) to tune the thresholds on a real voice.
    Off unless SAVE_QUIZ_CLIPS=1: on a shared server these are other people's voices."""
    uid = db.current_user()
    if not SAVE_QUIZ_CLIPS or not uid:
        return
    folder = CLIPS / re.sub(r"[^A-Za-z0-9_-]", "_", uid)
    try:
        folder.mkdir(parents=True, exist_ok=True)
        stem = f"{time.strftime('%Y%m%d-%H%M%S')}-{int(time.time() * 1000) % 1000:03d}"
        sf.write(str(folder / f"{stem}.wav"), audio, 16000)
        (folder / f"{stem}.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        for old in sorted(folder.glob("*.wav"))[:-KEEP_CLIPS]:
            old.unlink(missing_ok=True)
            old.with_suffix(".json").unlink(missing_ok=True)
    except OSError:
        pass

