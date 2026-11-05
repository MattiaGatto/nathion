"""Single-owner local authentication; secrets never appear in URLs or logs."""
import hashlib
import hmac
import json
import secrets
import time
from collections import defaultdict, deque
from http.cookies import CookieError, SimpleCookie
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.core.config import get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])
COOKIE = "nathion_session"
_attempts = defaultdict(deque)


def access_token() -> str:
    path = Path(get_settings().auth_token_file)
    return path.read_text(encoding="utf-8").strip()


def initialize_auth() -> None:
    if not get_settings().auth_enabled:
        return
    path = Path(get_settings().auth_token_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("x", encoding="utf-8") as file:
            file.write(secrets.token_urlsafe(32))
        path.chmod(0o600)
    except FileExistsError:
        if len(access_token()) < 32:
            raise RuntimeError("Credenziale locale non valida")


def signature(payload: str) -> str:
    return hmac.new(access_token().encode(), payload.encode(), hashlib.sha256).hexdigest()


def authenticated(headers) -> bool:
    if not get_settings().auth_enabled:
        return True
    authorization = headers.get("authorization", "")
    if authorization.startswith("Bearer "):
        return secrets.compare_digest(authorization[7:], access_token())
    try:
        cookies = SimpleCookie(); cookies.load(headers.get("cookie", ""))
        value = cookies[COOKIE].value
        expiry, nonce, digest = value.split(".")
        return int(expiry) > time.time() and secrets.compare_digest(digest, signature(f"{expiry}.{nonce}"))
    except (ValueError, KeyError, CookieError):
        return False


class AuthenticationMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"} or not scope.get("path", "").startswith("/api/"):
            return await self.app(scope, receive, send)
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        origin = headers.get("origin")
        mutation = scope["type"] == "websocket" or scope.get("method") not in {"GET", "HEAD", "OPTIONS"}
        bad_origin = mutation and origin and origin not in get_settings().cors_allow_origins
        public = scope["path"] in {"/api/auth/status", "/api/auth/login"} or scope.get("method") == "OPTIONS"
        allowed = not bad_origin and (public or authenticated(headers))
        if allowed:
            return await self.app(scope, receive, send)
        if scope["type"] == "websocket":
            return await send({"type": "websocket.close", "code": 4403 if bad_origin else 4401})
        response = Response(json.dumps({"detail": "Origine non autorizzata" if bad_origin else "Accesso richiesto"}),
                            status_code=403 if bad_origin else 401, media_type="application/json")
        await response(scope, receive, send)


class LoginIn(BaseModel):
    token: str = Field(min_length=1, max_length=200)


@router.get("/status")
def status(request: Request):
    return {"enabled": get_settings().auth_enabled, "authenticated": authenticated(request.headers)}


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response):
    ip = request.client.host if request.client else "local"
    attempts = _attempts[ip]
    now = time.monotonic()
    while attempts and attempts[0] < now - 60:
        attempts.popleft()
    if len(attempts) >= 5:
        raise HTTPException(429, "Troppi tentativi. Attendi un minuto.")
    attempts.append(now)
    if not secrets.compare_digest(body.token, access_token()):
        raise HTTPException(401, "Credenziale non valida")
    attempts.clear()
    payload = f"{int(time.time()) + 8 * 3600}.{secrets.token_hex(16)}"
    response.set_cookie(COOKIE, f"{payload}.{signature(payload)}", httponly=True,
                        secure=get_settings().auth_cookie_secure or request.url.scheme == "https", samesite="strict", path="/api", max_age=8 * 3600)
    return {"authenticated": True}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE, path="/api", samesite="strict")
    return {"authenticated": False}
