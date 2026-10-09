"""Zhuyin Studio API."""
from __future__ import annotations

import io
import traceback

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from . import db, llm, scoring, speaker, tts
from .asr import recognizer
from .config import OPENROUTER_API_KEY, OPENROUTER_MODEL
from .zhuyin import analyze_text

app = FastAPI(title="Zhuyin Studio API")


@app.middleware("http")
async def errors_as_json(request: Request, call_next):
    # Registered before CORS, so CORS wraps it and error responses still reach the browser.
    try:
        return await call_next(request)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        return JSONResponse({"detail": f"Server error: {type(e).__name__}: {e}"}, status_code=500)


app.add_middleware(CORSMiddleware, allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?", allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def startup():
    db.init()
    recognizer.load_async()


@app.get("/api/health")
def health():
    return {"ok": True, "speech_model": "ready" if recognizer.ready else ("error" if recognizer.error else "loading"),
            "speech_error": recognizer.error, "speech_load_seconds": recognizer.load_seconds,
            "llm_model": OPENROUTER_MODEL, "llm_configured": bool(OPENROUTER_API_KEY), "speaker_hz": speaker.get()}


class TextIn(BaseModel):
    text: str = Field(min_length=1, max_length=400)


@app.post("/api/text/analyze")
def text_analyze(body: TextIn):
    return {"text": body.text, "items": analyze_text(body.text)}


@app.post("/api/text/translate")
async def text_translate(body: TextIn):
    try:
        return await llm.translate(body.text)
    except llm.LLMError as e:
        raise HTTPException(502, str(e)) from e


class GenerateIn(BaseModel):
    topic: str = Field(default="", max_length=200)
    level: str = "beginner"
    count: int = Field(default=5, ge=1, le=12)


@app.post("/api/sentences/generate")
async def sentences_generate(body: GenerateIn):
    try:
        sents, usage = await llm.generate(body.topic, body.level, body.count)
    except llm.LLMError as e:
        raise HTTPException(502, str(e)) from e
    saved = [db.add_sentence(s, body.topic, body.level) for s in sents]
    return {"sentences": [with_items(s) for s in saved], "usage": usage}


def with_items(s: dict) -> dict:
    return {**s, "items": analyze_text(s["hanzi"])}


@app.get("/api/sentences")
def sentences_list():
    return {"sentences": [with_items(s) for s in db.list_sentences()]}


@app.get("/api/sentences/{sid}")
def sentence_get(sid: int):
    s = db.get_sentence(sid)
    if not s:
        raise HTTPException(404, "Not found")
    return with_items(s)


@app.delete("/api/sentences/{sid}")
def sentence_delete(sid: int):
    db.delete_sentence(sid)
    return {"ok": True}


@app.get("/api/tts")
async def tts_get(text: str, rate: int = 0):
    if not text.strip() or len(text) > 400:
        raise HTTPException(400, "Text must be 1-400 characters.")
    try:
        path = await tts.speak(text, max(-60, min(40, rate)))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Text to speech failed: {e}") from e
    return FileResponse(path, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=31536000"})


def read_audio(data: bytes) -> np.ndarray:
    try:
        a, sr = sf.read(io.BytesIO(data), dtype="float32")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Could not read the audio: {e}") from e
    if a.ndim > 1:
        a = a.mean(axis=1)
    if sr != 16000:
        n = int(len(a) * 16000 / sr)
        a = np.interp(np.linspace(0, len(a) - 1, n), np.arange(len(a)), a).astype(np.float32)
    if len(a) < 16000 * 0.3:
        raise HTTPException(400, "The recording is too short.")
    if len(a) > 16000 * 30:
        raise HTTPException(400, "The recording is too long (30 s maximum).")
    return a


@app.post("/api/speech/analyze")
def speech_analyze(audio: UploadFile = File(...), text: str = Form(...)):
    if not recognizer.ready:
        raise HTTPException(503, recognizer.error or "The speech model is still loading. Try again in a few seconds.")
    a = read_audio(audio.file.read())
    if np.abs(a).max() < 0.01:
        raise HTTPException(400, "The recording is silent. Check the microphone.")
    try:
        res = scoring.analyze(a, text, speaker.get())
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if res.get("speaker_hz"):
        speaker.update(res["speaker_hz"])
    tones = [{"tone": s["expected"]["surface_tone"], "ok": s["tone_ok"]} for s in res["syllables"]]
    db.add_attempt("speaking", text, res["score"] >= 80, res["score"], {"tones": tones})
    return res


class AttemptIn(BaseModel):
    area: str
    item: str
    ok: bool
    score: float | None = None
    details: dict | None = None


@app.post("/api/progress/attempt")
def progress_attempt(body: AttemptIn):
    db.add_attempt(body.area, body.item, body.ok, body.score, body.details)
    return {"ok": True}


@app.get("/api/progress/summary")
def progress_summary():
    return db.summary()
