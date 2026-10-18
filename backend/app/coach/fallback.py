"""The plan built by rules from the weak spots, when the model pipeline fails."""

from __future__ import annotations

from collections import defaultdict

from .. import levels
from ..numbers import BANDS
from ..zhuyin import RULES


def rules_plan(d: dict) -> dict:
    """A plan without the model: the weak spots, mapped to step types."""
    steps: list[dict] = []
    grouped: dict[str, list] = defaultdict(list)
    for s in d["_skills"]:
        if (s["right_pct"] or 0) >= 90:
            continue
        other = [k for k in s["produced_instead"] if k not in ("?", "∅")]
        a, u, x = s["area"], s["unit"], s["x"]
        why = f"Right {s['right_pct']:.0f}% of the time so far, so a little more practice here pays off."
        if a == "listening" and u == "tone" and x != "5":
            steps.append(
                {
                    "type": "listen_tones",
                    "title": f"Hear tone {x}" + (f" vs tone {other[0]}" if other else ""),
                    "why": why,
                    "tones": [x, *other[:1]],
                    "target": 15,
                }
            )
        elif a == "speaking" and u == "tone" and x == "5":
            steps.append(
                {
                    "type": "speak_sounds",
                    "unit": "tone",
                    "tones": [5],
                    "source": "sentence",
                    "title": "Say the neutral tone in short words",
                    "why": why,
                    "target": 10,
                }
            )
        elif a == "speaking" and u == "tone":
            steps.append(
                {
                    "type": "speak_sounds",
                    "unit": "tone",
                    "tones": [x],
                    "source": "syllable",
                    "title": f"Say tone {x} on single syllables",
                    "why": why,
                    "target": 10,
                }
            )
        elif a == "speaking" and u in ("initial", "final"):
            steps.append(
                {
                    "type": "speak_sounds",
                    "unit": u,
                    "syms": [x, *other[:1]],
                    "source": "syllable",
                    "title": f"Say {x}" + (f" vs {other[0]}" if other else ""),
                    "why": why,
                    "target": 10,
                }
            )
        elif a == "listening" and u in ("initial", "final"):
            steps.append(
                {
                    "type": "listen_sounds",
                    "syms": [x, *other[:1]],
                    "title": f"Hear {x}" + (f" vs {other[0]}" if other else ""),
                    "why": why,
                    "target": 12,
                }
            )
        elif u == "sandhi" and x in RULES:
            steps.append(
                {
                    "type": "tone_rules",
                    "rules": [x],
                    "mode": "speak" if a == "speaking" else "quiz",
                    "title": f"Practice the {RULES[x]['name']}",
                    "why": RULES[x]["short"],
                    "target": 10,
                }
            )
        elif u == "symbol" and a in ("reading", "recognize", "dictation"):
            grouped[a].append(x)
        if len(steps) >= 4:
            break
    verb = {
        "reading": ("read_symbols", "Read "),
        "recognize": ("recognize_symbols", "Recognize "),
        "dictation": ("write_symbols", "Write "),
    }
    # Numbers: the weakest size band of each mode, from the numbers slice of the digest.
    for b in sorted((d.get("numbers") or {}).get("by_size") or [], key=lambda x: x["acc"] or 0):
        if len(steps) >= 5 or b["n"] < 5 or (b["acc"] or 0) >= 85 or b["band"] not in BANDS:
            continue
        mode = "speak" if b["mode"] == "speak" else "listen"
        if any(s["type"] == "numbers" and s["mode"] == mode for s in steps):
            continue
        steps.append(
            {
                "type": "numbers",
                "mode": mode,
                "bands": [b["band"]],
                "title": ("Say" if mode == "speak" else "Hear") + f" numbers {b['band']}",
                "why": f"Right {b['acc']:.0f}% of the time so far in this size of number.",
                "target": 12,
            }
        )
    for a, syms in grouped.items():
        steps.append(
            {
                "type": verb[a][0],
                "syms": syms[:4],
                "title": verb[a][1] + " ".join(syms[:4]),
                "why": "The symbols that still trip you up most.",
                "target": 8,
            }
        )
    weak = [s for s in d["sentences"]["weak"] if s["id"]][:4]
    if weak:
        steps.append(
            {
                "type": "speak_sentences",
                "sentence_ids": [s["id"] for s in weak],
                "reps": 2,
                "min_score": 85,
                "title": "Repeat your weakest sentences",
                "why": "These sentences are close: a few more tries make them smooth.",
            }
        )
    # Only the exercises the level has unlocked. Without weak spots: a first look at each open exercise.
    op = d.get("_open") or levels.opened()
    steps = [s for s in steps if levels.step_allowed(s["type"], s, op)]
    if not steps:
        first = list(op["symbols"][:6])
        steps = [
            {
                "type": "listen_tones",
                "tones": [1, 2, 3, 4],
                "target": 20,
                "title": "Tone check: all four tones",
                "why": "A first look at how you hear the tones.",
            },
            {
                "type": "read_symbols",
                "syms": first,
                "target": 8,
                "title": "Read the first symbols",
                "why": "A first look at the symbols.",
            },
            {
                "type": "recognize_symbols",
                "syms": first,
                "target": 8,
                "title": "Type the first symbols",
                "why": "A first try at naming them silently.",
            },
            {
                "type": "write_symbols",
                "syms": first,
                "target": 8,
                "title": "Write the first symbols",
                "why": "A first try at writing them.",
            },
            {
                "type": "speak_sounds",
                "unit": "tone",
                "tones": [1, 2, 3, 4],
                "source": "syllable",
                "target": 10,
                "title": "Say single syllables",
                "why": "A first look at how you say the tones.",
            },
        ]
        steps = [s for s in steps if levels.step_allowed(s["type"], s, op)]
    return {
        "diagnosis": "Built by rules from your weak spots, because Bobo's planner was not available.",
        "steps": steps[:6],
        "milestones": None,
    }
