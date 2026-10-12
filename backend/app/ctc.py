"""CTC scoring on the frame log probabilities of the speech model. Pure numpy: no model, no database.

Used by the symbol quiz (symbols.py) and by the deep check worker (deep_check_core.py), which runs in its own process.
A "unit" is a group of vocabulary ids that count as the same sound (for example ㄢ with every tone digit).
"""
from __future__ import annotations

import numpy as np

SPECIAL = ("[PAD]", "|", "[UNK]", "<s>", "</s>")
NEG = -1e30


def vocab_groups(vocab: dict[int, str], size: int) -> tuple[dict[str, list[int]], list[int]]:
    """One group of vocabulary ids per initial or final (all tones together), plus one blank group.
    vocab maps id -> token. Ids beyond the vocab file are special tokens and count as blank."""
    units: dict[str, list[int]] = {}
    blank = [i for i in range(size) if i not in vocab]
    for i, tok in vocab.items():
        if tok in SPECIAL:
            blank.append(i)
        else:
            units.setdefault(tok[:-1] if tok[-1:].isdigit() else tok, []).append(i)
    return units, blank


def _emit(seq: list[np.ndarray], blank: np.ndarray) -> np.ndarray:
    ext = [blank]
    for u in seq:
        ext += [u, blank]
    return np.stack(ext, axis=1)  # (frames, states)


def ctc(seq: list[np.ndarray], blank: np.ndarray) -> float:
    """Log probability of the unit sequence over the whole clip (CTC forward pass).
    seq: one array per unit, the log probability of that unit in every frame. blank: the same for the blank."""
    emit = _emit(seq, blank)
    n = emit.shape[1]
    a = np.full(n, NEG)
    a[0], a[1] = emit[0, 0], emit[0, 1]
    odd = np.arange(n) % 2 == 1
    for f in range(1, emit.shape[0]):
        step = np.concatenate([[NEG], a[:-1]])
        skip = np.where(odd, np.concatenate([[NEG, NEG], a[:-2]]), NEG)  # skip a blank between two units
        a = np.logaddexp(np.logaddexp(a, step), skip) + emit[f]
    return float(np.logaddexp(a[-1], a[-2]))


def ctc_viterbi(seq: list[np.ndarray], blank: np.ndarray) -> list[tuple[int, int]] | None:
    """The frames of each unit on the best CTC path: one (first frame, last frame) per unit of seq.
    None when the clip has fewer frames than the sequence needs."""
    emit = _emit(seq, blank)
    frames, n = emit.shape
    if frames < len(seq) or not seq:
        return None
    odd = np.arange(n) % 2 == 1
    a = np.full(n, NEG)
    a[0], a[1] = emit[0, 0], emit[0, 1]
    back = np.zeros((frames, n), dtype=np.int32)
    idx = np.arange(n)
    for f in range(1, frames):
        stay = a
        step = np.concatenate([[NEG], a[:-1]])
        skip = np.where(odd, np.concatenate([[NEG, NEG], a[:-2]]), NEG)
        cand = np.stack([stay, step, skip])  # 0: stay, 1: from the state before, 2: skip a blank
        best = cand.argmax(0)
        back[f] = idx - best
        a = cand[best, idx] + emit[f]
    end = n - 1 if a[n - 1] >= a[n - 2] else n - 2
    if a[end] <= NEG / 2:
        return None
    states = np.zeros(frames, dtype=np.int32)
    states[-1] = end
    for f in range(frames - 1, 0, -1):
        states[f - 1] = back[f, states[f]]
    spans: list[list[int]] = [[-1, -1] for _ in seq]
    for f, s in enumerate(states):
        if s % 2 == 1:
            u = s // 2
            if spans[u][0] < 0:
                spans[u][0] = f
            spans[u][1] = f
    if any(s[0] < 0 for s in spans):
        return None
    return [(s[0], s[1]) for s in spans]
