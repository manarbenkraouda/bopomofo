"""Clerk sign-in for the API.

The browser sends the Clerk session token as "Authorization: Bearer <token>". Every route needs a valid token,
except the public ones below. The user id in the token (sub) becomes the database user of the request (db.set_user).
"""
from __future__ import annotations

from clerk_backend_api.security import authenticate_request_async
from clerk_backend_api.security.types import AuthenticateRequestOptions
from fastapi import HTTPException, Request

from . import db
from .config import CLERK_AUTHORIZED_PARTIES, CLERK_JWT_KEY, CLERK_SECRET_KEY

# Open without sign-in. A valid token is still read, so /api/health can show the user's voice pitch.
# /api/tts is open because <audio src> cannot send a token; it only reads text aloud.
PUBLIC = {"/api/health", "/api/tts", "/api/tts/voices"}

_options = AuthenticateRequestOptions(secret_key=CLERK_SECRET_KEY or None, jwt_key=CLERK_JWT_KEY or None,
                                      authorized_parties=CLERK_AUTHORIZED_PARTIES or None)


async def user_id(request: Request) -> str | None:
    """The Clerk user id of a valid session token, or None."""
    if not request.headers.get("authorization", "").startswith("Bearer "):
        return None
    state = await authenticate_request_async(request, _options)
    return (state.payload or {}).get("sub") if state.is_signed_in else None


async def require_user(request: Request) -> None:
    """App-wide dependency. An async function, so the user it sets is seen by sync routes and their threads."""
    public = request.url.path in PUBLIC
    if not (CLERK_SECRET_KEY or CLERK_JWT_KEY):
        if public:
            return
        raise HTTPException(503, "Sign-in is not configured on the server (CLERK_SECRET_KEY).")
    uid = await user_id(request)
    if not uid and not public:
        raise HTTPException(401, "Please sign in.")
    db.set_user(uid)
