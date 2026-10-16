"""Any Chinese text: its Bopomofo and tones, and its translation by the AI model."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import limits, llm
from ..zhuyin import analyze_text

router = APIRouter()


class TextIn(BaseModel):
    text: str = Field(min_length=1, max_length=400)


@router.post("/text/analyze")
def text_analyze(body: TextIn):
    return {"text": body.text, "items": analyze_text(body.text)}


@router.post("/text/translate")
async def text_translate(body: TextIn):
    try:
        return {**await llm.translate(body.text), "ai_quota": limits.ai_quota()}
    except llm.LLMError as e:
        raise HTTPException(502, str(e)) from e
