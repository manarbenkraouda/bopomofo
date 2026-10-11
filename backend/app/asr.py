"""Local speech recognition with the wav2vec2 MMS-1B Mandarin phonetic model (ONNX, CPU)."""
from __future__ import annotations

import json
import threading
import time

import numpy as np
import onnxruntime as ort

from .config import MODEL_DIR
from .runtime import RUNTIME
from .zhuyin import INITIALS

SR = 16000


class Recognizer:
    def __init__(self):
        self.session: ort.InferenceSession | None = None
        self.model_path = RUNTIME.asr_model
        self.vocab: dict[int, str] = {}
        self.error: str | None = None
        self.load_seconds: float | None = None
        self._lock = threading.Lock()
        self._loading = False

    @property
    def ready(self) -> bool:
        return self.session is not None

    def load_async(self):
        if self._loading or self.ready:
            return
        self._loading = True
        threading.Thread(target=self._load, daemon=True).start()

    def _load(self):
        t = time.time()
        try:
            v = json.loads((MODEL_DIR / "vocab.json").read_text(encoding="utf-8"))
            self.vocab = {i: tok for tok, i in v.items()}
            so = ort.SessionOptions()
            # The thread counts come from the runtime profile: every core on the laptop, at most 4 on the VPS.
            so.intra_op_num_threads = RUNTIME.asr_threads
            if RUNTIME.asr_inter_op_threads is not None:
                so.inter_op_num_threads = RUNTIME.asr_inter_op_threads
            so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            if not self.model_path.is_file():
                raise FileNotFoundError(f"Speech model not found: {self.model_path}")
            self.session = ort.InferenceSession(str(self.model_path), so, providers=["CPUExecutionProvider"])
            # Vocabulary ids per tone digit (tokens like "ㄚ3", "ㄭ+2", "r4").
            self.tone_ids = {d: np.array([i for i, t in self.vocab.items() if t[-1:] == str(d)]) for d in range(1, 6)}
            # Warm-up run so the first real request is fast.
            self.session.run(None, {"input_values": np.zeros((1, SR), np.float32)})
            self.load_seconds = round(time.time() - t, 1)
        except Exception as e:  # noqa: BLE001
            self.error = f"{type(e).__name__}: {e}"
        finally:
            self._loading = False

    def transcribe(self, audio: np.ndarray) -> dict:
        return self._decode(audio)

    def log_probs(self, audio: np.ndarray) -> np.ndarray:
        """Frame-by-frame log probabilities over the model vocabulary, shape (frames, vocab)."""
        if not self.ready:
            raise RuntimeError(self.error or "Speech model is still loading.")
        x = (audio - audio.mean()) / np.sqrt(audio.var() + 1e-7)
        with self._lock:
            logits = self.session.run(None, {"input_values": x[None].astype(np.float32)})[0][0]
        logits = logits - logits.max(-1, keepdims=True)
        return logits - np.log(np.exp(logits).sum(-1, keepdims=True))

    def _decode(self, audio: np.ndarray) -> dict:
        if not self.ready:
            raise RuntimeError(self.error or "Speech model is still loading.")
        x = (audio - audio.mean()) / np.sqrt(audio.var() + 1e-7)
        t = time.time()
        with self._lock:
            logits = self.session.run(None, {"input_values": x[None].astype(np.float32)})[0][0]
        infer = time.time() - t
        frame = len(audio) / SR / logits.shape[0]
        ids = logits.argmax(-1)
        probs = np.exp(logits - logits.max(-1, keepdims=True))
        probs /= probs.sum(-1, keepdims=True)
        tokens = []
        prev = -1
        skip = ("[PAD]", "[UNK]", "|", "<s>", "</s>")
        for f, i in enumerate(ids):
            i = int(i)
            tok = self.vocab.get(i, "[PAD]")  # ids beyond the vocab file are special tokens
            if i != prev and tok not in skip:
                tokens.append({"tok": tok, "f0": f, "f1": f})
            elif i == prev and tokens and tok not in skip:
                tokens[-1]["f1"] = f
            prev = i
        sylls = to_syllables(tokens, frame)
        # Tone probabilities for each syllable, from the frames of its final.
        for s in sylls:
            if s.get("_f") is None:
                continue
            a, b = s.pop("_f")
            win = probs[max(0, a - 1): b + 2]
            tp = np.array([win[:, self.tone_ids[d]].sum(-1).max() for d in range(1, 6)])
            s["tone_probs"] = [round(float(x), 3) for x in tp / max(tp.sum(), 1e-9)]
        return {"raw": "".join(t["tok"] for t in tokens), "syllables": sylls, "infer_seconds": round(infer, 2), "audio_seconds": round(len(audio) / SR, 2)}


def to_syllables(tokens: list[dict], frame: float) -> list[dict]:
    out = []
    pending = None
    for t in tokens:
        tok = t["tok"]
        if tok in INITIALS or tok == "j":
            if pending:
                out.append({"initial": pending["tok"].replace("j", ""), "final": "", "tone": None, "start": pending["f0"] * frame, "end": pending["f1"] * frame + frame})
            pending = t
            continue
        tone = int(tok[-1]) if tok[-1].isdigit() else None
        body = tok[:-1] if tone else tok
        if body.startswith("ㄭ"):
            final = ""
        elif body == "r":
            final = "ㄦ"
        else:
            final = body
        start = pending["f0"] if pending else t["f0"]
        out.append({"initial": pending["tok"].replace("j", "") if pending else "", "final": final, "tone": tone, "start": round(start * frame, 3), "end": round(t["f1"] * frame + frame, 3), "_f": (t["f0"], t["f1"])})
        pending = None
    if pending:
        out.append({"initial": pending["tok"].replace("j", ""), "final": "", "tone": None, "start": pending["f0"] * frame, "end": pending["f1"] * frame + frame})
    return out


recognizer = Recognizer()
