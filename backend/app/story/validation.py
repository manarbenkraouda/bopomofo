"""Check model output and resolve fact references before a story can be saved."""

from __future__ import annotations

import json
import re

from .. import coach
from .catalog import CATALOG, MAX_BLOCKS, MAX_CARDS, MAX_CHARTS, MIN_CARDS, MOODS, PLACEHOLDER, SYM_RE, TONE_NAMES
from .facts import UNIT_WORD, bare


def check_text(s, n: int, facts: dict, where: str, errors: list[str], strict: bool) -> str | None:
    """Fill the {key} placeholders. A digit outside a placeholder or a tone name is an error: the model may not write numbers."""
    if not isinstance(s, str) or not s.strip():
        errors.append(f"{where}: empty text")
        return None
    s = " ".join(s.split())
    bad = [k for k in PLACEHOLDER.findall(s) if k not in facts or facts[k].get("series")]
    if bad:
        errors.append(f"{where}: unknown fact keys {bad}")
        return None
    if re.search(r"\d", TONE_NAMES.sub("", PLACEHOLDER.sub("", s))):
        errors.append(f"{where}: a digit written by hand; write numbers only as {{key}} placeholders")
        return None
    out = PLACEHOLDER.sub(lambda m: bare(facts[m.group(1)]), s)
    # A unit written twice ("266 answers answers", "86% percent") reads badly: keep one.
    for w in [x for x in UNIT_WORD.values() if x] + ["percent"]:
        prev = None
        while prev != out:
            prev, out = out, re.sub(rf"(\d[\d.,]*(?:%| {w}| {w[:-1]})) (?:{w}|{w[:-1]})\b", r"\1", out)
    out = re.sub(r"(\d+%) (?:percent|per cent)\b", r"\1", out)
    if len(out) > n:
        errors.append(f"{where}: {len(out)} characters, max {n}")
        if strict:
            return None
        out = out[: n - 1].rsplit(" ", 1)[0] + "…"
    return out


def _ref(v, facts: dict) -> str | None:
    if isinstance(v, dict) and isinstance(v.get("$fact"), str):
        return v["$fact"]
    if isinstance(v, str):
        m = PLACEHOLDER.fullmatch(v.strip())
        return m.group(1) if m else v.strip()
    return None


def check_prop(spec: tuple, v, facts: dict, where: str, errors: list[str], strict: bool):
    """Validate one prop against its schema and resolve references to saved facts."""
    k = spec[0]
    if k == "text":
        return check_text(v, spec[1], facts, where, errors, strict)
    if k in ("fact", "pct", "series"):
        key = _ref(v, facts)
        f = facts.get(key or "")
        if not f:
            errors.append(f'{where}: unknown fact {v!r}; numbers must be {{"$fact": key}} from the facts list')
            return None
        if (k == "series") != bool(f.get("series")) or (k == "pct" and f["unit"] != "%"):
            errors.append(
                f"{where}: fact {key} is not a {'series' if k == 'series' else '% fact' if k == 'pct' else 'number'}"
            )
            return None
        return dict(f)
    if k == "enum":
        if v in spec[1]:
            return v
        errors.append(f"{where}: {v!r} is not one of {spec[1]}")
        return None
    if k == "bool":
        return bool(v)
    if k == "glyph":
        if isinstance(v, str) and 1 <= len(v.strip()) <= 4 and not re.search(r"[A-Za-z0-9]", v):
            return v.strip()
        errors.append(f"{where}: glyph must be one emoji or one CJK character")
        return None
    if k == "syms":
        out = [x for x in (v or []) if isinstance(x, str) and SYM_RE.match(x)][: spec[1]] if isinstance(v, list) else []
        return out
    if k == "obj":
        if not isinstance(v, dict):
            errors.append(f"{where}: must be an object")
            return None
        return check_props(spec[1], v, facts, where, errors, strict)
    if k == "list":
        if not isinstance(v, list):
            errors.append(f"{where}: must be a list")
            return None
        items = []
        for i, x in enumerate(v[: spec[2]]):
            item = (
                check_prop(spec[3], x, facts, f"{where}[{i}]", errors, strict)
                if isinstance(spec[3], tuple)
                else (check_props(spec[3], x, facts, f"{where}[{i}]", errors, strict) if isinstance(x, dict) else None)
            )
            if item is not None:
                items.append(item)
        if len(v) > spec[2]:
            errors.append(f"{where}: at most {spec[2]} items")
        if len(items) < spec[1]:
            errors.append(f"{where}: needs at least {spec[1]} valid items")
            return None
        return items
    return None


def check_props(specs: dict, props: dict, facts: dict, where: str, errors: list[str], strict: bool) -> dict | None:
    """Validate a block's props; collect errors and reject missing required values."""
    out = {}
    for name, spec in specs.items():
        opt = name.endswith("?")
        key = name.rstrip("?")
        if key not in props or props[key] in (None, "", []):
            if not opt:
                errors.append(f"{where}.{key}: missing")
                return None
            continue
        v = check_prop(spec, props[key], facts, f"{where}.{key}", errors, strict)
        if v is None:
            if opt:
                continue
            return None
        out[key] = v
    return out


def clean_card(card, facts: dict, strict: bool = True) -> tuple[dict | None, list[str]]:
    """One card, checked against CATALOG, with the numbers filled in. strict: any problem rejects the card (the model retries);
    not strict: bad blocks are dropped and long texts are cut."""
    errors: list[str] = []
    if not isinstance(card, dict) or not isinstance(card.get("blocks"), list):
        return None, ['the card must be {"blocks": [...]}']
    blocks, charts = [], 0
    for i, b in enumerate(card["blocks"]):
        where = f"block {i}"
        t = b.get("type") if isinstance(b, dict) else None
        if t not in CATALOG:
            errors.append(f"{where}: unknown type {t!r}")
            continue
        if len(blocks) >= MAX_BLOCKS:
            errors.append(f"at most {MAX_BLOCKS} blocks")
            break
        if CATALOG[t].get("chart") and charts >= MAX_CHARTS:
            errors.append(f"{where}: at most {MAX_CHARTS} chart blocks per card")
            continue
        props = check_props(
            CATALOG[t]["props"],
            b.get("props") if isinstance(b.get("props"), dict) else {},
            facts,
            f"{where} ({t})",
            errors,
            strict,
        )
        if props is None:
            continue
        charts += bool(CATALOG[t].get("chart"))
        blocks.append({"type": t, "props": props})
    if strict and errors:
        return None, errors
    if not blocks:
        return None, errors or ["no valid block"]
    chars = sum(
        len(json.dumps(b["props"], ensure_ascii=False)) for b in blocks if b["type"] in ("headline", "text", "kicker")
    )
    seconds = coach.validate.integer(card.get("seconds"), 6, 10, max(6, min(10, round(5 + chars / 45 + charts * 1.5))))
    mood = card.get("mood") if card.get("mood") in MOODS else "warm"
    return {
        "id": coach.validate.text(card.get("id"), 20) or "c",
        "mood": mood,
        "seconds": seconds,
        "blocks": blocks,
    }, errors


def _has_cta(c: dict) -> bool:
    return any(b["type"] == "cta" for b in c["blocks"])


def finish(cards: list[dict], fallback: list[dict]) -> list[dict]:
    """5 to 9 cards (fixed cards fill a short story); only the last card has the button."""
    cards = [c for c in cards if c][:MAX_CARDS]
    extra = [c for c in fallback if not _has_cta(c)]
    while len(cards) < MIN_CARDS and extra:
        cards.insert(len(cards) - 1 if cards and _has_cta(cards[-1]) else len(cards), extra.pop(0))
    for c in cards[:-1]:
        c["blocks"] = [b for b in c["blocks"] if b["type"] != "cta"] or c["blocks"]
    cta = {"type": "cta", "props": {"label": "Start the first step", "action": "start"}}
    if cards and not _has_cta(cards[-1]):
        if len(cards[-1]["blocks"]) < MAX_BLOCKS:
            cards[-1]["blocks"].append(cta)
        else:
            cards.append(
                {
                    "id": "go",
                    "mood": "win",
                    "seconds": 6,
                    "blocks": [{"type": "headline", "props": {"text": "Ready when you are."}}, cta],
                }
            )
    for i, c in enumerate(cards):
        c["id"] = f"c{i + 1}"
    return cards[: MAX_CARDS + 1]


def check_headline(h, gate: bool) -> tuple[str | None, list[str]]:
    """Reject headlines that break the length, number, tone-name, or alphabet rules."""
    errors = []
    if not isinstance(h, str) or not h.strip():
        return None, ["empty headline"]
    h = " ".join(h.split())
    if len(h) > 220:
        errors.append(f"{len(h)} characters, max 220")
    if len(re.findall(r"[.!?](?:\s|$)", h.replace("...", "…"))) > 2:
        errors.append("more than 2 sentences")
    if re.search(r"\d|%", TONE_NAMES.sub("", h)):
        errors.append("it has a number: write no numbers and no stats")
    if gate and not re.search(f"alphabet|symbol|bopomofo|zhuyin|letter|[{coach.settings.SYMS}]", h, re.I):
        errors.append(
            "the learner does not know the alphabet yet: the headline must be about the symbols or the alphabet"
        )
    return (None if errors else h), errors
