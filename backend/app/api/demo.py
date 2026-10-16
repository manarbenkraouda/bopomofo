"""The speaking demo of the front page. A visitor without an account says one of a few fixed phrases and gets the
real speech check. Nothing is saved: no answer, no voice pitch, no deep check, no recording.

The route is public (auth.PUBLIC), so it protects the CPU of the learners: fixed phrases, short recordings, one check
at a time, and a limit for each address and for all visitors together.
"""

from __future__ import annotations

import threading
import time
from collections import deque

import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from .. import scoring
from ..audio import SAMPLE_RATE, read_audio
from .speech import SILENCE_PEAK, require_speech_model

router = APIRouter()

# The cards of the front page (frontend/src/components/landing/sayCards.ts). The model audio of each one scores 100
# in this check. Three change a tone (3-3, 不, 一), and in 對不起 the 不 keeps tone 4.
PHRASES = ("你好", "不要", "一起吃飯", "對不起")
MAX_SECONDS = 6
PER_ADDRESS = 20  # checks per address in one hour
ALL_VISITORS = 600  # checks for all visitors together in one hour
HOUR = 3600
WAIT_SECONDS = 15  # a check waits this long for the one before it, then the visitor tries again
BUSY = "The demo is busy right now. Try again in a minute."

_one_at_a_time = threading.Semaphore(1)
_lock = threading.Lock()
_by_address: dict[str, deque[float]] = {}
_all: deque[float] = deque()


def client_address(request: Request) -> str:
    """The visitor's address. Caddy connects from 127.0.0.1 and puts the address it saw last in X-Forwarded-For."""
    peer = request.client.host if request.client else ""
    forwarded = request.headers.get("x-forwarded-for", "")
    if peer in ("127.0.0.1", "::1") and forwarded:
        return forwarded.split(",")[-1].strip()
    return peer


def admit(address: str, now: float | None = None) -> None:
    """Count one check, or raise 429 when the address or all visitors used the hour."""
    now = time.time() if now is None else now
    with _lock:
        while _all and _all[0] <= now - HOUR:
            _all.popleft()
        for key in [k for k, q in _by_address.items() if not q or q[-1] <= now - HOUR]:
            del _by_address[key]
        mine = _by_address.setdefault(address, deque())
        while mine and mine[0] <= now - HOUR:
            mine.popleft()
        if len(mine) >= PER_ADDRESS:
            raise HTTPException(429, f"The demo allows {PER_ADDRESS} checks an hour. Make an account to keep going.")
        if len(_all) >= ALL_VISITORS:
            raise HTTPException(429, BUSY)
        mine.append(now)
        _all.append(now)


def reset() -> None:
    """For tests."""
    with _lock:
        _by_address.clear()
        _all.clear()


@router.post("/demo/speech")
def demo_speech(request: Request, audio: UploadFile = File(...), text: str = Form(..., max_length=8)):
    if text not in PHRASES:
        raise HTTPException(400, "The demo checks only its own phrases.")
    require_speech_model()
    a = read_audio(audio.file.read())
    if len(a) > SAMPLE_RATE * MAX_SECONDS:
        raise HTTPException(400, f"The recording is too long ({MAX_SECONDS} s maximum).")
    if np.abs(a).max() < SILENCE_PEAK:
        raise HTTPException(400, "The recording is silent. Check the microphone.")
    admit(client_address(request))
    if not _one_at_a_time.acquire(timeout=WAIT_SECONDS):
        raise HTTPException(503, BUSY)
    try:
        res = scoring.analyze(a, text, None)
    finally:
        _one_at_a_time.release()
    # The private keys are for the deep check, and the voice pitch is for a learner profile. The demo keeps neither.
    for key in ("_lp", "_has_ref", "speaker_hz"):
        res.pop(key, None)
    return res
