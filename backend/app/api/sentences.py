"""Practice sentences: written by the AI model for the learner, then saved with their audio."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from .. import db, limits, llm, tts
from ..zhuyin import analyze_text

router = APIRouter()


class GenerateIn(BaseModel):
    topic: str = Field(default="", max_length=200)
    level: str = "beginner"
    count: int = Field(default=5, ge=1, le=12)
    use_profile: bool = True
    voice: str = ""


def with_items(s: dict) -> dict:
    """A saved sentence with the Bopomofo and tones of each character."""
    return {**s, "items": analyze_text(s["hanzi"])}


@router.post("/sentences/generate")
async def sentences_generate(body: GenerateIn, background: BackgroundTasks):
    try:
        sents, usage = await llm.generate(
            body.topic, body.level, body.count, db.get_profile() if body.use_profile else None
        )
    except llm.LLMError as e:
        raise HTTPException(502, str(e)) from e
    saved = [db.add_sentence(s, body.topic, body.level) for s in sents]
    # Make the audio after the response is sent, so Listen plays at once. Same rates as the pages use.
    jobs = [(s["hanzi"], r) for s in saved for r in (0, -35)]
    jobs += [(w["text"], r) for s in saved for w in s.get("words") or [] for r in (0, -10) if w.get("text")]
    background.add_task(tts.pregenerate, jobs, body.voice or tts.DEFAULT_VOICE, db.current_user())
    return {"sentences": [with_items(s) for s in saved], "usage": usage, "ai_quota": limits.ai_quota()}


@router.get("/sentences")
def sentences_list():
    # "practice": how often each sentence was said aloud, and its best and last score (None when never said).
    said = db.speaking_by_text()
    return {"sentences": [{**with_items(s), "practice": said.get(s["hanzi"])} for s in db.list_sentences()]}


@router.get("/sentences/{sid}")
def sentence_get(sid: int):
    s = db.get_sentence(sid)
    if not s:
        raise HTTPException(404, "Not found")
    return with_items(s)


@router.delete("/sentences/{sid}")
def sentence_delete(sid: int):
    db.delete_sentence(sid)
    return {"ok": True}
