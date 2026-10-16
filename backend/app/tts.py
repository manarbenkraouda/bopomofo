"""Local, offline text to speech with open-source voices (sherpa-onnx). Results are cached on disk as WAV.

Each user has a separate cache folder, data/tts/<user id>. A user can clear only their own folder.
A folder is kept under TTS_CACHE_MB_PER_USER: the clips used least recently are deleted first.
New clips count for the daily limit of the user (app/limits.py); a replay from the cache does not.
"""

from __future__ import annotations

import hashlib
import os
import re
import threading
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar

import numpy as np
import soundfile as sf

from . import db, limits
from .config import DATA_DIR, MODEL_DIR, TTS_CACHE_MB_PER_USER
from .runtime import RUNTIME
from .zhuyin import analyze_text


@dataclass(frozen=True)
class Voice:
    id: str
    label: str
    description: str
    model: str
    sid: int


VOICES = [
    Voice("kokoro-f", "Kokoro female", "Kokoro v1.1-zh. Natural, mainland accent, female.", "kokoro", 3),
    Voice("kokoro-m", "Kokoro male", "Kokoro v1.1-zh. Natural, mainland accent, male.", "kokoro", 60),
    Voice(
        "breeze2",
        "Breeze2 (Taiwan)",
        "MediaTek Breeze2-VITS. Taiwan accent, female. Fast, a little less clear than Kokoro.",
        "breeze2",
        0,
    ),
]
BY_ID = {v.id: v for v in VOICES}
DEFAULT_VOICE = "kokoro-f"
TTS_NUM_THREADS = RUNTIME.tts_threads  # 8 on the laptop, at most 4 on the VPS (app/runtime.py)
_USER_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")  # Clerk ids look like user_2abc...; anything else is not a folder name

_engines: dict[str, object] = {}
_locks = {"breeze2": threading.Lock(), "kokoro": threading.Lock()}

TARGET_DB = -18.0  # loudness of speech after leveling, in dBFS
PEAK = 10 ** (-1 / 20)  # limiter ceiling, -1 dBFS


def _speech_db(a: np.ndarray, sr: int) -> float:
    """RMS level of the speech parts only, so pauses do not lower the measure."""
    n = max(1, sr // 50)  # 20 ms frames
    fr = a[: len(a) // n * n].reshape(-1, n)
    rms = np.sqrt((fr**2).mean(1)) if len(fr) else np.sqrt((a**2).mean(keepdims=True))
    act = rms[rms > rms.max() * 0.1] if rms.max() > 0 else rms
    return 20 * np.log10(max(np.sqrt((act**2).mean()), 1e-9))


def level(a: np.ndarray, sr: int) -> np.ndarray:
    """Make every voice equally loud: gain to TARGET_DB, a gentle compressor, then a peak limiter."""
    a = np.asarray(a, dtype=np.float32)
    if not np.any(a):
        return a
    a = a * 10 ** ((TARGET_DB - _speech_db(a, sr)) / 20)
    # Compressor: 3:1 above -14 dBFS, 5 ms attack, 80 ms release, on a smoothed envelope.
    att, rel = np.exp(-1 / (0.005 * sr)), np.exp(-1 / (0.08 * sr))
    env, e = np.empty_like(a), 0.0
    for i, x in enumerate(np.abs(a)):
        e = (att if x > e else rel) * e + (1 - (att if x > e else rel)) * x
        env[i] = e
    thr, ratio = 10 ** (-14 / 20), 3.0
    over = np.maximum(env, 1e-9) / thr
    a = a * np.where(env > thr, over ** (1 / ratio - 1), 1.0)
    a = a * 10 ** ((TARGET_DB - _speech_db(a, sr)) / 20)  # restore the level the compressor took away
    # Limiter: untouched below 0.8 of the ceiling, soft knee above it, never above the ceiling.
    k = 0.8 * PEAK
    m = np.abs(a)
    soft = k + (PEAK - k) * np.tanh((m - k) / (PEAK - k))
    return (np.sign(a) * np.where(m > k, soft, m)).astype(np.float32)


@dataclass
class _Audio:
    samples: np.ndarray
    sample_rate: int


class Breeze2:
    """Breeze2-VITS run directly with ONNX Runtime.

    sherpa-onnx's text front end gives this model wrong input (it merges syllables and drops some,
    e.g. 你叫什麼名字 came out as "ni jiao shi ma"). Here the app's own Zhuyin analyzer gives each
    syllable its reading in context, with spoken tone changes (一, 不, 3-3 sandhi)."""

    TONE_MARK: ClassVar[dict[int, str]] = {1: "ˉ", 2: "ˊ", 3: "ˇ", 4: "ˋ", 5: "˙"}

    def __init__(self, d: Path):
        import onnxruntime as ort

        self.tok: dict[str, int] = {}
        for line in (d / "tokens.txt").read_text(encoding="utf-8").split("\n"):
            if line.strip():
                sym, i = line.rsplit(" ", 1)
                self.tok[sym or " "] = int(i)
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = TTS_NUM_THREADS
        self.sess = ort.InferenceSession(str(d / "breeze2-vits.onnx"), opts, providers=["CPUExecutionProvider"])

    def ids(self, text: str) -> list[int]:
        out: list[int] = []
        for it in analyze_text(text):
            if it["type"] == "syllable":
                out += [
                    self.tok[c]
                    for c in it["initial"] + it["final"] + self.TONE_MARK[it["surface_tone"]]
                    if c in self.tok
                ]
            else:
                out += [self.tok[c] for c in it["text"] if c in self.tok and c != " "]
        x = [0]  # the model was trained with a blank token between all symbols
        for i in out:
            x += [i, 0]
        return x

    def generate(self, text: str, sid: int = 0, speed: float = 1.0) -> _Audio:
        x = self.ids(text)
        if len(x) < 3:
            return _Audio(np.zeros(0, np.float32), 22050)
        f = lambda v: np.array([v], dtype=np.float32)  # noqa: E731
        a = self.sess.run(
            None,
            {
                "x": np.array([x], dtype=np.int64),
                "x_length": np.array([len(x)], dtype=np.int64),
                # Low noise: the default 0.667/0.8 makes Breeze2 slur and mispronounce more often.
                "noise_scale": f(0.3),
                "noise_scale_w": f(0.3),
                "length_scale": f(1 / speed),
                "sid": np.array([sid], dtype=np.int64),
            },
        )[0]
        return _Audio(a.squeeze().astype(np.float32), 22050)


def _load(model: str):
    if model == "breeze2":
        return Breeze2(MODEL_DIR / "breeze2-vits")
    import sherpa_onnx as so

    d = MODEL_DIR / "kokoro-multi-lang-v1_1"
    cfg = so.OfflineTtsModelConfig(
        kokoro=so.OfflineTtsKokoroModelConfig(
            model=str(d / "model.onnx"),
            voices=str(d / "voices.bin"),
            tokens=str(d / "tokens.txt"),
            data_dir=str(d / "espeak-ng-data"),
            dict_dir=str(d / "dict"),
            lexicon=f"{d / 'lexicon-us-en.txt'},{d / 'lexicon-zh.txt'}",
        ),
        num_threads=TTS_NUM_THREADS,
    )
    fsts = ",".join(str(d / f) for f in ("date-zh.fst", "phone-zh.fst", "number-zh.fst"))
    return so.OfflineTts(so.OfflineTtsConfig(model=cfg, rule_fsts=fsts))


def user_cache(user: str | None) -> Path:
    """The audio cache folder of one user."""
    if not user or not _USER_ID.match(user):
        raise ValueError("Text to speech needs a signed-in user.")
    return DATA_DIR / "tts" / user


def speak(text: str, rate: int, voice: str, user: str | None) -> Path:
    """Blocking. Call from a worker thread. rate is a percent change, e.g. -35 is slower."""
    v = BY_ID.get(voice) or BY_ID[DEFAULT_VOICE]
    key = hashlib.sha1(f"lvl2|{'bz3|' if v.model == 'breeze2' else ''}{v.id}|{rate}|{text}".encode()).hexdigest()
    path = user_cache(user) / f"{key}.wav"
    if path.exists() and path.stat().st_size > 0:
        with suppress(OSError):
            os.utime(path)  # used now: the trim keeps it longer
        return path
    with db.as_user(user):
        limits.check_tts()
        with _locks[v.model]:
            if v.model not in _engines:
                _engines[v.model] = _load(v.model)
            audio = _engines[v.model].generate(text, sid=v.sid, speed=max(0.3, 1 + rate / 100))
        limits.record("tts")
    if len(audio.samples) == 0:
        raise RuntimeError("The voice made no audio for this text.")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    sf.write(str(tmp), level(audio.samples, audio.sample_rate), audio.sample_rate, format="WAV")
    tmp.replace(path)
    _trim(path.parent, keep=path)
    return path


def _trim(d: Path, keep: Path) -> None:
    """Keep a user's folder under TTS_CACHE_MB_PER_USER. The clips used least recently go first, down to 90% of the limit."""
    limit = TTS_CACHE_MB_PER_USER * 1024 * 1024
    files = []
    for p in d.glob("*.wav"):
        try:
            st = p.stat()
        except OSError:
            continue
        files.append((st.st_mtime, st.st_size, p))
    total = sum(size for _, size, _ in files)
    if total <= limit:
        return
    for _, size, p in sorted(files):
        if total <= limit * 0.9:
            break
        if p == keep:
            continue
        try:
            p.unlink()
            total -= size
        except OSError:
            pass  # a file in use is skipped


def preload_async(voice: str = DEFAULT_VOICE):
    """Load a voice in the background so the first Listen click is fast."""
    v = BY_ID[voice]

    def run():
        with _locks[v.model]:
            if v.model not in _engines:
                _engines[v.model] = _load(v.model)

    threading.Thread(target=run, daemon=True).start()


def pregenerate(jobs: list[tuple[str, int]], voice: str, user: str | None):
    """Make and cache audio ahead of time for one user. Runs in the background; errors only skip that clip."""
    for text, rate in dict.fromkeys(jobs):
        if text.strip() and len(text) <= 400:
            try:
                speak(text, rate, voice, user)
            except limits.LimitReached:
                return  # the daily audio limit: the other clips are made when they are played, after the reset
            except Exception as e:  # noqa: BLE001
                print(f"TTS pregenerate failed for {text!r}: {e}")


def clear_cache(user: str | None) -> dict:
    """Delete the audio of one user. The audio of other users stays."""
    d = user_cache(user)
    files = [p for p in d.iterdir() if p.is_file()] if d.is_dir() else []
    size = sum(p.stat().st_size for p in files)
    removed = 0
    for p in files:
        try:
            p.unlink()
            removed += 1
        except OSError:
            pass  # a file in use is skipped; it is replaced on the next clear
    return {"files": removed, "bytes": size}


def remove_shared_files() -> None:
    """Delete the files of the old shared cache (directly in data/tts). No code reads them since the cache is per user."""
    d = DATA_DIR / "tts"
    for p in d.iterdir() if d.is_dir() else []:
        if p.is_file():
            with suppress(OSError):
                p.unlink()
