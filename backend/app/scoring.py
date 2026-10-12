"""Compare what the learner said with the target text, syllable by syllable."""
from __future__ import annotations

import numpy as np

from . import pitch
from .asr import recognizer
from .zhuyin import KEEP_LINE, rule_line, syllables_of, tested_rule, zhuyin_of

TONE_HINTS = {
    1: "Tone 1: keep it high and flat.",
    2: "Tone 2: start in the middle and rise, like a question.",
    3: "Tone 3: go low. Alone it dips and rises; inside a phrase it stays low.",
    4: "Tone 4: start high and drop fast.",
    5: "Neutral tone: say it short and light.",
}
LABIALS = set("ㄅㄆㄇㄈ")


def finals_match(heard: str, expected: str, initial: str) -> bool:
    if heard == expected:
        return True
    if initial in LABIALS and {heard, expected} == {"ㄛ", "ㄨㄛ"}:
        return True
    return False


def _sim(h: dict, e: dict) -> float:
    s = 0.0
    s += 0.35 if h["initial"] == e["initial"] else 0
    s += 0.45 if finals_match(h["final"], e["final"], e["initial"]) else 0
    s += 0.2 if h["tone"] in (e["surface_tone"], e["tone"], *e["alt_tones"]) else 0
    return s


def align(expected: list[dict], heard: list[dict]):
    n, m = len(expected), len(heard)
    gap = 0.75
    d = np.zeros((n + 1, m + 1))
    d[:, 0] = np.arange(n + 1) * gap
    d[0, :] = np.arange(m + 1) * gap
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i, j] = min(d[i - 1, j - 1] + 1 - _sim(heard[j - 1], expected[i - 1]), d[i - 1, j] + gap, d[i, j - 1] + gap)
    pairs = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and np.isclose(d[i, j], d[i - 1, j - 1] + 1 - _sim(heard[j - 1], expected[i - 1])):
            pairs.append((i - 1, j - 1)); i -= 1; j -= 1
        elif i > 0 and np.isclose(d[i, j], d[i - 1, j] + gap):
            pairs.append((i - 1, None)); i -= 1
        else:
            pairs.append((None, j - 1)); j -= 1
    return pairs[::-1]


def analyze(audio: np.ndarray, text: str, speaker_ref: float | None = None) -> dict:
    expected = syllables_of(text)
    if not expected:
        raise ValueError("The target text has no Chinese characters.")
    asr = recognizer.transcribe(audio)
    heard = asr["syllables"]
    f0 = pitch.track(audio)
    voiced = f0[f0 > 0]
    single = len(expected) == 1
    utt_ref = float(np.median(voiced)) if len(voiced) else 200.0
    ref = speaker_ref if (single and speaker_ref) else utt_ref
    # Pitch levels are meaningful when measured against the speaker's own range.
    has_ref = (len(voiced) >= 25 and not single) or bool(single and speaker_ref)
    st = pitch.semitones(f0, ref)
    vi = np.where(f0 > 0)[0]
    v_start, v_end = (vi[0] / 100, (vi[-1] + 1) / 100) if len(vi) else (0.0, len(audio) / 16000)
    # CTC marks only a short spike per token: extend each syllable until the next one starts.
    for k, h in enumerate(heard):
        nxt = heard[k + 1]["start"] if k + 1 < len(heard) else max(v_end, h["end"])
        h["end"] = max(h["end"], nxt)
        if k == 0:
            h["start"] = min(h["start"], max(v_start, h["start"] - 0.15))

    def seg_pitch(start: float, end: float):
        a, b = int(start * 100), int(np.ceil(end * 100))
        return pitch.classify(st[a:b], has_ref)

    results = []
    extras = []
    for ei, hj in align(expected, heard):
        if ei is None:
            extras.append(heard[hj])
            continue
        e = expected[ei]
        h = heard[hj] if hj is not None else None
        r = {"expected": e, "heard": None, "initial_ok": False, "final_ok": False, "tone_ok": False, "messages": []}
        span = (h["start"], h["end"]) if h else None
        if single and len(vi):
            span = (v_start, v_end)
        p = seg_pitch(*span) if span else None
        if h is None and not (single and p):
            r["messages"].append("This syllable was not heard.")
            results.append(r)
            continue
        model_tone = h["tone"] if h else None
        pitch_tone = p["tone"] if p else None
        # The model's tone is the main signal (70% on isolated syllables vs 43% for pitch rules in our tests);
        # the pitch estimate only fills in when the model gives no tone or a neutral tone.
        if model_tone in (None, 5) and e["surface_tone"] != 5:
            heard_tone, source = (pitch_tone, "pitch") if pitch_tone else (model_tone, "model")
        else:
            heard_tone, source = model_tone, "model"
        # Taiwan tone 3 alone is often a low fall that the model labels tone 4. With the learner's pitch
        # reference, a fall that starts low and moves little is tone 3. Tuned for the Praat tracker on 198 isolated
        # syllables (tools/eval_pitch.py data): +20 fixed, 0 broken; stable for range limits 7.0-9.0.
        if single and speaker_ref and heard_tone == 4 and span:
            a_, b_ = int(span[0] * 100), int(np.ceil(span[1] * 100))
            seg = st[a_:b_]
            seg = seg[~np.isnan(seg)]
            if len(seg) >= 5:
                sm = np.convolve(seg, np.ones(3) / 3, mode="valid")
                if seg[: len(seg) // 2].mean() < 2.0 and (sm.max() - sm.min()) < 7.5:
                    heard_tone, source = 3, "model+pitch"
        r.update({
            "heard": {"initial": h["initial"] if h else None, "final": h["final"] if h else None, "tone": heard_tone,
                      "zhuyin": zhuyin_of(h["initial"], h["final"], heard_tone or 1) if h else None},
            "model_tone": model_tone, "pitch_tone": pitch_tone, "tone_source": source,
            "span": [round(span[0], 2), round(span[1], 2)] if span else None, "pitch": p,
            "uncertain": bool(model_tone and pitch_tone and model_tone != pitch_tone and model_tone != 5),
            "tone_probs": h.get("tone_probs") if h else None,
            "single": single,
        })
        if h:
            r["initial_ok"] = h["initial"] == e["initial"]
            r["final_ok"] = finals_match(h["final"], e["final"], e["initial"])
        else:
            r["initial_ok"] = r["final_ok"] = None  # single syllable, judged by pitch only
        want = e["surface_tone"]
        rule = e.get("rule") if e["surface_tone"] != e["tone"] else None
        r["rule"] = tested_rule(e)
        r["rule_error"] = None
        if want == 5:
            r["tone_ok"] = model_tone in (5, None) or heard_tone == 5
        else:
            r["tone_ok"] = heard_tone == want or heard_tone in e["alt_tones"]
        if r["initial_ok"] is False:
            r["messages"].append(f"Initial: you said {h['initial'] or '(none)'}, the target is {e['initial'] or '(none)'}.")
        if r["final_ok"] is False:
            r["messages"].append(f"Final: you said {h['final'] or '(none)'}, the target is {e['final'] or '(none)'}.")
        if not r["tone_ok"]:
            if heard_tone is None:
                r["messages"].append("Tone: not clear enough to judge.")
            elif rule:
                # The written Bopomofo shows the dictionary tone; a rule changes it here. Say so first and clearly.
                literal = heard_tone == e["tone"]
                r["rule_error"] = "literal" if literal else "other"
                said = zhuyin_of(e["initial"], e["final"], want)
                lead = (f"You read the written tone ({e['zhuyin']}, tone {e['tone']}). " if literal
                        else f"You said tone {heard_tone}. ")
                r["messages"].append(lead + rule_line(e["char"], e["tone"], want, rule) + f" Say {said} here.")
                r["messages"].append(TONE_HINTS[want])
            elif r["rule"] in KEEP_LINE and heard_tone in ((2,) if r["rule"] == "bu" else (2, 4)):
                # 不 or 一 that keep the written tone here: changing it is a rule error too.
                r["rule_error"] = "over"
                r["messages"].append(f"You said tone {heard_tone}. " + KEEP_LINE[r["rule"]])
                r["messages"].append(TONE_HINTS[want])
            elif want == 5:
                r["messages"].append(f"Tone: this is a neutral tone; you said tone {heard_tone}. " + TONE_HINTS[5])
            else:
                r["messages"].append(f"Tone: you said tone {heard_tone}, the target is tone {want}. " + TONE_HINTS[want])
        results.append(r)

    total = sum(3 for _ in results)
    got = sum((1 if x["initial_ok"] in (True, None) and x["heard"] else 0) + (1 if x["final_ok"] in (True, None) and x["heard"] else 0) + (1 if x["tone_ok"] else 0) for x in results)
    times = [round(i / 100, 2) for i in range(len(st))]
    return {
        "text": text,
        "score": round(100 * got / max(total, 1)),
        "speaker_hz": round(utt_ref, 1) if (len(expected) >= 2 and len(voiced) >= 25) else None,
        "syllables": results,
        "extra": [{"zhuyin": zhuyin_of(x["initial"], x["final"], x["tone"] or 1), "span": [x["start"], x["end"]]} for x in extras],
        "heard_raw": asr["raw"],
        "pitch": {"times": times, "semitones": [None if np.isnan(v) else round(float(v), 2) for v in st], "ref_hz": round(ref, 1)},
        "timing": {"infer_seconds": asr["infer_seconds"], "audio_seconds": asr["audio_seconds"]},
        # Private keys (a leading "_") are for the deep check only. /api/speech/analyze removes them before it saves or answers.
        "_lp": asr.get("log_probs"),
        "_has_ref": has_ref,
    }
