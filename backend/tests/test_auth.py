"""The API needs a Clerk sign-in, and each signed-in user reaches only their own data. Token checks are replaced by a fake."""
import pytest
from fastapi.testclient import TestClient

from app import auth, main

A = {"Authorization": "Bearer token-a"}
B = {"Authorization": "Bearer token-b"}


@pytest.fixture()
def client(pg, monkeypatch):
    async def fake_user_id(request):
        return {"Bearer token-a": "user_a", "Bearer token-b": "user_b"}.get(request.headers.get("authorization"))
    monkeypatch.setattr(auth, "CLERK_SECRET_KEY", "sk_test_fake")
    monkeypatch.setattr(auth, "user_id", fake_user_id)
    return TestClient(main.app)  # not a context manager: the speech model is not loaded


def test_sign_in_is_required(client):
    assert client.get("/api/profile").status_code == 401
    assert client.get("/api/stats").status_code == 401
    assert client.get("/api/profile", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/api/health").status_code == 200 and client.get("/api/health").json()["speaker_hz"] is None
    assert client.get("/api/tts/voices").status_code == 200


def test_each_user_reaches_only_their_data(client):
    assert client.put("/api/profile", json={"name": "Ana"}, headers=A).json() == {"name": "Ana"}
    assert client.get("/api/profile", headers=B).json() == {}
    ev = {"area": "listening", "mode": "tone", "item": "ㄇㄚˇ", "ok": True, "units": [{"kind": "tone", "expected": "3", "ok": True}]}
    assert client.post("/api/progress/event", json=ev, headers=A).json()["ok"]
    assert client.get("/api/progress/summary", headers=A).json()["attempts"] == 1
    assert client.get("/api/progress/summary", headers=B).json()["attempts"] == 0
    assert "ㄇㄚˇ" in client.get("/api/stats/export.csv", headers=A).text
    assert "ㄇㄚˇ" not in client.get("/api/stats/export.csv", headers=B).text


def test_no_secret_key_means_no_access(client, monkeypatch):
    monkeypatch.setattr(auth, "CLERK_SECRET_KEY", "")
    assert client.get("/api/profile", headers=A).status_code == 503
    assert client.get("/api/health").status_code == 200
