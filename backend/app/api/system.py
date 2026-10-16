"""Server health: the speech model, the AI configuration, and the voice pitch of the learner."""

from __future__ import annotations

from fastapi import APIRouter

from .. import speaker
from ..asr import recognizer
from ..config import OPENROUTER_API_KEY, OPENROUTER_MODEL

router = APIRouter()


# Public (auth.PUBLIC). With a valid token, speaker_hz is the voice pitch of that learner.
@router.get("/health")
def health():
    return {
        "ok": True,
        "speech_model": "ready" if recognizer.ready else ("error" if recognizer.error else "loading"),
        "speech_error": recognizer.error,
        "speech_load_seconds": recognizer.load_seconds,
        "llm_model": OPENROUTER_MODEL,
        "llm_configured": bool(OPENROUTER_API_KEY),
        "speaker_hz": speaker.get(),
    }
