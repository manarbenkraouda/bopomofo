"""The speaking demo of the front page: public, limited to its phrases, and nothing kept from the check."""

import io

import numpy as np
import pytest
import soundfile as sf
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import asr, auth, main, scoring
from app.api import demo


def wav(seconds: float) -> bytes:
    t = np.arange(int(16000 * seconds)) / 16000
    buf = io.BytesIO()
    sf.write(buf, (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), 16000, format="WAV")
    return buf.getvalue()


@pytest.fixture()
def visitor(monkeypatch):
    """A client with sign-in configured and no token, and a loaded speech model that returns a fixed result."""
    monkeypatch.setattr(auth, "CLERK_SECRET_KEY", "sk_test_fake")
    monkeypatch.setattr(asr.Recognizer, "ready", property(lambda self: True))
    seen = []

    def fake_analyze(audio, text, speaker_ref=None):
        seen.append((text, speaker_ref))
        return {"text": text, "score": 100, "syllables": [], "speaker_hz": 180.0, "_lp": [0.1], "_has_ref": True}

    monkeypatch.setattr(scoring, "analyze", fake_analyze)
    demo.reset()
    yield TestClient(main.app), seen
    demo.reset()


def post(client, text, seconds=1.0):
    return client.post("/api/demo/speech", data={"text": text}, files={"audio": ("a.wav", wav(seconds), "audio/wav")})


def test_a_visitor_without_an_account_gets_the_check_and_nothing_private(visitor):
    client, seen = visitor
    r = post(client, "你好")
    assert r.status_code == 200
    assert r.json() == {"text": "你好", "score": 100, "syllables": []}
    # No learner voice pitch is used for a visitor.
    assert seen == [("你好", None)]


def test_only_the_demo_phrases_and_short_recordings(visitor):
    client, seen = visitor
    assert post(client, "我愛你").status_code == 400
    assert post(client, "謝謝", seconds=demo.MAX_SECONDS + 1).status_code == 400
    assert seen == []


def test_each_address_has_an_hourly_limit():
    demo.reset()
    for _ in range(demo.PER_ADDRESS):
        demo.admit("1.2.3.4", now=1000.0)
    with pytest.raises(HTTPException) as e:
        demo.admit("1.2.3.4", now=1001.0)
    assert e.value.status_code == 429
    demo.admit("5.6.7.8", now=1001.0)
    demo.admit("1.2.3.4", now=1000.0 + demo.HOUR + 1)
    demo.reset()
