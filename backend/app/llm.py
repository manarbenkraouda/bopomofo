"""Sentence generation through OpenRouter."""
from __future__ import annotations

import json
import re

import httpx
import opencc

from .config import OPENROUTER_API_KEY, OPENROUTER_MODEL

_s2tw = opencc.OpenCC("s2twp")
URL = "https://openrouter.ai/api/v1/chat/completions"

LEVELS = {
    "beginner": "Beginner (TOCFL A1). 4 to 9 characters. Very common words only. Simple statements and questions.",
    "intermediate": "Intermediate (TOCFL A2-B1). 8 to 16 characters. Everyday vocabulary, simple connectors.",
    "advanced": "Advanced (TOCFL B2). 12 to 25 characters. Natural spoken Taiwan Mandarin.",
}

SYSTEM = """You write practice sentences for a learner of Taiwan Mandarin who is learning Bopomofo (Zhuyin).
Rules:
- Use Traditional Chinese characters as used in Taiwan, and natural Taiwan Mandarin vocabulary (e.g. 計程車, 腳踏車, 捷運, 便當).
- No pinyin, no zhuyin, no Latin letters or digits inside the Chinese text. Write numbers in Chinese characters.
- Each sentence must be useful in real conversation.
- Give a natural English translation and split the sentence into words with short English glosses.
Return JSON only, in this shape:
{"sentences":[{"hanzi":"...","english":"...","words":[{"text":"...","english":"..."}]}]}"""


class LLMError(RuntimeError):
    pass


async def _chat(messages: list[dict], max_tokens: int = 4000) -> dict:
    if not OPENROUTER_API_KEY:
        raise LLMError("OPENROUTER_API_KEY is not set in backend/.env")
    body = {"model": OPENROUTER_MODEL, "messages": messages, "response_format": {"type": "json_object"}, "max_tokens": max_tokens, "temperature": 0.9,
            "reasoning": {"effort": "low"}}
    async with httpx.AsyncClient(timeout=90) as c:
        r = await c.post(URL, json=body, headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "X-Title": "Zhuyin Studio"})
    if r.status_code != 200:
        raise LLMError(f"OpenRouter error {r.status_code}: {r.text[:300]}")
    data = r.json()
    content = data["choices"][0]["message"].get("content") or ""
    m = re.search(r"\{.*\}", content, re.S)
    if not m:
        raise LLMError("The model did not return JSON.")
    try:
        return {"json": json.loads(m.group(0)), "usage": data.get("usage", {})}
    except json.JSONDecodeError as e:
        raise LLMError(f"Invalid JSON from the model: {e}") from e


def _clean(s: dict) -> dict | None:
    hanzi = _s2tw.convert(str(s.get("hanzi", "")).strip())
    if not re.search(r"[\u4e00-\u9fff]", hanzi) or re.search(r"[A-Za-z0-9]", hanzi):
        return None
    words = [{"text": _s2tw.convert(str(w.get("text", ""))), "english": str(w.get("english", ""))} for w in s.get("words", []) if w.get("text")]
    return {"hanzi": hanzi, "english": str(s.get("english", "")).strip(), "words": words}


async def generate(topic: str, level: str, count: int) -> tuple[list[dict], dict]:
    topic = topic.strip() or "everyday life in Taiwan"
    prompt = f"Topic: {topic}\nLevel: {LEVELS.get(level, LEVELS['beginner'])}\nWrite {count} different sentences."
    res = await _chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}])
    out = [c for c in (_clean(s) for s in res["json"].get("sentences", [])) if c]
    if not out:
        raise LLMError("The model returned no usable sentences.")
    return out[:count], res["usage"]


async def translate(text: str) -> dict:
    prompt = ("Translate this Taiwan Mandarin text to natural English and split it into words with short English glosses. "
              'Return JSON only: {"english":"...","words":[{"text":"...","english":"..."}]}\nText: ' + text)
    res = await _chat([{"role": "user", "content": prompt}], max_tokens=2000)
    j = res["json"]
    return {"english": str(j.get("english", "")), "words": [{"text": str(w.get("text", "")), "english": str(w.get("english", ""))} for w in j.get("words", []) if w.get("text")]}
