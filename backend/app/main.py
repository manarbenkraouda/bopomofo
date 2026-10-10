"""bopomofo API."""
from __future__ import annotations

import io
import traceback

import numpy as np
import soundfile as sf
from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from . import auth, coach, db, llm, scoring, speaker, stats, symbols, tts
from .asr import recognizer
from .config import OPENROUTER_API_KEY, OPENROUTER_MODEL
from .zhuyin import analyze_text

# Every route needs a signed-in Clerk user, except auth.PUBLIC. Each user sees only their own data (see db.py).
app = FastAPI(title="bopomofo API", dependencies=[Depends(auth.require_user)])


@app.middleware("http")
async def errors_as_json(request: Request, call_next):
    # Registered before CORS, so CORS wraps it and error responses still reach the browser.
    try:
        return await call_next(request)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        return JSONResponse({"detail": f"Server error: {type(e).__name__}: {e}"}, status_code=500)


# Local and LAN addresses for development, plus the public site at bopomofo.app and its subdomains.
app.add_middleware(CORSMiddleware, allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?|https://([a-z0-9-]+\.)*bopomofo\.app", allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def startup():
    db.init()
    recognizer.load_async()
    tts.preload_async()


@app.on_event("shutdown")
def shutdown():
    db.close_pool()


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
    use_profile: bool = True
    voice: str = ""


@app.get("/api/profile")
def profile_get():
    return db.get_profile()


@app.put("/api/profile")
def profile_put(body: dict[str, str]):
    clean = {k: v.strip()[:1000] for k, v in body.items() if k in llm.PROFILE_LABELS}
    return db.set_profile(clean)


@app.post("/api/sentences/generate")
async def sentences_generate(body: GenerateIn, background: BackgroundTasks):
    try:
        sents, usage = await llm.generate(body.topic, body.level, body.count, db.get_profile() if body.use_profile else None)
    except llm.LLMError as e:
        raise HTTPException(502, str(e)) from e
    saved = [db.add_sentence(s, body.topic, body.level) for s in sents]
    # Make the audio after the response is sent, so Listen plays at once. Same rates as the pages use.
    jobs = [(s["hanzi"], r) for s in saved for r in (0, -35)]
    jobs += [(w["text"], r) for s in saved for w in s.get("words") or [] for r in (0, -10) if w.get("text")]
    background.add_task(tts.pregenerate, jobs, body.voice or tts.DEFAULT_VOICE)
    return {"sentences": [with_items(s) for s in saved], "usage": usage}


def with_items(s: dict) -> dict:
    return {**s, "items": analyze_text(s["hanzi"])}


@app.get("/api/sentences")
def sentences_list():
    # "practice": how often each sentence was said aloud, and its best and last score (None when never said).
    said = db.speaking_by_text()
    return {"sentences": [{**with_items(s), "practice": said.get(s["hanzi"])} for s in db.list_sentences()]}


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
async def tts_get(text: str, rate: int = 0, voice: str = tts.DEFAULT_VOICE):
    if not text.strip() or len(text) > 400:
        raise HTTPException(400, "Text must be 1-400 characters.")
    try:
        path = await run_in_threadpool(tts.speak, text, max(-60, min(40, rate)), voice)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Text to speech failed: {e}") from e
    return FileResponse(path, media_type="audio/wav", headers={"Cache-Control": "public, max-age=31536000"})


@app.get("/api/tts/voices")
def tts_voices():
    return {"default": tts.DEFAULT_VOICE, "voices": [{"id": v.id, "label": v.label, "description": v.description} for v in tts.VOICES]}


@app.post("/api/tts/cache/clear")
def tts_cache_clear():
    return tts.clear_cache()


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
def speech_analyze(audio: UploadFile = File(...), text: str = Form(...), mode: str = Form(""), step: str = Form(""),
                   help: str = Form(""), try_n: str = Form("")):
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
    # Every syllable is saved: expected and heard tone, initial, and final, so the stats can show confusions.
    # "step": the coach step this recording belongs to. Only answers given inside a step count for it.
    # "help": the learner heard the model or saw the Pinyin first (the cheat). "try_n": 0 for the first recording of this card.
    stats.log_speaking(text, res, mode or None, int(step) if step.isdigit() else None,
                       help=help in ("1", "true"), try_n=int(try_n) if try_n.isdigit() else 0)
    coach.refresh()
    return res


@app.post("/api/symbols/check")
def symbols_check(audio: UploadFile = File(...), symbol: str = Form(...)):
    """Reading quiz: did the learner say the name of this Bopomofo symbol?"""
    if not recognizer.ready:
        raise HTTPException(503, recognizer.error or "The speech model is still loading. Try again in a few seconds.")
    a = read_audio(audio.file.read())
    try:
        res = symbols.check(a, symbol)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    symbols.save_clip(a, res)
    return res


class AttemptIn(BaseModel):
    area: str
    item: str
    ok: bool
    score: float | None = None
    details: dict | None = None


@app.post("/api/progress/attempt")
def progress_attempt(body: AttemptIn):
    """Old format, kept for compatibility. New clients send /api/progress/event."""
    db.add_event(db.legacy_event(body.area, body.item, body.ok, body.score, body.details))
    return {"ok": True}


class UnitIn(BaseModel):
    kind: str = Field(max_length=16)
    expected: str | int = Field()
    actual: str | int | None = None
    ok: bool | None = None
    pos: int = 0
    try_n: int = 0
    help: bool = False
    ctx: str | None = None
    lex: str | int | None = None
    prev: str | int | None = None
    next: str | int | None = None
    source: str | None = None
    uncertain: bool = False
    extra: dict | None = None


class EventIn(BaseModel):
    area: str = Field(max_length=16)
    mode: str | None = Field(default=None, max_length=16)
    item: str = Field(max_length=400)
    ok: bool
    first_try: bool | None = None
    score: float | None = None
    ms: int | None = Field(default=None, ge=0, le=3_600_000)
    tries: int | None = None
    help: bool = False
    replays: int | None = None
    details: dict | None = None
    units: list[UnitIn] = Field(default_factory=list, max_length=300)


@app.post("/api/progress/event")
def progress_event(body: EventIn):
    ev = body.model_dump()
    details = ev.get("details") or {}
    if "step" in details:
        step = str(details["step"])
        details["step"] = int(step) if step.isdigit() else None
    eid = db.add_event(ev)
    coach.refresh()
    return {"ok": True, "id": eid}


class DayIn(BaseModel):
    day: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    seconds: int = Field(ge=0, le=86400)
    goal_min: int | None = None


@app.put("/api/progress/day")
def progress_day(body: DayIn):
    db.save_day(body.day, body.seconds, body.goal_min)
    return {"ok": True}


@app.get("/api/progress/summary")
def progress_summary():
    return db.summary()


@app.get("/api/stats")
def stats_get(days: int = 30, area: str = ""):
    return stats.compute(days if days > 0 else None, area or None)


@app.get("/api/stats/challenges")
def stats_challenges():
    return {"challenges": stats.challenges()}


@app.get("/api/stats/export.csv")
def stats_export():
    return Response(stats.export_csv(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="bopomofo-history.csv"'})


@app.get("/api/coach")
def coach_get():
    coach.refresh()
    return coach.state()


@app.get("/api/alphabet")
def alphabet_get():
    """Which of the 37 symbols the learner knows, for the Symbols screen. Read only: it does not refresh the plan."""
    return coach.alphabet_status()


class PlanIn(BaseModel):
    reason: str = Field(default="", max_length=300)


@app.post("/api/coach/plan")
def coach_plan(body: PlanIn):
    coach.start(body.reason.strip() or "The learner asked for a new plan now.")
    return coach.state()


@app.get("/api/coach/plan/{pid}/story")
def coach_story(pid: int):
    from . import story
    s = story.get(pid)
    if not s:
        raise HTTPException(404, "This plan has no story yet")
    return s


@app.post("/api/coach/plan/{pid}/story")
def coach_story_write(pid: int):
    """Write the headline and story of a saved plan again (older plans, or after a failure). Runs in the background."""
    if not coach._plan_row(pid):
        raise HTTPException(404, "No such plan")
    coach.start_story(pid)
    return coach.state()


class SkipIn(BaseModel):
    reason: str = "not_now"


@app.post("/api/coach/step/{sid}/skip")
def coach_skip(sid: int, body: SkipIn):
    return coach.skip(sid, body.reason)


@app.get("/api/coach/step/{sid}")
def coach_step(sid: int):
    coach.refresh()
    s = coach.step_state(sid)
    if not s:
        raise HTTPException(404, "No such step")
    return s
