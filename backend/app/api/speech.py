"""Spoken answers: score a recording, its deep check, a typed correction, and the names of the Bopomofo symbols."""

from __future__ import annotations

import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .. import db, deep_check, numbers, scoring, speaker, stats, symbols, typed_fix
from ..asr import recognizer
from ..audio import read_audio
from .notices import refresh_notices

router = APIRouter()

SILENCE_PEAK = 0.01  # a recording whose loudest sample is below this is silent


def require_speech_model() -> None:
    """503 until the speech model is loaded (it loads in the background at startup)."""
    if not recognizer.ready:
        raise HTTPException(503, recognizer.error or "The speech model is still loading. Try again in a few seconds.")


@router.post("/speech/analyze")
def speech_analyze(
    audio: UploadFile = File(...),
    text: str = Form(..., max_length=400),
    mode: str = Form("", max_length=16),
    step: str = Form("", max_length=16),
    help: str = Form("", max_length=8),
    try_n: str = Form("", max_length=8),
    number: str = Form("", max_length=8),
):
    # Numbers mode: the learner sees digits. The text to check is always the characters of that number (Taiwan usage).
    num = int(number) if number.isdigit() and int(number) <= numbers.MAX else None
    if number and num is None:
        raise HTTPException(400, "The number must be a whole number from 0 to 99999999.")
    if num is not None:
        text = numbers.hanzi(num)
    require_speech_model()
    a = read_audio(audio.file.read())
    if np.abs(a).max() < SILENCE_PEAK:
        raise HTTPException(400, "The recording is silent. Check the microphone.")
    try:
        res = scoring.analyze(a, text, speaker.get())
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if res.get("speaker_hz"):
        speaker.update(res["speaker_hz"])
    # The frame log probabilities are for the deep check only: they are never saved or sent.
    lp, has_ref = res.pop("_lp", None), res.pop("_has_ref", False)
    want_deep = deep_check.wanted({**res, "_lp": lp})
    # Every syllable is saved: expected and heard tone, initial, and final, so the stats can show confusions.
    # "step": the coach step this recording belongs to. Only answers given inside a step count for it.
    # "help": the learner heard the model or saw the Pinyin first (the cheat). "try_n": 0 for the first recording of this card.
    args = {
        "step": int(step) if step.isdigit() else None,
        "help": help in ("1", "true"),
        "try_n": int(try_n) if try_n.isdigit() else 0,
    }
    if num is not None:
        # A spoken number gets no deep check: the deep check rewrites speaking answers only.
        eid = stats.log_number_speech(num, res, **args)
        del lp
        return {**res, "event_id": eid, "deep_check": "skipped", "notices": refresh_notices()}
    eid = stats.log_speaking(text, res, mode or None, **args)
    # A missed answer gets a second, slower check in a separate low-priority process. The answer does not wait for it.
    deep = "off" if deep_check.mode() == "off" else "skipped"
    if want_deep:
        mic = [[p["kind"], p["expected"], p["heard"]] for p in typed_fix.mic_pairs() if p["area"] == "speaking"]
        deep = deep_check.submit(deep_check.make_job(db.current_user(), eid, res, lp, has_ref, mic))
    del lp
    return {**res, "event_id": eid, "deep_check": deep, "notices": refresh_notices()}


@router.get("/speech/deep-check/{event_id}")
def speech_deep_check(event_id: int):
    """The deep check of one answer. 404 while it is still in the queue, or when no check runs for this answer."""
    r = deep_check.result(event_id)
    if not r:
        raise HTTPException(404, "No deep check for this answer yet.")
    return r


class ConfirmIn(BaseModel):
    event_ids: list[int] = Field(min_length=1, max_length=20)
    typed: str = Field(min_length=1, max_length=16)


@router.post("/speech/confirm")
def speech_confirm(body: ConfirmIn):
    """After missed recordings of one single-syllable card, the learner typed the sound they said in Pinyin.
    A match counts those misses as right (initials and finals only: the tones stay as measured)."""
    try:
        res = typed_fix.confirm_speaking(body.event_ids, body.typed)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {**res, "notices": refresh_notices()}


@router.post("/symbols/check")
def symbols_check(audio: UploadFile = File(...), symbol: str = Form(..., max_length=8)):
    """Reading quiz: did the learner say the name of this Bopomofo symbol?"""
    require_speech_model()
    a = read_audio(audio.file.read())
    try:
        res = symbols.check(a, symbol)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    symbols.save_clip(a, res)
    return res
