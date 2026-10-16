"""HTTP middleware of the API: JSON errors, request size limits, CORS, and the answer when a daily limit is reached.

install() adds them in a fixed order. Starlette wraps the app with the last middleware added outermost, so the
result is CORS → BodyLimit → errors_as_json → routes. CORS is outside, so a 413 or a 500 still reaches the browser.
"""

from __future__ import annotations

import math
import traceback

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import limits

# Request size limits, so a large body is stopped before it is parsed or saved. This applies before the sign-in
# check too. Audio uploads are at most 30 s; the app records 16 kHz mono WAV.
UPLOAD_PATHS = {"/api/speech/analyze", "/api/symbols/check"}
UPLOAD_LIMIT = 16 * 1024 * 1024
BODY_LIMIT = 1024 * 1024
TOO_LARGE = "The request is too large."

# Local and LAN addresses for development, plus the public site at bopomofo.app and its subdomains.
ALLOWED_ORIGINS = r"https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?|https://([a-z0-9-]+\.)*bopomofo\.app"


async def limit_reached(request: Request, exc: limits.LimitReached) -> JSONResponse:
    """429 for a daily limit. For AI work, the body has the quota and Retry-After the seconds until it refills."""
    body = {"detail": str(exc)}
    headers = {"Cache-Control": "no-store"}
    if exc.ai_quota is not None:
        body["ai_quota"] = exc.ai_quota
        headers["Retry-After"] = str(max(1, math.ceil(exc.ai_quota["resets_at"] - exc.ai_quota["server_now"])))
    return JSONResponse(body, status_code=429, headers=headers)


async def errors_as_json(request: Request, call_next):
    """Any error a route did not handle becomes a JSON 500 with its type and message, and its traceback is logged."""
    try:
        return await call_next(request)
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        return JSONResponse({"detail": f"Server error: {type(e).__name__}: {e}"}, status_code=500)


class BodyLimit:
    """With Content-Length, the server reads exactly that many bytes, so the declared size is checked.
    A chunked body has no declared size: it is read here up to the limit, then given to the app."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        limit = UPLOAD_LIMIT if scope["path"] in UPLOAD_PATHS else BODY_LIMIT
        headers = dict(scope["headers"])
        too_large = JSONResponse({"detail": TOO_LARGE}, status_code=413)
        declared = headers.get(b"content-length", b"")
        if declared.isdigit() and int(declared) > limit:
            return await too_large(scope, receive, send)
        if declared or b"transfer-encoding" not in headers:
            return await self.app(scope, receive, send)
        parts, size = [], 0
        while True:
            message = await receive()
            if message["type"] != "http.request":
                return  # the client left
            size += len(message.get("body", b""))
            if size > limit:
                return await too_large(scope, receive, send)
            parts.append(message.get("body", b""))
            if not message.get("more_body"):
                break
        body = b"".join(parts)
        given = False

        async def replay():
            nonlocal given
            if given:
                return await receive()
            given = True
            return {"type": "http.request", "body": body, "more_body": False}

        await self.app(scope, replay, send)


def install(app: FastAPI) -> None:
    """Add the exception handler and the middleware, innermost first (see the module docstring)."""
    app.add_exception_handler(limits.LimitReached, limit_reached)
    app.middleware("http")(errors_as_json)
    app.add_middleware(BodyLimit)
    app.add_middleware(CORSMiddleware, allow_origin_regex=ALLOWED_ORIGINS, allow_methods=["*"], allow_headers=["*"])
