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


async def _chat(messages: list[dict], temperature: float = 0.9, model: str | None = None, reasoning: bool = False,
                timeout: float = 90) -> dict:
    if not OPENROUTER_API_KEY:
        raise LLMError("OPENROUTER_API_KEY is not set in backend/.env")
    # Reasoning is off: on long prompts it used the full token limit and the reply had no JSON.
    # The coach turns it on: a router model such as Jev chooses its own reasoning effort.
    # No max_tokens: the reply length is not capped.
    body = {"model": model or OPENROUTER_MODEL, "messages": messages, "response_format": {"type": "json_object"},
            "temperature": temperature}
    if not reasoning:
        body["reasoning"] = {"enabled": False}
    async with httpx.AsyncClient(timeout=timeout) as c:
        r = await c.post(URL, json=body, headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "X-Title": "Zhuyin Studio"})
    if r.status_code != 200:
        raise LLMError(f"OpenRouter error {r.status_code}: {r.text[:300]}")
    data = r.json()
    choice = data["choices"][0]
    content = choice["message"].get("content") or ""
    start = content.find("{")
    if start < 0:
        if choice.get("finish_reason") == "length":
            raise LLMError("The model reply was cut off before it was complete. Try fewer sentences.")
        raise LLMError("The model did not return JSON.")
    try:
        obj, _ = json.JSONDecoder().raw_decode(content[start:])
        return {"json": obj, "usage": data.get("usage", {}), "model": data.get("model")}
    except json.JSONDecodeError as e:
        if choice.get("finish_reason") == "length":
            raise LLMError("The model reply was cut off before it was complete. Try fewer sentences.") from e
        raise LLMError(f"Invalid JSON from the model: {e}") from e


def _clean(s: dict) -> dict | None:
    hanzi = _s2tw.convert(str(s.get("hanzi", "")).strip())
    if not re.search(r"[\u4e00-\u9fff]", hanzi) or re.search(r"[A-Za-z0-9]", hanzi):
        return None
    words = [{"text": _s2tw.convert(str(w.get("text", ""))), "english": str(w.get("english", ""))} for w in s.get("words", []) if w.get("text")]
    return {"hanzi": hanzi, "english": str(s.get("english", "")).strip(), "words": words}


PROFILE_LABELS = {
    "name": "Name", "chinese_name": "Chinese name", "age": "Age", "nationality": "Nationality", "hometown": "Hometown",
    "lives_in": "Lives in", "job": "Job", "company": "Company or school", "studies": "Studies", "family": "Family",
    "languages": "Languages", "hobbies": "Hobbies", "food": "Favorite food", "why_mandarin": "Why learning Mandarin",
    "taiwan": "Connection to Taiwan", "notes": "Other facts",
}


def profile_text(profile: dict | None) -> str:
    lines = [f"- {label}: {str(profile.get(k, '')).strip()}" for k, label in PROFILE_LABELS.items() if profile and str(profile.get(k, "")).strip()]
    if not lines:
        return ""
    return ("\nThe learner's real profile (written in English):\n" + "\n".join(lines) +
            "\nWrite the sentences in the first person, as the learner speaking about their real life. Use these real facts "
            "(name, age, job, city, family, hobbies and so on) when they fit the topic. Never invent personal facts that are not in the profile "
            "or that contradict it. For the learner's name, use the Chinese name if given; else use a common Chinese transliteration, "
            "because the Chinese text must not contain Latin letters.")


async def generate(topic: str, level: str, count: int, profile: dict | None = None) -> tuple[list[dict], dict]:
    topic = topic.strip() or "everyday life in Taiwan"
    prompt = f"Topic: {topic}\nLevel: {LEVELS.get(level, LEVELS['beginner'])}\nWrite {count} different sentences.{profile_text(profile)}"
    out: list[dict] = []
    for attempt in range(2):
        try:
            res = await _chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}])
        except LLMError:
            if attempt:
                raise
            continue
        out = [c for c in (_clean(s) for s in res["json"].get("sentences", [])) if c]
        if out:
            break
    if not out:
        raise LLMError("The model returned no usable sentences. Try again.")
    return out[:count], res["usage"]


async def translate(text: str) -> dict:
    prompt = ("Translate this Taiwan Mandarin text to natural English and split it into words with short English glosses. "
              'Return JSON only: {"english":"...","words":[{"text":"...","english":"..."}]}\nText: ' + text)
    res = await _chat([{"role": "user", "content": prompt}])
    j = res["json"]
    return {"english": str(j.get("english", "")), "words": [{"text": str(w.get("text", "")), "english": str(w.get("english", ""))} for w in j.get("words", []) if w.get("text")]}
