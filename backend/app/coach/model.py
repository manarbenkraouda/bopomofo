"""One model call of the coach, logged in coach_calls with its model, time, and cost."""

from __future__ import annotations

import json
import time

from .. import db, limits, llm
from ..config import COACH_MODEL, OPENROUTER_MODEL
from .prompts import COMMON


def _log(run, plan_id, step_id, stage, model, t0, usage, ok, error, response):
    """Save one model call in coach_calls."""
    usage = usage or {}
    with db.conn() as c:
        c.execute(
            "INSERT INTO coach_calls(ts, run, plan_id, step_id, stage, model, ms, cost, tokens, ok, error, response) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                time.time(),
                run,
                plan_id,
                step_id,
                stage,
                model,
                round((time.time() - t0) * 1000),
                usage.get("cost"),
                usage.get("total_tokens"),
                int(ok),
                error,
                json.dumps(response, ensure_ascii=False)[:20000] if response is not None else None,
            ),
        )


async def call(
    stage: str,
    task: str,
    payload: dict,
    run: str,
    step_id: int | None = None,
    plan_id: int | None = None,
    common: str | None = None,
) -> dict:
    """One logged model decision. Tries the coach model, then the default model."""
    msgs = [
        {"role": "system", "content": (common or COMMON) + "\n\n" + task},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False, separators=(",", ":"))},
    ]
    last: Exception | None = None
    for model in dict.fromkeys([COACH_MODEL, OPENROUTER_MODEL]):
        t0 = time.time()
        try:
            res = await llm._chat(msgs, temperature=0.3, model=model, reasoning=True, timeout=180)
            _log(run, plan_id, step_id, stage, res.get("model") or model, t0, res.get("usage"), True, None, res["json"])
            if not isinstance(res["json"], dict):
                raise llm.LLMError("The reply was not a JSON object.")
            return res["json"]
        except limits.LimitReached:
            raise  # a quota wait is not a model failure; another model must not retry it
        except Exception as e:  # noqa: BLE001
            _log(run, plan_id, step_id, stage, model, t0, None, False, f"{type(e).__name__}: {e}"[:400], None)
            last = e
    raise llm.LLMError(f"{stage}: {last}")
