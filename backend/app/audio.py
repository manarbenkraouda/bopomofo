"""Recordings uploaded by the browser: read, check, and convert them to 16 kHz mono float32 for the speech model."""

from __future__ import annotations

import io

import numpy as np
import soundfile as sf
from fastapi import HTTPException

SAMPLE_RATE = 16000
MAX_SECONDS = 30
MIN_SECONDS = 0.3


def read_audio(data: bytes) -> np.ndarray:
    """The recording as 16 kHz mono samples. A 400 HTTPException when it cannot be read, is too short, or too long."""
    # Read the header first. A small compressed file (FLAC, OGG) can hold hours of audio: decoding all of it
    # before the length check used about 1 GB for an 89 KB file. The decoder reads at most the frames in the header.
    try:
        info = sf.info(io.BytesIO(data))
    except Exception as e:
        raise HTTPException(400, f"Could not read the audio: {e}") from e
    if not (1 <= info.channels <= 2 and 8000 <= info.samplerate <= 96000):
        raise HTTPException(400, "The recording is in a format the app does not read (mono or stereo, 8 to 96 kHz).")
    if info.frames > info.samplerate * (MAX_SECONDS + 0.5):
        raise HTTPException(400, f"The recording is too long ({MAX_SECONDS} s maximum).")
    try:
        a, sr = sf.read(io.BytesIO(data), dtype="float32")
    except Exception as e:
        raise HTTPException(400, f"Could not read the audio: {e}") from e
    if a.ndim > 1:
        a = a.mean(axis=1)
    if sr != SAMPLE_RATE:
        n = int(len(a) * SAMPLE_RATE / sr)
        a = np.interp(np.linspace(0, len(a) - 1, n), np.arange(len(a)), a).astype(np.float32)
    if len(a) < SAMPLE_RATE * MIN_SECONDS:
        raise HTTPException(400, "The recording is too short.")
    if len(a) > SAMPLE_RATE * MAX_SECONDS:
        raise HTTPException(400, f"The recording is too long ({MAX_SECONDS} s maximum).")
    return a
