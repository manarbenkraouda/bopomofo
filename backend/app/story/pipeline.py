"""Generate, validate, and save a story, with a fixed fallback on model failure."""

from __future__ import annotations

import asyncio
import json

from .. import coach, db
from .catalog import MAX_CARDS, MOODS, catalog_text
from .facts import fmt, story_context, story_facts
from .fallback import rules_cards, template_headline
from .prompts import CARD, HEADLINE, HEADLINE_ALPHABET, OUTLINE, STORY_COMMON
from .validation import check_headline, clean_card, finish


def _fact_lines(facts: dict) -> list[str]:
    out = []
    for f in facts.values():
        if f.get("series"):
            out.append(f"{f['key']}: {f['label']} (series of {len(f['values'])} values)")
        else:
            note = " [needs the alphabet]" if f.get("needs_alphabet") else ""
            out.append(f"{f['key']}: {f['label']} = {fmt(f)}{note}")
    return out


async def _model_story(
    ask, facts: dict, ctx: dict, gate: bool, brief: dict
) -> tuple[str | None, list[dict], list[str]]:
    lines = _fact_lines(facts)
    cat = catalog_text()
    errors: list[str] = []

    async def headline():
        payload = {
            "alphabet_rule_active": gate,
            "plan_steps": [s["title"] for s in ctx["steps"]],
            "facts": lines,
            **brief,
        }
        task = HEADLINE + (HEADLINE_ALPHABET if gate else "")
        for attempt in range(2):
            r = await ask(f"headline#{attempt + 1}", task, payload)
            h, problems = check_headline(r.get("headline"), gate)
            if h:
                return h
            payload = {**payload, "your_last_headline": r.get("headline"), "problems": problems}
        return None

    async def outline():
        r = await ask(
            "story:outline",
            OUTLINE.replace("CATALOG", cat),
            {"facts": lines, "plan_steps": ctx["steps"], "alphabet_rule_active": gate, **brief},
        )
        cards = [c for c in r.get("cards") or [] if isinstance(c, dict)][:MAX_CARDS]
        if len(cards) < 3:
            raise ValueError("the outline had fewer than 3 cards")
        return cards

    async def card(i, oc, outline_cards):
        payload = {
            "card": oc,
            "position": f"card {i + 1} of {len(outline_cards)}",
            "is_last": i == len(outline_cards) - 1,
            "outline": [c.get("topic") for c in outline_cards],
            "facts": lines,
            "plan_steps": ctx["steps"],
            "alphabet": ctx["alphabet"] if gate else None,
        }
        last = None
        for attempt in range(2):
            r = await ask(f"story:card{i + 1}#{attempt + 1}", CARD.replace("CATALOG", cat), payload)
            last = r.get("card") if isinstance(r.get("card"), dict) else r
            c, problems = clean_card(last, facts, strict=True)
            if c:
                c["mood"] = (
                    c["mood"]
                    if last.get("mood") in MOODS
                    else (oc.get("mood") if oc.get("mood") in MOODS else c["mood"])
                )
                return c
            payload = {**payload, "your_last_card": last, "problems": problems}
        c, problems = clean_card(last, facts, strict=False)
        errors.extend(f"card {i + 1}: {p}" for p in problems[:3])
        return c

    h_task = asyncio.ensure_future(headline())
    try:
        oc = await outline()
        cards = list(await asyncio.gather(*(card(i, c, oc) for i, c in enumerate(oc))))
    except Exception as e:  # noqa: BLE001
        errors.append(f"story: {type(e).__name__}: {e}"[:300])
        cards = []
    try:
        h = await h_task
    except Exception as e:  # noqa: BLE001
        errors.append(f"headline: {type(e).__name__}: {e}"[:300])
        h = None
    return h, [c for c in cards if c], errors


def make(d: dict, steps: list[dict], milestones: list[dict], pace: dict | None, findings: list[dict], ask=None) -> dict:
    """The headline and the story for one plan. ask(stage, task, payload) -> dict is one model call (async); None = no model."""
    facts = story_facts(d, steps, milestones, pace)
    ctx = story_context(d, steps)
    gate = bool(((d.get("overview") or {}).get("alphabet") or {}).get("rule_active"))
    fallback = rules_cards(facts, ctx, gate)
    headline, cards, errors, source = None, [], [], "rules"
    if ask:
        brief = {"top_findings": [f.get("problem") for f in findings[:6]], "pace_notes": (pace or {}).get("notes")}
        try:
            headline, cards, errors = asyncio.run(_model_story(ask, facts, ctx, gate, brief))
        except Exception as e:  # noqa: BLE001
            errors.append(f"{type(e).__name__}: {e}"[:300])
        if len(cards) >= 3:
            source = "llm"
    spec = {"v": 1, "source": source, "cards": finish(cards if source == "llm" else fallback, fallback), "context": ctx}
    return {
        "headline": headline or template_headline(gate),
        "headline_source": "llm" if headline else "rules",
        "story": spec,
        "errors": errors,
    }


def write(pid: int, run: str | None = None, live: bool | None = None) -> dict:
    """Build and save the headline and story of a saved plan, from its saved digest, steps, and milestones."""
    import uuid

    plan = coach.store.plan(pid)
    if not plan:
        raise ValueError(f"no plan {pid}")
    d = json.loads(plan["digest"] or "{}")
    if not d.get("story"):  # plans saved before the story existed: these numbers are read now
        d["story"] = coach.planner.story_stats_now()
    raw = json.loads(plan["raw"] or "{}")
    steps = coach.store.steps(pid)
    ms = coach.planner.state_milestones()
    run = run or uuid.uuid4().hex[:12]
    use_model = coach.settings.LIVE if live is None else live

    async def ask(stage, task, payload):
        return await coach.model.call(stage, task, payload, run, plan_id=pid, common=STORY_COMMON)

    out = make(d, steps, ms, raw.get("pace"), raw.get("findings") or [], ask if use_model else None)
    with db.conn() as c:
        c.execute(
            "UPDATE plans SET headline=?, story=? WHERE id=?",
            (out["headline"], json.dumps(out["story"], ensure_ascii=False), pid),
        )
        c.execute("UPDATE coach_calls SET plan_id=? WHERE run=?", (pid, run))
    return out


def get(pid: int) -> dict | None:
    """Read a saved story visible to this learner, or return None when it is absent."""
    plan = coach.store.plan(pid)
    if not plan or not plan.get("story"):
        return None
    spec = json.loads(plan["story"])
    return {**spec, "plan_id": pid, "headline": plan.get("headline")}
