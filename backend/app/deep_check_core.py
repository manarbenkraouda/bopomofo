"""The deep check: a second, slower look at the parts of a spoken answer that the live check marked wrong.

The live check decodes the speech greedily: one best token per frame. Close sounds (b and p, n and d, en and eng) and a
blocked nose often tip that choice the wrong way. Here each missed part is checked with forced CTC alignment on the same
frame log probabilities: does the expected sentence explain the audio about as well as the sentence with the heard
sound (or a close neighbour) in that place? Tones get the same test with the five tone digits, plus the pitch on the
frames that the alignment gives to the syllable.

This module runs in the deep check worker process (app/deep_check.py). It imports only numpy, ctc, and pitch: never the
speech model, the database, or onnxruntime. Everything it needs comes in the job.
"""

from __future__ import annotations

import math
import os
import sys

import numpy as np

from . import pitch
from .ctc import ctc, ctc_viterbi, vocab_groups

VERSION = "dc1"
# How much worse (in nats, log probability of the whole clip) the expected sound may explain the audio than a rival
# sound and still count as said. Starting values: shadow mode data tunes them (tools/eval_deep_check.py).
SOUND_MARGIN = 1.0
# Pairs that a blocked nose or this learner's microphone mixes up (and the learner's typed mic pairs) get more room.
MIC_MARGIN = 3.0
# A tone counts as said when the accepted tones get at least this share of the five tone scores.
TONE_MIN = 0.5
RIGHT = 80

LABIALS = set("ㄅㄆㄇㄈ")
RETROFLEX = set("ㄓㄔㄕㄖ")
DENTAL = set("ㄗㄘㄙ")
GLIDES = set("ㄧㄨㄩ")
# Close sounds the live check can confuse: each one is a rival of the others in its group.
INITIAL_GROUPS = ["ㄅㄆ", "ㄉㄊ", "ㄍㄎ", "ㄗㄘㄙ", "ㄓㄔㄕ", "ㄐㄑㄒ", "ㄋㄌ", "ㄇㄅ", "ㄋㄉ"]
FINAL_GROUPS = [
    ("ㄣ", "ㄥ"),
    ("ㄧㄣ", "ㄧㄥ"),
    ("ㄨㄣ", "ㄨㄥ"),
    ("ㄢ", "ㄤ"),
    ("ㄧㄢ", "ㄧㄤ"),
    ("ㄨㄢ", "ㄨㄤ"),
    ("ㄛ", "ㄨㄛ"),
]
NASAL_PAIRS = {frozenset("ㄇㄅ"), frozenset("ㄋㄉ"), frozenset("ㄋㄌ")}

_vocab: dict[int, str] | None = None


# ---------- worker process ----------


def init_worker(vocab: dict[int, str]) -> None:
    """Runs once in the worker process: lower its priority so live requests always come first, and keep the vocabulary."""
    try:
        if sys.platform == "win32":
            import ctypes

            k = ctypes.windll.kernel32
            k.SetPriorityClass(k.GetCurrentProcess(), 0x4000)  # BELOW_NORMAL_PRIORITY_CLASS
        else:
            os.nice(10)
    except Exception:  # noqa: BLE001
        pass
    set_vocab(vocab)


def set_vocab(vocab: dict[int, str]) -> None:
    global _vocab
    _vocab = {int(k): v for k, v in vocab.items()}


# ---------- units and sequences ----------


def _empty(v) -> bool:
    return v in (None, "", "∅")


def _norm(v) -> str:
    return "" if _empty(v) else str(v)


def initial_neighbours(initial: str) -> set[str]:
    out = set()
    for g in INITIAL_GROUPS:
        if initial in g:
            out |= set(g)
    out.discard(initial)
    return out


def final_neighbours(final: str) -> set[str]:
    out = set()
    for g in FINAL_GROUPS:
        if final in g:
            out |= set(g)
    out.discard(final)
    return out


class Frames:
    """The frame log probabilities of one clip, grouped into the units the checks need."""

    def __init__(self, lp: np.ndarray, vocab: dict[int, str]):
        self.lp = np.asarray(lp, dtype=np.float64)
        units, blank = vocab_groups(vocab, self.lp.shape[1])
        self.ids = units
        self.tone_ids: dict[tuple[str, int], list[int]] = {}
        for i, tok in vocab.items():
            if tok[-1:].isdigit() and tok[:-1]:
                self.tone_ids.setdefault((tok[:-1], int(tok[-1])), []).append(i)
        self.blank = np.logaddexp.reduce(self.lp[:, blank], axis=1)
        self._cache: dict[tuple, np.ndarray] = {}

    def unit(self, keys: tuple[str, ...], tone: int | None = None) -> np.ndarray | None:
        """Log probability per frame of any token in keys (with this tone digit only, when tone is set)."""
        ck = (keys, tone)
        if ck not in self._cache:
            ids: list[int] = []
            for k in keys:
                ids += self.ids.get(k, []) if tone is None else self.tone_ids.get((k, tone), [])
            self._cache[ck] = np.logaddexp.reduce(self.lp[:, ids], axis=1) if ids else None
        return self._cache[ck]


def final_keys(initial: str, final: str) -> tuple[str, ...]:
    """The model tokens (without the tone digit) that stand for this final after this initial."""
    if not final:
        if initial in RETROFLEX:
            return ("ㄭ+",)
        if initial in DENTAL:
            return ("ㄭ-",)
        return ()
    if final == "ㄦ":
        return ("ㄦ", "r")
    if initial in LABIALS and final in ("ㄛ", "ㄨㄛ"):
        return ("ㄛ", "ㄨㄛ")  # scoring.finals_match: the same sound after b, p, m, f
    return (final,)


def syllable_units(fr: Frames, s: dict, j: bool = False, tone: int | None = None) -> list[np.ndarray] | None:
    """The unit sequence of one syllable spec {initial, final}. None when the model has no token for a part."""
    ini, fin = s["initial"], s["final"]
    out = []
    if ini:
        u = fr.unit((ini,))
        if u is None:
            return None
        out.append(u)
    elif j:
        out.append(fr.unit(("j",)))
    keys = final_keys(ini, fin)
    if not keys:
        return out or None
    u = fr.unit(keys, tone)
    if u is None:
        return None
    out.append(u)
    return out


def sentence(fr: Frames, specs: list[dict | None], js: list[bool], tone_at: tuple[int, int] | None = None):
    """The unit sequence of the whole sentence and the unit index range of every syllable. None if a unit is missing.
    specs[k] None: syllable k is left out. tone_at (k, d): syllable k uses only the tone digit d for its final."""
    seq: list[np.ndarray] = []
    ranges: list[tuple[int, int] | None] = []
    for k, s in enumerate(specs):
        if s is None:
            ranges.append(None)
            continue
        us = syllable_units(fr, s, js[k], tone_at[1] if tone_at and tone_at[0] == k else None)
        if us is None:
            return None, None
        ranges.append((len(seq), len(seq) + len(us)))
        seq += us
    if any(u is None for u in seq):
        return None, None
    return seq, ranges


def score_of(fr: Frames, specs, js, tone_at=None) -> float | None:
    seq, _ = sentence(fr, specs, js, tone_at)
    if not seq or len(seq) > fr.lp.shape[0]:
        return None
    return ctc(seq, fr.blank)


# ---------- the check ----------


def _margin(kind: str, expected: str, rival: str, mic: set) -> float:
    if kind == "initial" and frozenset((expected, rival)) in NASAL_PAIRS:
        return MIC_MARGIN
    if (kind, expected or "∅", rival or "∅") in mic:
        return MIC_MARGIN
    return SOUND_MARGIN


def _points(r: dict, fixed: dict) -> int:
    """The live check's points for one syllable (scoring.analyze: initial, final, and tone), with the fixed parts."""
    present = bool(r.get("heard")) or fixed.get("syllable", False)
    ini = present and (r.get("initial_ok") in (True, None) or fixed.get("initial", False))
    fin = present and (r.get("final_ok") in (True, None) or fixed.get("final", False))
    tone = bool(r.get("tone_ok")) or fixed.get("tone", False)
    return int(ini) + int(fin) + int(tone)


def score_from(results: list[dict], fixed: list[dict]) -> int:
    got = sum(_points(r, f) for r, f in zip(results, fixed, strict=False))
    return round(100 * got / max(3 * len(results), 1))


def check(job: dict) -> dict:
    """Check the missed parts of one spoken answer again.

    job: lp (frames x vocab log probabilities), audio_seconds, syllables (the live results: expected, heard, initial_ok,
    final_ok, tone_ok), semitones (pitch per 10 ms, None where unvoiced), has_ref, score, mic_pairs ([kind, expected,
    heard] the learner confirmed by typing), and vocab when the worker was not initialized with one.
    Returns {status, verdict, score_before, score_after, parts, version}. A part's verdict is fixed, real, or unsure."""
    vocab = job.get("vocab") or _vocab
    if vocab is None:
        raise RuntimeError("The deep check has no vocabulary.")
    if job.get("vocab"):
        vocab = {int(k): v for k, v in vocab.items()}
    fr = Frames(job["lp"], vocab)
    results = job["syllables"]
    mic = {(k, e or "∅", h or "∅") for k, e, h in job.get("mic_pairs") or []}
    specs = [
        {"initial": _norm(r["expected"].get("initial")), "final": _norm(r["expected"].get("final"))} for r in results
    ]
    n = len(specs)

    # A syllable with no initial that starts with ㄧ, ㄨ, or ㄩ: the model may write a "j" glide first. Keep it where it fits better.
    js = [False] * n
    base = score_of(fr, specs, js)
    if base is None:
        return {
            "status": "error",
            "verdict": None,
            "score_before": job.get("score"),
            "score_after": None,
            "parts": [],
            "version": VERSION,
            "error": "The expected sentence does not fit the clip.",
        }
    for k, s in enumerate(specs):
        if not s["initial"] and s["final"][:1] in GLIDES:
            trial = [*js[:k], True, *js[k + 1 :]]
            v = score_of(fr, specs, trial)
            if v is not None and v > base:
                js, base = trial, v
    L_exp = base

    parts: list[dict] = []
    fixed: list[dict] = [{} for _ in range(n)]
    for k, r in enumerate(results):
        e = r["expected"]
        h = r.get("heard")
        missing = not h and r.get("initial_ok") is False
        if missing:
            without = score_of(fr, [s if i != k else None for i, s in enumerate(specs)], js)
            delta = None if without is None else L_exp - without
            ok = delta is not None and delta >= -SOUND_MARGIN
            fixed[k]["syllable"] = ok
            for kind in ("initial", "final"):
                fixed[k][kind] = ok
                parts.append(
                    {
                        "pos": k,
                        "kind": kind,
                        "expected": specs[k][kind] or "∅",
                        "heard": "?",
                        "verdict": "fixed" if ok else "real",
                        "delta": None if delta is None else round(delta, 2),
                    }
                )
        else:
            for kind in ("initial", "final"):
                if r.get(f"{kind}_ok") is not False:
                    continue
                exp_v = specs[k][kind]
                heard_v = _norm(h.get(kind)) if h else ""
                near = initial_neighbours(exp_v) if kind == "initial" else final_neighbours(exp_v)
                if kind == "final":
                    near -= set(
                        final_keys(specs[k]["initial"], exp_v)
                    )  # ㄛ and ㄨㄛ after a labial are already the same
                rivals = ({heard_v} | near) - {exp_v}
                worst, best_rival, ok = None, None, True
                for rv in sorted(rivals):
                    spec = {**specs[k], kind: rv}
                    if not syllable_units(fr, spec, js[k]):
                        continue
                    v = score_of(fr, [spec if i == k else s for i, s in enumerate(specs)], js)
                    if v is None:
                        continue
                    d = L_exp - v
                    if d < -_margin(kind, exp_v, rv, mic):
                        ok = False
                    if worst is None or d < worst:
                        worst, best_rival = d, rv
                verdict = "fixed" if ok and worst is not None else ("unsure" if worst is None else "real")
                fixed[k][kind] = verdict == "fixed"
                parts.append(
                    {
                        "pos": k,
                        "kind": kind,
                        "expected": exp_v or "∅",
                        "heard": heard_v or "∅",
                        "rival": best_rival,
                        "verdict": verdict,
                        "delta": None if worst is None else round(worst, 2),
                    }
                )

        if r.get("tone_ok") or (missing and not fixed[k].get("syllable")):
            continue
        want = int(e["surface_tone"])
        accepted = {want, *[int(t) for t in e.get("alt_tones") or []]}
        scores = []
        for d in range(1, 6):
            scores.append(score_of(fr, specs, js, (k, d)))
        if any(v is None for v in scores):
            parts.append(
                {"pos": k, "kind": "tone", "expected": want, "heard": (h or {}).get("tone"), "verdict": "unsure"}
            )
            continue
        top = max(scores)
        w = np.exp(np.array(scores) - top)
        probs = w / w.sum()
        p_acc = float(sum(probs[t - 1] for t in accepted))
        best_tone = int(np.argmax(probs)) + 1
        pitch_tone = None
        if want != 5:
            pitch_tone = _pitch_tone(fr, specs, js, k, job)
        if p_acc >= TONE_MIN and (pitch_tone is None or pitch_tone in accepted):
            verdict = "fixed"
        elif p_acc >= TONE_MIN:
            verdict = "unsure"
        else:
            verdict = "real"
        fixed[k]["tone"] = verdict == "fixed"
        parts.append(
            {
                "pos": k,
                "kind": "tone",
                "expected": want,
                "heard": (h or {}).get("tone"),
                "verdict": verdict,
                "p_tone": round(p_acc, 3),
                "best_tone": best_tone,
                "pitch_tone": pitch_tone,
            }
        )

    before = job.get("score")
    if before is None:
        before = score_from(results, [{} for _ in range(n)])
    after = score_from(results, fixed)
    any_fixed = any(p["verdict"] == "fixed" for p in parts)
    after = max(after, before) if any_fixed else before
    if any_fixed and after >= RIGHT and before < RIGHT:
        verdict = "false_miss"
    elif any_fixed:
        verdict = "partial"
    else:
        verdict = "real_miss"
    return {
        "status": "done",
        "verdict": verdict,
        "score_before": before,
        "score_after": after,
        "parts": parts,
        "version": VERSION,
    }


def _pitch_tone(fr: Frames, specs, js, k: int, job: dict) -> int | None:
    """The pitch tone of syllable k on the frames the forced alignment gives it (to the start of the next syllable)."""
    seq, ranges = sentence(fr, specs, js)
    spans = ctc_viterbi(seq, fr.blank) if seq else None
    if not spans or not ranges or ranges[k] is None:
        return None
    a_u, b_u = ranges[k]
    f0, f1 = spans[a_u][0], spans[b_u - 1][1]
    nxt = next((ranges[i] for i in range(k + 1, len(ranges)) if ranges[i]), None)
    end = spans[nxt[0]][0] - 1 if nxt else min(fr.lp.shape[0] - 1, f1 + 10)
    end = max(end, f1)
    per = float(job.get("audio_seconds") or 0) / fr.lp.shape[0]
    st = np.array([np.nan if v is None else float(v) for v in job.get("semitones") or []], dtype=float)
    if not per or not len(st):
        return None
    a, b = int(f0 * per * 100), math.ceil((end + 1) * per * 100)
    p = pitch.classify(st[a:b], bool(job.get("has_ref")))
    return int(p["tone"]) if p else None
