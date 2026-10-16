"""bopomofo API: the FastAPI app, its start and stop, and the routes of app/api.

Run it with: uvicorn app.main:app (see start.cmd, or deploy/vps for the server).
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from . import auth, db, deep_check, middleware, tts
from .api import ROUTERS
from .asr import recognizer
from .runtime import RUNTIME

# On stop, wait at most this long for coach work in progress (a plan takes about a minute, each AI call at most 90 s).
# deploy/vps/bopomofo-api@.service gives the process enough time for this.
BACKGROUND_DRAIN_SECONDS = 600


def startup() -> None:
    """Open the database, then load the speech model and the voices in the background."""
    print(f"Speech runtime {RUNTIME.describe()}", flush=True)
    db.init()
    tts.remove_shared_files()
    recognizer.load_async()
    tts.preload_async()
    deep_check.start(lambda: recognizer.vocab)


def shutdown() -> None:
    """Let the background work finish, then close the database."""
    # The deep checks still in the queue get at most deep_check.DRAIN_SECONDS, then the worker process stops.
    dropped = deep_check.stop()
    if dropped:
        print(f"Stopping with {dropped} deep checks not done", flush=True)
    # A deploy stops the old process after Caddy sends new requests to the new one. Coach plans and stories still
    # being written here finish and save first; the new process shows their progress from the coach_jobs table.
    left = db.wait_background(BACKGROUND_DRAIN_SECONDS)
    if left:
        print(f"Stopping with {left} background jobs unfinished after {BACKGROUND_DRAIN_SECONDS}s", flush=True)
    db.close_pool()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    startup()
    yield
    shutdown()


# Every route needs a signed-in Clerk user, except auth.PUBLIC. Each user sees only their own data (see db.py).
app = FastAPI(title="bopomofo API", dependencies=[Depends(auth.require_user)], lifespan=lifespan)
middleware.install(app)
for router in ROUTERS:
    app.include_router(router, prefix="/api")
