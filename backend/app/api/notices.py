"""The coach refresh that follows every saved answer."""

from __future__ import annotations

from .. import coach


def refresh_notices() -> list[dict]:
    """Refresh the coach after a saved answer, and return the new level notices (an unlock, a known item that dropped),
    so the app can show them with the answer."""
    r = coach.refresh()
    return (r.get("levels") or {}).get("notices") or []
