"""Pitch tracking (YIN) and a rule-based Mandarin tone classifier."""
from __future__ import annotations

import numpy as np

SR = 16000
HOP = 160          # 10 ms
WIN = 400          # 25 ms
FMIN, FMAX = 75.0, 450.0


def track(audio: np.ndarray) -> np.ndarray:
    """Return f0 in Hz per 10 ms frame (0 = unvoiced)."""
    tmax = int(SR / FMIN)
    tmin = int(SR / FMAX)
    need = WIN + tmax
    if len(audio) < need:
        return np.zeros(0)
    n = 1 + (len(audio) - need) // HOP
    rms_all = np.array([np.sqrt(np.mean(audio[i * HOP:i * HOP + WIN] ** 2)) for i in range(n)])
    gate = max(rms_all.max() * 0.06, 1e-4)
    f0 = np.zeros(n)
    taus = np.arange(tmax + 1)
    for i in range(n):
        if rms_all[i] < gate:
            continue
        fr = audio[i * HOP:i * HOP + need]
        x = fr[:WIN]
        Y = np.lib.stride_tricks.sliding_window_view(fr, WIN)[: tmax + 1]
        d = ((Y - x) ** 2).sum(axis=1)
        cm = np.ones_like(d)
        cs = np.cumsum(d[1:])
        cm[1:] = d[1:] * taus[1:] / np.maximum(cs, 1e-12)
        band = cm[tmin:]
        below = np.where(band < 0.15)[0]
        if len(below):
            k = below[0]
            while k + 1 < len(band) and band[k + 1] < band[k]:
                k += 1
        else:
            k = int(np.argmin(band))
            if band[k] > 0.35:
                continue
        t = k + tmin
        if 1 <= t < len(cm) - 1:
            a, b, c = cm[t - 1], cm[t], cm[t + 1]
            den = a - 2 * b + c
            t = t + (0.5 * (a - c) / den if abs(den) > 1e-12 else 0)
        f0[i] = SR / t
    return clean(f0)


def clean(f0: np.ndarray) -> np.ndarray:
    v = f0 > 0
    if v.sum() < 3:
        return f0
    med = np.median(f0[v])
    out = f0.copy()
    for i in np.where(v)[0]:  # octave errors
        r = out[i] / med
        if r > 1.8:
            out[i] /= 2
        elif r < 0.55:
            out[i] *= 2
    sm = out.copy()  # median filter over voiced neighbours
    for i in np.where(v)[0]:
        w = out[max(0, i - 2): i + 3]
        w = w[w > 0]
        sm[i] = np.median(w)
    # drop isolated voiced frames
    for i in np.where(v)[0]:
        if (i == 0 or sm[i - 1] == 0) and (i + 1 >= len(sm) or sm[i + 1] == 0):
            sm[i] = 0
    return sm


def semitones(f0: np.ndarray, ref: float) -> np.ndarray:
    out = np.full(len(f0), np.nan)
    v = f0 > 0
    out[v] = 12 * np.log2(f0[v] / ref)
    return out


def classify(seg_st: np.ndarray, has_ref: bool) -> dict | None:
    """Classify one syllable from its pitch in semitones (relative to the speaker reference)."""
    v = seg_st[~np.isnan(seg_st)]
    if len(v) < 6:
        return None
    k = max(1, len(v) // 4)
    s, e = float(v[:k].mean()), float(v[-k:].mean())
    sm = np.convolve(v, np.ones(3) / 3, mode="valid") if len(v) >= 5 else v
    mn = float(sm.min())
    mnpos = float(np.argmin(sm) / max(1, len(sm) - 1))
    rng = float(sm.max() - mn)
    level = float(v.mean())
    rise, fall = e - s, s - e
    dip = min(s - mn, e - mn)
    if rng < 1.6:
        tone = 3 if has_ref and level < -2.5 else 1
    elif rise >= 1.8:
        tone = 3 if (s - mn) >= 1.5 and 0.15 < mnpos < 0.8 else 2
    elif fall >= 2.0:
        if has_ref and s < -1.5 and fall < 4:
            tone = 3
        else:
            tone = 4 if fall >= 3.5 or mnpos > 0.8 else (3 if e - mn >= 1.0 else 4)
    elif dip >= 1.5 and 0.15 < mnpos < 0.85:
        tone = 3
    else:
        tone = 3 if has_ref and level < -2.5 else 1
    return {"tone": tone, "start": round(s, 2), "end": round(e, 2), "min": round(mn, 2), "min_pos": round(mnpos, 2), "range": round(rng, 2)}
