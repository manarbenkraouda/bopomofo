"""Text to speech: the audio of a text, the voices, and the per-user audio cache."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from .. import db, limits, tts

router = APIRouter()


@router.get("/tts")
async def tts_get(text: str, rate: int = 0, voice: str = tts.DEFAULT_VOICE):
    """Audio of a text, from the cache of the signed-in user. The browser fetches it with the token (frontend/src/lib/audio.ts)."""
    if not text.strip() or len(text) > 400:
        raise HTTPException(400, "Text must be 1-400 characters.")
    try:
        path = await run_in_threadpool(tts.speak, text, max(-60, min(40, rate)), voice, db.current_user())
    except limits.LimitReached:
        raise
    except Exception as e:
        raise HTTPException(502, f"Text to speech failed: {e}") from e
    # private: only the browser of this user keeps a copy, never a shared cache.
    return FileResponse(path, media_type="audio/wav", headers={"Cache-Control": "private, max-age=31536000"})


@router.get("/tts/voices")  # public (auth.PUBLIC)
def tts_voices():
    return {
        "default": tts.DEFAULT_VOICE,
        "voices": [{"id": v.id, "label": v.label, "description": v.description} for v in tts.VOICES],
    }


@router.post("/tts/cache/clear")
def tts_cache_clear():
    """Clear the audio of the signed-in user only."""
    return tts.clear_cache(db.current_user())
