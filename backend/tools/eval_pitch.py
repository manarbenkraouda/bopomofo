r"""Measure the pitch tracker on the 99 practice syllables x 2 Taiwan voices, clean and degraded.

Per condition it reports:
- coverage: share of the voiced part of each syllable (found on the clean clip) that gets a pitch value
- gaps: syllables where the pitch line has a hole of 30 ms or more
- tone: pitch-only tone accuracy (pitch.classify with the voice's reference), all tones and tone 4 alone

Run: .venv\Scripts\python tools\eval_pitch.py [tracker]   (tracker = a function name in app.pitch, e.g. track, track_yin)
"""
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app import pitch  # noqa: E402

FRONT = ROOT.parent / "frontend"
ITEMS = [it for it in json.loads((FRONT / "public/data/syllables.json").read_text(encoding="utf-8")) if "˙" not in it["zhuyin"]]
VOICES = {"female": FRONT / "public/audio/syllables", "male": ROOT / "tests/fixtures/male"}
TONE = {"ˊ": 2, "ˇ": 3, "ˋ": 4}


def load(p: Path) -> np.ndarray:
    a, sr = sf.read(p, dtype="float32")
    a = a.mean(1) if a.ndim > 1 else a
    n = int(len(a) * 16000 / sr)
    return np.interp(np.linspace(0, len(a) - 1, n), np.arange(len(a)), a).astype(np.float32)


def tone_of(z: str) -> int:
    return next((t for m, t in TONE.items() if m in z), 1)


def degrade(a: np.ndarray, kind: str, rng: np.random.Generator) -> np.ndarray:
    if kind == "clean":
        return a
    # Laptop-mic stand-in: low-passed (fan/room-like) noise, and a lower level for "quiet".
    w = rng.standard_normal(len(a) + 64).astype(np.float32)
    noise = np.convolve(w, np.ones(8) / 8, mode="same")[: len(a)]
    p_sig = np.mean(a[np.abs(a) > 0.02 * np.abs(a).max()] ** 2)
    snr = {"noise20": 20, "noise10": 10, "quiet": 15}[kind]
    noise *= np.sqrt(p_sig / 10 ** (snr / 10) / np.mean(noise ** 2))
    out = a + noise
    return (out * (0.08 if kind == "quiet" else 1.0)).astype(np.float32)


def voiced_span(a: np.ndarray, f0_clean: np.ndarray) -> np.ndarray:
    """Frames that are voiced in the clean clip (energy above 5% of the peak, between the first and last pitch frame)."""
    n = len(f0_clean)
    rms = np.array([np.sqrt(np.mean(a[i * 160:i * 160 + 400] ** 2)) for i in range(n)])
    m = rms > rms.max() * 0.05
    idx = np.where(m & (f0_clean > 0))[0]
    span = np.zeros(n, bool)
    if len(idx):
        span[idx[0]: idx[-1] + 1] = True
    return span & m


def main(name: str = "track"):
    fn = getattr(pitch, name)
    ref_fn = pitch.track  # clean-clip reference for coverage and pitch error
    rng = np.random.default_rng(0)
    for kind in ["clean", "noise20", "noise10", "quiet"]:
        cov, gaps, ok, n, ok4, n4, errs, big = [], 0, 0, 0, 0, 0, [], 0
        conf = Counter()
        for voice, folder in VOICES.items():
            clips = [load(folder / f"{it['id']}.mp3") for it in ITEMS]
            clean_tracks = [ref_fn(a) for a in clips]
            ref = float(np.median(np.concatenate([f[f > 0] for f in clean_tracks])))
            for it, a, fc in zip(ITEMS, clips, clean_tracks):
                f = fn(degrade(a, kind, rng))
                L = min(len(f), len(fc))
                span = voiced_span(a, fc[:L])
                v = f[:L] > 0
                cov.append(v[span].mean() if span.any() else 0)
                both = span & v & (fc[:L] > 0)
                if both.any():
                    e = np.abs(12 * np.log2(f[:L][both] / fc[:L][both]))
                    errs.append(np.median(e))
                    big += int((e > 3).sum())
                idx = np.where(span)[0]
                if len(idx):
                    seg = v[idx[0]: idx[-1] + 1].astype(int)
                    edges = np.flatnonzero(np.diff(np.r_[1, seg, 1]))
                    holes = edges[1::2] - edges[0::2]
                    gaps += bool(len(holes) and holes.max() >= 3)
                st = pitch.semitones(f, ref)
                vi = np.where(f > 0)[0]
                p = pitch.classify(st[vi[0]: vi[-1] + 1], True) if len(vi) else None
                t = tone_of(it["zhuyin"])
                got = p["tone"] if p else None
                n += 1
                ok += got == t
                conf[(t, got)] += 1
                if t == 4:
                    n4 += 1
                    ok4 += got == 4
        print(f"{kind:8s} coverage {np.mean(cov):.3f}  min {np.min(cov):.2f}  gaps {gaps:3d}/{n}  err {np.mean(errs):.2f}st  frames>3st {big:4d}  pitch-tone {ok}/{n} ({ok / n:.0%})  tone4 {ok4}/{n4}", flush=True)


if __name__ == "__main__":
    main(*sys.argv[1:])
