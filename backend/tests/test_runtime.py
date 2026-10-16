"""The laptop keeps its original speech setup, and the VPS keeps its own tuning, from one code base."""

import pytest

from app.runtime import FP32_MODEL, INT8_MODEL, resolve


def test_laptop_and_vps_profiles(tmp_path):
    (tmp_path / FP32_MODEL).write_bytes(b"x")
    laptop = resolve({}, "win32", 12, tmp_path)
    assert (laptop.profile, laptop.asr_threads, laptop.asr_inter_op_threads, laptop.tts_threads) == (
        "local",
        12,
        None,
        8,
    )
    vps = resolve({}, "linux", 8, tmp_path)
    assert (vps.profile, vps.asr_threads, vps.asr_inter_op_threads, vps.tts_threads) == ("vps", 4, 1, 4)
    assert laptop.asr_model == vps.asr_model == tmp_path / FP32_MODEL
    assert (
        resolve({"SPEECH_RUNTIME": "local"}, "linux", 8, tmp_path).asr_threads == 8
    )  # the setting wins over the system


def test_overrides_and_fallback(tmp_path):
    r = resolve({"SPEECH_RUNTIME": "vps", "ASR_NUM_THREADS": "2", "TTS_NUM_THREADS": "3"}, "linux", 8, tmp_path)
    assert (r.asr_threads, r.tts_threads) == (2, 3)
    assert r.asr_model == tmp_path / INT8_MODEL  # no FP32 file: the int8 model
    assert resolve({"ASR_MODEL_FILE": "custom.onnx"}, "win32", 12, tmp_path).asr_model == tmp_path / "custom.onnx"
    for bad in ({"SPEECH_RUNTIME": "gpu"}, {"ASR_NUM_THREADS": "0"}, {"TTS_NUM_THREADS": "four"}):
        with pytest.raises(ValueError):
            resolve(bad, "win32", 12, tmp_path)
