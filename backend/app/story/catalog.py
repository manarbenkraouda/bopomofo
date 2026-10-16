"""The allowed story blocks, their prop schemas, and the shared validation limits."""

from __future__ import annotations

import re

from .. import coach

CATALOG: dict[str, dict] = {
    "kicker": {"desc": "a small uppercase label above the card text", "props": {"text": ("text", 30)}},
    "headline": {"desc": "a large title, the main line of the card", "props": {"text": ("text", 70)}},
    "text": {"desc": "one short sentence", "props": {"text": ("text", 140)}},
    "big_number": {
        "desc": "one number that counts up, with a label",
        "chart": True,
        "props": {"value": ("fact",), "label": ("text", 40)},
    },
    "ring": {
        "desc": "a percentage as a ring that fills",
        "chart": True,
        "props": {"value": ("pct",), "label": ("text", 40)},
    },
    "bars": {
        "desc": "2 to 6 bars that grow, for example the tones side by side; highlight the one that matters",
        "chart": True,
        "props": {"items": ("list", 2, 6, {"label": ("text", 18), "value": ("fact",), "highlight?": ("bool",)})},
    },
    "versus": {
        "desc": "two numbers face to face, for example ear against mouth",
        "chart": True,
        "props": {
            "left": ("obj", {"label": ("text", 24), "value": ("fact",)}),
            "right": ("obj", {"label": ("text", 24), "value": ("fact",)}),
        },
    },
    "symbol_grid": {
        "desc": "the 37 Bopomofo symbols, colored known / learning / new, with a ring on the highlighted ones",
        "chart": True,
        "props": {"highlight?": ("syms", 8)},
    },
    "confusion": {
        "desc": "arrows from what was expected to what you gave instead, with how many times",
        "chart": True,
        "props": {"pairs": ("list", 1, 4, {"from": ("text", 16), "to": ("text", 16), "count": ("fact",)})},
    },
    "calendar": {
        "desc": "the last 28 days, one square per day, brighter with more practice",
        "chart": True,
        "props": {},
    },
    "sparkline": {
        "desc": "a line that draws itself, from a series fact",
        "chart": True,
        "props": {"series": ("series",), "label": ("text", 40)},
    },
    "chips": {
        "desc": "up to 8 small tags, for example the next symbols or tones",
        "props": {"items": ("list", 1, 8, ("text", 20))},
    },
    "steps": {"desc": "the steps of this plan, appearing one by one", "chart": True, "props": {}},
    "sticker": {
        "desc": "one big emoji or CJK character that pops in, with a short caption",
        "props": {"glyph": ("glyph",), "text?": ("text", 40)},
    },
    "cta": {
        "desc": "the final button: start the first step, or close the story",
        "props": {"label": ("text", 30), "action": ("enum", ["start", "close"])},
    },
}


MOODS = ["warm", "calm", "bright", "deep", "win"]


MAX_CARDS, MIN_CARDS, MAX_BLOCKS, MAX_CHARTS = 9, 5, 4, 2


TONE_NAMES = re.compile(r"\b(?:[Tt]ones?)\s+[1-5](?:\s*(?:,|and|or|&|/|vs\.?|versus)\s*(?:tone\s+)?[1-5])*\b")


PLACEHOLDER = re.compile(r"\{([^{}\s]{1,60})\}")


SYM_RE = re.compile(f"^[{coach.settings.SYMS}]$")


def catalog_text() -> str:
    """Describe the allowed blocks and their props for the model prompt."""

    def spec(p):
        k = p[0]
        if k == "text":
            return f"text (max {p[1]} characters)"
        if k == "list":
            inner = (
                spec(p[3])
                if isinstance(p[3], tuple)
                else "{" + ", ".join(f'"{n}": {spec(v)}' for n, v in p[3].items()) + "}"
            )
            return f"list of {p[1]} to {p[2]} × {inner}"
        if k == "obj":
            return "{" + ", ".join(f'"{n}": {spec(v)}' for n, v in p[1].items()) + "}"
        return {
            "fact": '{"$fact":"key"}',
            "pct": '{"$fact":"key of a % fact"}',
            "series": '{"$fact":"key of a series fact"}',
            "enum": " | ".join(f'"{x}"' for x in p[1]) if k == "enum" else "",
            "syms": f"list of up to {p[1] if k == 'syms' else 0} single Bopomofo symbols",
            "glyph": "one emoji or one CJK character",
            "bool": "true | false",
        }[k]

    return "\n".join(
        f"- {t}{' [chart]' if c.get('chart') else ''}: {c['desc']}. props: "
        + ("{" + ", ".join(f'"{n}": {spec(v)}' for n, v in c["props"].items()) + "}" if c["props"] else "none")
        for t, c in CATALOG.items()
    )
