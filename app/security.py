"""Owner-only pilot access. Supabase verifies tokens; client claims are never trusted."""
import os
import time
import hashlib
from threading import Lock
from urllib.parse import urlparse

import requests
from anyio import to_thread
from fastapi import Request
from fastapi.responses import JSONResponse

COOKIE_NAME = "vcreation_session"
_cache = {}
_lock = Lock()


class AccessError(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message


def auth_required():
    default = "true" if os.getenv("RENDER") else "false"
    return os.getenv("VCREATION_REQUIRE_AUTH", default).lower() == "true"


def resolve_user(token):
    if not token or len(token) > 12000:
        raise AccessError(401, "Please sign in to open your private workspace.")
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY") or os.getenv("SUPABASE_ANON_KEY", "")
    owners = {email.strip().lower() for email in os.getenv("VCREATION_OWNER_EMAILS", "").split(",") if email.strip()}
    if urlparse(url).scheme != "https" or not key or not owners:
        raise AccessError(503, "Private workspace access is being configured. Please try again later.")
    digest = hashlib.sha256((url + key + ",".join(sorted(owners)) + token).encode()).hexdigest()
    with _lock:
        previous = _cache.get(digest)
        if previous and previous[0] > time.monotonic():
            return previous[1]
    try:
        response = requests.get(url + "/auth/v1/user", headers={"apikey": key, "Authorization": "Bearer " + token}, timeout=10)
        if response.status_code in {401, 403}:
            raise AccessError(401, "Your session expired. Please sign in again.")
        if response.status_code != 200:
            raise AccessError(503, "Sign-in verification is temporarily unavailable.")
        user = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise AccessError(503, "Sign-in verification is temporarily unavailable.") from exc
    if not isinstance(user, dict) or not user.get("id") or user.get("is_anonymous") or not user.get("email_confirmed_at"):
        raise AccessError(401, "Please sign in with a verified email account.")
    if str(user.get("email", "")).lower() not in owners:
        raise AccessError(403, "This private pilot workspace is available to its owner only.")
    public_user = {"id": user["id"], "email": user["email"]}
    with _lock:
        if len(_cache) >= 1000:
            _cache.clear()
        _cache[digest] = (time.monotonic() + 15, public_user)
    return public_user


class PrivateWorkspaceMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not auth_required() or scope.get("path") == "/":
            return await self.app(scope, receive, send)
        request = Request(scope, receive)
        authorization = request.headers.get("authorization", "")
        bearer = authorization.startswith("Bearer ")
        token = authorization[7:] if bearer else request.cookies.get(COOKIE_NAME, "")
        try:
            if request.method not in {"GET", "HEAD", "OPTIONS"} and not bearer:
                allowed = {value.strip() for value in os.getenv("VCREATION_ALLOWED_ORIGINS", "https://vcreation.vercel.app").split(",")}
                if request.headers.get("origin") not in allowed:
                    raise AccessError(403, "This request could not be verified. Reload the workspace and try again.")
            scope.setdefault("state", {})["owner"] = await to_thread.run_sync(resolve_user, token)
        except AccessError as exc:
            response = JSONResponse({"detail": exc.message}, status_code=exc.status, headers={"Cache-Control": "private, no-store"})
            return await response(scope, receive, send)

        async def private_send(message):
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() not in {b"cache-control", b"vary"}]
                headers.extend([(b"cache-control", b"private, no-store"), (b"vary", b"Cookie, Authorization"), (b"x-content-type-options", b"nosniff")])
                message["headers"] = headers
            await send(message)
        await self.app(scope, receive, private_send)
