"""Build a fixed headline and story from the same facts when the model is unavailable."""

from __future__ import annotations

from .facts import TONE
from .validation import clean_card


def template_headline(gate: bool) -> str:
    """Return the fixed headline for alphabet study or later practice."""
    if gate:
        return (
            "Your ears already get along with the tones; your eyes are still being introduced to the Bopomofo symbols. "
            "This plan makes the introductions, a few symbols at a time."
        )
    return "You are making real progress, and a few sounds still like to play tricks on you. This plan goes after the trickiest ones first."


def rules_cards(facts: dict, ctx: dict, gate: bool) -> list[dict]:
    """Build fallback story cards from the same saved facts as the model story."""
    F = facts
    raw: list[dict] = []
    if "practice.minutes.7d" in F:
        raw.append(
            {
                "mood": "warm",
                "blocks": [
                    {"type": "kicker", "props": {"text": "Your week"}},
                    {
                        "type": "big_number",
                        "props": {"value": {"$fact": "practice.minutes.7d"}, "label": "minutes of practice"},
                    },
                    {"type": "calendar", "props": {}},
                    {"type": "text", "props": {"text": "Every minute is saved, down to each tone you hear and say."}},
                ],
            }
        )
    if "tone.listen.all.pct" in F:
        raw.append(
            {
                "mood": "bright",
                "blocks": [
                    {"type": "kicker", "props": {"text": "Your strong side"}},
                    {"type": "headline", "props": {"text": "Your ears are on it."}},
                    {
                        "type": "ring",
                        "props": {"value": {"$fact": "tone.listen.all.pct"}, "label": "tones right by ear"},
                    },
                ],
            }
        )
    spoken = [t for t in "12345" if f"tone.speak.{t}.pct" in F]
    if len(spoken) >= 2:
        worst = min(spoken, key=lambda t: F[f"tone.speak.{t}.pct"]["value"])
        raw.append(
            {
                "mood": "deep",
                "blocks": [
                    {"type": "kicker", "props": {"text": "When you speak"}},
                    {"type": "headline", "props": {"text": "Some tones need more love."}},
                    {
                        "type": "bars",
                        "props": {
                            "items": [
                                {
                                    "label": TONE[t].replace("the ", ""),
                                    "value": {"$fact": f"tone.speak.{t}.pct"},
                                    "highlight": t == worst,
                                }
                                for t in spoken
                            ]
                        },
                    },
                ],
            }
        )
    mix = sorted((f for k, f in F.items() if k.startswith("mix.")), key=lambda f: -f["value"])[:3]
    if mix:
        pairs = []
        for f in mix:
            body = f["key"].split(".", 3)[3]
            a, b = body.split(">")
            pairs.append(
                {
                    "from": TONE.get(a, a).replace("the ", ""),
                    "to": TONE.get(b, b).replace("the ", ""),
                    "count": {"$fact": f["key"]},
                }
            )
        raw.append(
            {
                "mood": "calm",
                "blocks": [
                    {"type": "kicker", "props": {"text": "Mix-ups"}},
                    {"type": "headline", "props": {"text": "What you give instead"}},
                    {"type": "confusion", "props": {"pairs": pairs}},
                ],
            }
        )
    if "alphabet.known" in F:
        raw.append(
            {
                "mood": "warm",
                "blocks": [
                    {"type": "kicker", "props": {"text": "The alphabet"}},
                    {"type": "headline", "props": {"text": "Your eyes are next." if gate else "Your symbols"}},
                    {"type": "symbol_grid", "props": {"highlight": ctx["alphabet"]["next"]}},
                    {
                        "type": "text",
                        "props": {
                            "text": "You know {alphabet.known} of {alphabet.total}. Repetition first, tests later."
                        },
                    },
                ],
            }
        )
    raw.append(
        {
            "mood": "win",
            "blocks": [
                {"type": "kicker", "props": {"text": "Today"}},
                {"type": "headline", "props": {"text": "Small steps, in the right order."}},
                {"type": "steps", "props": {}},
                {"type": "cta", "props": {"label": "Start the first step", "action": "start"}},
            ],
        }
    )
    return [c for c in (clean_card(x, F, strict=False)[0] for x in raw) if c]
