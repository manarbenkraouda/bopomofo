"""The learner's card order settings: saved with the other settings, checked, and pulled into range."""

from app import learner

H = {"Authorization": "Bearer token-a"}


def test_clean_review_keeps_known_keys_in_range():
    raw = {
        "all": {"newAtOnce": 500, "repeatSpacing": -3, "passScore": 72.34, "bad": 1, "helpCounts": True},
        "exercises": {"speaking": {"passScore": 95}, "reading": {"bad": 2}, "nope": {"newAtOnce": 3}},
    }
    assert learner.clean_review(raw) == {
        "all": {"newAtOnce": 100, "repeatSpacing": 0, "passScore": 72.3},
        "exercises": {"speaking": {"passScore": 95}},
    }
    assert learner.clean_review(None) == {"all": {}, "exercises": {}}
    assert learner.clean_review({"all": "x", "exercises": [1]}) == {"all": {}, "exercises": {}}


def test_review_settings_are_saved_and_returned(client):
    assert client.get("/api/me", headers=H).json()["review"] == {"all": {}, "exercises": {}}
    body = {"review": {"all": {"newAtOnce": 0, "skipGap": 51}, "exercises": {"writing": {"rightToLearn": 20}}}}
    me = client.put("/api/settings", json=body, headers=H).json()
    assert me["review"] == {"all": {"newAtOnce": 0, "skipGap": 51}, "exercises": {"writing": {"rightToLearn": 20}}}
    # Another setting does not erase the card order settings.
    client.put("/api/settings", json={"goal_min": 30}, headers=H)
    assert client.get("/api/me", headers=H).json()["review"]["all"] == {"newAtOnce": 0, "skipGap": 51}
    # Each learner has their own.
    assert client.get("/api/me", headers={"Authorization": "Bearer token-b"}).json()["review"]["all"] == {}
