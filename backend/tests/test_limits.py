"""Limits that keep one account from using up the server: request size, audio length, AI spend, and audio clips and disk.
No test calls the AI provider or loads a voice model."""
import io
import os
import tracemalloc

import numpy as np
import pytest
import soundfile as sf
from fastapi import HTTPException

from app import db, limits, llm, main, tts
from tests.test_auth import A, B, client  # noqa: F401  (client is a fixture)


class Voice:
    def generate(self, text, sid=0, speed=1.0):
        return tts._Audio(np.full(2205, 0.1, np.float32), 22050)


@pytest.fixture()
def voices(monkeypatch, tmp_path):
    monkeypatch.setattr(tts, "DATA_DIR", tmp_path)
    monkeypatch.setattr(tts, "_engines", {"kokoro": Voice(), "breeze2": Voice()})
    return tmp_path / "tts"


def test_large_bodies_are_stopped_before_parsing(client):
    assert client.put("/api/profile", content=b"{" + b" " * (1024 * 1024) + b"}", headers={**A, "content-type": "application/json"}).status_code == 413
    chunks = (b" " * 65536 for _ in range(20))  # no Content-Length: counted as it arrives
    assert client.put("/api/profile", content=chunks, headers={**A, "content-type": "application/json"}).status_code == 413
    small = (part for part in (b'{"name": ', b'"Ana"}'))  # a small chunked body still reaches the route
    assert client.put("/api/profile", content=small, headers={**A, "content-type": "application/json"}).json() == {"name": "Ana"}
    big = {"audio": ("a.wav", b"0" * (17 * 1024 * 1024), "audio/wav")}
    assert client.post("/api/speech/analyze", files=big, data={"text": "你好"}).status_code == 413  # also without sign-in


def test_long_audio_is_rejected_before_decoding():
    buf = io.BytesIO()
    sf.write(buf, np.zeros(16000 * 600, np.int16), 16000, format="FLAC")  # 10 minutes in a small file
    data = buf.getvalue()
    tracemalloc.start()
    with pytest.raises(HTTPException) as e:
        main.read_audio(data)
    peak = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()
    assert e.value.status_code == 400 and "too long" in e.value.detail
    assert peak < 20 * 1024 * 1024


def test_ai_limit_stops_paid_calls(client, monkeypatch):
    monkeypatch.setattr(llm, "OPENROUTER_API_KEY", "")  # a call that passes the limit fails here, before the network
    with db.as_user("user_a"):
        limits.record("ai", 0.6)
        limits.record("ai", 0.6)
    r = client.post("/api/text/translate", json={"text": "你好"}, headers=A)
    assert r.status_code == 429 and "daily AI limit" in r.json()["detail"]
    assert client.post("/api/text/translate", json={"text": "你好"}, headers=B).status_code == 502  # B is not limited
    monkeypatch.setattr(limits, "AI_DAILY_LIMIT_USD", 100.0)
    monkeypatch.setattr(limits, "AI_DAILY_CALLS", 2)  # a count limit too, for calls without a cost
    assert client.post("/api/text/translate", json={"text": "你好"}, headers=A).status_code == 429


def test_tts_daily_clip_limit(client, voices, monkeypatch):
    monkeypatch.setattr(limits, "TTS_DAILY_CLIPS", 1)
    assert client.get("/api/tts", params={"text": "一"}, headers=A).status_code == 200
    assert client.get("/api/tts", params={"text": "二"}, headers=A).status_code == 429
    assert client.get("/api/tts", params={"text": "一"}, headers=A).status_code == 200  # a replay from the cache is free
    assert client.get("/api/tts", params={"text": "二"}, headers=B).status_code == 200


def test_tts_cache_keeps_the_clips_used_last(client, voices, monkeypatch):
    monkeypatch.setattr(tts, "TTS_CACHE_MB_PER_USER", 10000 / 1024 / 1024)  # room for two test clips
    for text in ("一", "二"):
        assert client.get("/api/tts", params={"text": text}, headers=A).status_code == 200
    first, second = sorted((voices / "user_a").glob("*.wav"), key=lambda p: p.stat().st_mtime)
    os.utime(first, (1000, 1000))
    os.utime(second, (2000, 2000))
    assert client.get("/api/tts", params={"text": "三"}, headers=A).status_code == 200
    left = set((voices / "user_a").glob("*.wav"))
    assert len(left) == 2 and first not in left and second in left
