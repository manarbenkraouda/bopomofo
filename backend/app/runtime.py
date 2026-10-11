"""How the speech model and the voices run on this machine.

Both profiles use ONNX Runtime on the CPU; only the tuning differs:
- local: the Windows ARM64 laptop (Snapdragon X2 Elite). The full-precision speech model on every core and 8 voice
  threads, as measured when the project started (about 0.5 s of processing for a 2.5 s sentence).
- vps: the ARM production server. At most 4 threads each, so speech, voices, and the API share its small CPU.

SPEECH_RUNTIME chooses the profile. Without it, Linux means vps and every other system means local.
ASR_NUM_THREADS, TTS_NUM_THREADS, and ASR_MODEL_FILE override one value of the profile.
Both profiles use the FP32 speech model when present, and the int8 model (tools/quantize_model.py) when it is not.
"""
from __future__ import annotations

import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from .config import MODEL_DIR

PROFILES = ("local", "vps")
FP32_MODEL = "wav2vec2-cmn-phonetic.onnx"
INT8_MODEL = "wav2vec2-cmn-phonetic.int8.onnx"


@dataclass(frozen=True)
class Runtime:
    profile: str
    asr_model: Path
    asr_threads: int
    asr_inter_op_threads: int | None  # None: the ONNX Runtime default
    tts_threads: int

    def describe(self) -> str:
        return (f"{self.profile}: speech model {self.asr_model.name} on {self.asr_threads} threads, "
                f"voices on {self.tts_threads} threads")


def _threads(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    if not raw.isdigit() or int(raw) < 1:
        raise ValueError(f"{name} must be a whole number of threads, 1 or more (got {raw!r}).")
    return int(raw)


def resolve(env: Mapping[str, str] = os.environ, platform: str = sys.platform, cpus: int | None = os.cpu_count(),
            model_dir: Path = MODEL_DIR) -> Runtime:
    profile = env.get("SPEECH_RUNTIME", "").strip().lower() or ("vps" if platform.startswith("linux") else "local")
    if profile not in PROFILES:
        raise ValueError(f"SPEECH_RUNTIME must be one of {', '.join(PROFILES)} (got {profile!r}).")
    cpus = cpus or 4
    if profile == "local":
        asr, inter_op, tts = cpus, None, 8
    else:
        asr, inter_op, tts = min(4, cpus), 1, min(4, cpus)
    configured = env.get("ASR_MODEL_FILE", "").strip()
    if configured:
        model = Path(configured) if Path(configured).is_absolute() else model_dir / configured
    else:
        model = model_dir / FP32_MODEL if (model_dir / FP32_MODEL).is_file() else model_dir / INT8_MODEL
    return Runtime(profile, model, _threads(env, "ASR_NUM_THREADS", asr), inter_op, _threads(env, "TTS_NUM_THREADS", tts))


RUNTIME = resolve()
