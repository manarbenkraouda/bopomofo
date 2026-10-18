"""The model pipeline: analysts, planner, writers and deck pickers, reviewer, and milestones."""

from __future__ import annotations

import asyncio

from .. import db, levels, llm
from . import jobs, settings, validate
from .cleaning import clean_milestone, clean_step, focus_of
from .decks import candidates, deck_problems, focus_check, syllable_history
from .gates import needs_alphabet
from .model import call
from .progress import milestone_progress
from .prompts import (
    ALPHABET_MILESTONE_RULE,
    ALPHABET_RULE,
    ANALYZE,
    DECK,
    DOMAINS,
    MILESTONES,
    PACE,
    PLAN,
    REVIEW,
    SENTENCES,
    TONE_RULES_RULE,
    level_rule,
)
from .settings import DECK_TYPES, PLAN_MINUTES


async def write_sentences(step: dict, d: dict, profile: str, run: str):
    """Ask the writer for new sentences on the step focus, then save them in the step params. focus_check rejects a sentence that misses the focus; the writer gets the reasons back, for at most 3 attempts."""
    p = step["params"]
    need, focus = p["new"]["count"], p["new"]["focus"]
    accepted: list[dict] = []
    rejected: list[dict] = []
    s = d["sentences"]
    for attempt in range(3):
        payload = {
            "count": need - len(accepted),
            "focus": focus,
            "step": {"title": step["title"], "why": step["why"]},
            "typical_good_length": s["typical_good_length"],
            "good_sentences": s["good_count"],
            "weak_sentences": [{"text": x["text"], "avg_score": x["avg_score"]} for x in s["weak"][:5]],
            "do_not_repeat": p["texts"] + [a["hanzi"] for a in accepted],
            "rejected_before": rejected[-8:],
            "profile": profile,
        }
        r = await call(f"sentences#{attempt + 1}", SENTENCES, payload, run)
        for x in r.get("sentences") or []:
            c = llm._clean(x) if isinstance(x, dict) else None
            if not c:
                rejected.append(
                    {
                        "hanzi": validate.text(x.get("hanzi") if isinstance(x, dict) else x, 40),
                        "problems": ["not usable Traditional Chinese text"],
                    }
                )
                continue
            if c["hanzi"] in p["texts"] or any(a["hanzi"] == c["hanzi"] for a in accepted):
                continue
            problems = focus_check(c["hanzi"], focus)
            if problems:
                rejected.append({"hanzi": c["hanzi"], "problems": problems})
            elif len(accepted) < need:
                accepted.append(c)
        if len(accepted) >= need:
            break
    for c in accepted:
        row = db.add_sentence(c, "coach", "coach")
        p["ids"].append(row["id"])
        p["texts"].append(row["hanzi"])
    p["focus"] = focus
    p["written"], p["rejected"] = len(accepted), len(rejected)
    del p["new"]
    if accepted and settings.LIVE:
        from .. import tts  # the audio is made in the background, so Listen plays at once

        db.spawn(
            tts.pregenerate, [(c["hanzi"], r) for c in accepted for r in (0, -35)], tts.DEFAULT_VOICE, db.current_user()
        )


async def pick_deck(step: dict, findings: list[dict], hist: dict, run: str):
    """Ask the picker for the exact syllables of a drill deck, from at least 6 candidates. deck_problems rejects a bad deck; the picker gets the problems back, for at most 3 attempts."""
    cands = candidates(step, hist)
    if len(cands) < 6:
        return
    ids = set(step["meta"]["finding_ids"])
    payload = {
        "step": {"type": step["type"], "title": step["title"], "why": step["why"], "focus": focus_of(step)},
        "findings": [f for f in findings if f["id"] in ids] or findings[:4],
        "candidates": cands,
    }
    allowed = {c["z"] for c in cands}
    for attempt in range(3):
        r = await call(f"deck#{attempt + 1}", DECK, payload, run)
        deck = [z for z in dict.fromkeys(str(x).strip() for x in r.get("deck") or []) if z in allowed][:30]
        problems = deck_problems(step, deck, cands) + (
            [f"{len(deck)} valid syllables; pick 12 to 30 candidates"] if len(deck) < 12 else []
        )
        if len(deck) >= 6 and (not problems or attempt == 2):
            step["params"]["deck"] = deck
            step["params"]["deck_why"] = validate.text(r.get("why"), 300)
            return
        payload = {**payload, "your_last_deck": deck, "problems": problems}


def milestone_menu(d: dict) -> list[dict]:
    """The milestones the model can choose from: the weakest skills, with their accuracy over 30 and 60 days."""
    menu = []
    for r in d["_skills"][:30]:
        if r["area"] == "numbers":
            continue
        c = {"area": r["area"], "unit": r["unit"], "expected": [r["x"]], "min_acc": 90, "window": 30}
        a, b = milestone_progress(c), milestone_progress({**c, "window": 60})
        menu.append(
            {
                "area": r["area"],
                "unit": r["unit"],
                "expected": [r["x"]],
                "last_30_pct": a["value"],
                "last_60_pct": b["value"],
                "answers": b["n"],
            }
        )
    c = {"area": "speaking", "unit": "score", "expected": [], "min_acc": 90, "window": 20}
    menu.append(
        {
            "area": "speaking",
            "unit": "score",
            "expected": [],
            "last_20_avg": milestone_progress(c)["value"],
            "last_50_avg": milestone_progress({**c, "window": 50})["value"],
        }
    )
    # Numbers: one entry for every number, and one per size the learner has practiced.
    sizes = sorted({b["band"] for b in (d.get("numbers") or {}).get("by_size") or []})
    for exp in ([], *([s] for s in sizes)):
        c = {"area": "numbers", "unit": "number", "expected": exp, "min_acc": 90, "window": 30}
        a, b = milestone_progress(c), milestone_progress({**c, "window": 60})
        if b["n"]:
            menu.append(
                {
                    "area": "numbers",
                    "unit": "number",
                    "expected": exp,
                    "last_30_pct": a["value"],
                    "last_60_pct": b["value"],
                    "answers": b["n"],
                }
            )
    return menu


async def milestones_call(d: dict, findings: list[dict], run: str) -> dict:
    """Ask the model which active milestones to keep and which new ones to set. A new milestone that is already reached, gated, or not open yet is dropped."""
    active = d["milestones"]
    gate = d["overview"]["alphabet"]["rule_active"]
    op = d["_open"]
    menu = [m for m in milestone_menu(d) if not (gate and needs_alphabet(m)) and levels.milestone_allowed(m, op)]
    r = await call(
        "milestones",
        MILESTONES + (ALPHABET_MILESTONE_RULE if gate else "") + level_rule(op, "milestones"),
        {"overview": d["overview"], "findings": findings[:15], "active": active, "menu": menu},
        run,
    )
    keep = {validate.integer(x, 0, 10**9, 0) for x in r.get("keep") or []} & {m["id"] for m in active}
    new: list[dict] = []
    for m in r.get("new") or []:
        cm = clean_milestone(m) if isinstance(m, dict) else None
        if cm and gate and needs_alphabet(cm["criterion"]):
            continue
        if cm and not levels.milestone_allowed(cm["criterion"], op):
            continue
        if (
            cm
            and not milestone_progress(cm["criterion"])["reached"]
            and cm["criterion"] not in [x["criterion"] for x in new]
        ):
            new.append(cm)
    return {"keep": sorted(keep), "new": new[:5]}


def apply_review(steps: list[dict], r: dict, diagnosis: str) -> tuple[list[dict], str]:
    """Apply the reviewer's verdicts: keep, drop, or change each step. Returns the steps and the diagnosis."""
    verdicts = {}
    for v in r.get("verdicts") or []:
        if isinstance(v, dict) and str(v.get("pos", "")).strip().isdigit():
            verdicts[int(v["pos"])] = v
    drop = set()
    for i, s in enumerate(steps):
        v = verdicts.get(i) or {}
        s["meta"]["review"] = validate.text(v.get("reason"), 300)
        if v.get("action") == "drop":
            drop.add(i)
        elif v.get("action") == "change":
            if v.get("title"):
                s["title"] = validate.text(v["title"], 80)
            if v.get("why"):
                s["why"] = validate.text(v["why"], 500)
            if s["type"] == "speak_sentences":
                p = s["params"]
                p["reps"] = validate.integer(v.get("reps"), 1, 10, p["reps"])
                p["min_score"] = validate.integer(v.get("min_score"), 60, 100, p["min_score"])
                s["target"] = p["reps"] * len(p["ids"])
            elif v.get("target") is not None:
                s["target"] = validate.integer(v["target"], 5, 120, s["target"])
    kept = [i for i in range(len(steps)) if i not in drop]
    if len(kept) < 2:
        kept = list(range(len(steps)))
    rank = {}
    for k, x in enumerate(r.get("order") or []):
        if str(x).strip().isdigit():
            rank.setdefault(int(x), k)
    kept.sort(key=lambda i: rank.get(i, 100 + i))
    return [steps[i] for i in kept], validate.text(r.get("diagnosis"), 1200) or diagnosis


async def pipeline(d: dict, reason: str, run: str) -> dict:
    """Run the model pipeline on a digest: analysts and pace, planner, step details, then reviewer and milestones. Returns the raw plan."""
    jobs.set_stage("Reading your answers")

    async def analyst(dom):
        try:
            return dom, await call(
                "analyze:" + dom,
                ANALYZE.replace("DOMAIN", DOMAINS[dom]),
                {"overview": d["overview"], "data": d[dom]},
                run,
            )
        except Exception as e:  # noqa: BLE001
            return dom, {"error": str(e)[:300]}

    async def pace():
        try:
            return await call("pace", PACE, {"overview": d["overview"], "pace": d["pace"], "reason": reason}, run)
        except Exception as e:  # noqa: BLE001
            return {"error": str(e)[:300]}

    res = await asyncio.gather(*(analyst(x) for x in DOMAINS), pace())
    analyses, pace_r = dict(res[:-1]), res[-1]
    if all("error" in a for a in analyses.values()):
        raise llm.LLMError("Every analyst call failed: " + next(iter(analyses.values()))["error"])
    findings, strengths, unknown, advanced = [], [], [], []
    for dom, a in analyses.items():
        for i, f in enumerate(a.get("findings") or []):
            if isinstance(f, dict):
                findings.append(
                    {
                        "id": f"{dom}:{validate.text(f.get('id'), 40) or i + 1}",
                        "domain": dom,
                        "area": validate.text(f.get("area"), 16),
                        "items": validate.texts(f.get("items"), 12, 40),
                        "problem": validate.text(f.get("problem"), 400),
                        "context": validate.text(f.get("context"), 200),
                        "severity": validate.integer(f.get("severity"), 1, 5, 3),
                        "confidence": validate.integer(f.get("confidence"), 1, 5, 3),
                        "drill": validate.text(f.get("drill"), 200),
                    }
                )
        strengths += [f"{dom}: {x}" for x in validate.texts(a.get("strengths"), 5)]
        unknown += [f"{dom}: {x}" for x in validate.texts(a.get("unknown"), 5)]
        advanced += [f"{dom}: {x}" for x in validate.texts(a.get("too_advanced"), 5)]
    findings.sort(key=lambda f: -f["severity"] * f["confidence"])
    pace = {
        "plan_minutes": validate.integer(pace_r.get("plan_minutes"), 10, 60, PLAN_MINUTES),
        "target_scale": validate.number(pace_r.get("target_scale"), 0.5, 2.0, 1.0),
        "steps": validate.integer(pace_r.get("steps"), 3, 7, 5),
        "notes": validate.text(pace_r.get("notes"), 400),
        "avoid": validate.texts(pace_r.get("avoid"), 6),
    }

    jobs.set_stage("Choosing your next steps")
    s = d["sentences"]
    op = d["_open"]
    rules_on = TONE_RULES_RULE if d["overview"]["tone_rules"]["rule_active"] else ""
    task = PLAN + (ALPHABET_RULE if d["overview"]["alphabet"]["rule_active"] else "") + rules_on + level_rule(op)
    plan = await call(
        "plan",
        task,
        {
            "reason": reason,
            "overview": d["overview"],
            "pace": pace,
            "findings": findings[:30],
            "strengths": strengths,
            "unknown": unknown,
            "too_advanced": advanced,
            "reusable_sentences": {"weak": s["weak"], "library_not_practiced": s["library_not_practiced"]},
            "previous_plans": d["pace"]["previous_plans"],
            "milestones": d["milestones"],
        },
        run,
    )
    known = {x["text"] for x in s["weak"]} | {x["text"] for x in s["library_not_practiced"]}
    steps = [
        c
        for c in (
            clean_step(x, known, pace["target_scale"], op) for x in plan.get("steps") or [] if isinstance(x, dict)
        )
        if c
    ][:7]
    if not steps:
        raise llm.LLMError("The planner's steps could not be measured.")

    jobs.set_stage("Preparing your drills")
    profile = llm.profile_text(db.get_profile())
    hist = syllable_history()

    async def detail(st):
        try:
            if st["type"] == "speak_sentences" and st["params"].get("new"):
                await write_sentences(st, d, profile, run)
            # Sentence and word cards come from the learner's sentences, so they need no syllable deck.
            elif st["type"] in DECK_TYPES and st["params"].get("source") not in ("sentence", "word"):
                await pick_deck(st, findings, hist, run)
        except Exception as e:  # noqa: BLE001
            st["meta"].setdefault("errors", []).append(str(e)[:200])

    await asyncio.gather(*(detail(x) for x in steps))
    for st in steps:
        if st["type"] == "speak_sentences":
            st["params"].pop("new", None)
            st["target"] = st["params"]["reps"] * len(st["params"]["ids"])
    steps = [x for x in steps if x["type"] != "speak_sentences" or x["params"]["ids"]]
    if not steps:
        raise llm.LLMError("No step was left after the details stage.")

    jobs.set_stage("Checking your plan")
    draft = [
        {
            "pos": i,
            "type": x["type"],
            "title": x["title"],
            "why": x["why"],
            "focus": focus_of(x),
            "target": x["target"],
            "minutes": x["minutes"],
            "finding_ids": x["meta"]["finding_ids"],
        }
        for i, x in enumerate(steps)
    ]
    review_r, ms_r = await asyncio.gather(
        call(
            "review",
            REVIEW + (ALPHABET_RULE if d["overview"]["alphabet"]["rule_active"] else "") + rules_on + level_rule(op),
            {"draft": draft, "findings": findings[:30], "pace": pace, "overview": d["overview"]},
            run,
        ),
        milestones_call(d, findings, run),
        return_exceptions=True,
    )
    diagnosis = validate.text(plan.get("diagnosis"), 1200)
    if isinstance(review_r, dict):
        steps, diagnosis = apply_review(steps, review_r, diagnosis)
    return {
        "diagnosis": diagnosis,
        "steps": steps,
        "milestones": ms_r if isinstance(ms_r, dict) else None,
        "findings": findings,
        "strengths": strengths,
        "unknown": unknown,
        "too_advanced": advanced,
        "pace": pace,
        "review": review_r if isinstance(review_r, dict) else {"error": str(review_r)[:300]},
    }
