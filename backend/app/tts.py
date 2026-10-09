"""Text to speech with the free Microsoft Edge neural voices (edge-tts). Results are cached on disk."""
from __future__ import annotations

import hashlib
from pathlib import Path

import edge_tts

from .config import DATA_DIR, TTS_VOICE


async def speak(text: str, rate: int = 0) -> Path:
    key = hashlib.sha1(f"{TTS_VOICE}|{rate}|{text}".encode()).hexdigest()
    path = DATA_DIR / "tts" / f"{key}.mp3"
    if not path.exists() or path.stat().st_size == 0:
        tmp = path.with_suffix(".part")
        await edge_tts.Communicate(text, TTS_VOICE, rate=f"{rate:+d}%").save(str(tmp))
        tmp.replace(path)
    return path
