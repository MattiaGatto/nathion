"""Optional administrator sign-in, pinned to provider account IDs."""
import base64
import hashlib
import hmac
import secrets
import time
from urllib.parse import urlencode, urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.auth import access_token, ensure_owner, set_session
from app.core.config import get_settings
from app.db.session import get_db

router = APIRouter(prefix="/api/auth/oauth", tags=["auth"])
COOKIE = "nathion_oauth"
LIFETIME = 600
PROVIDERS = {
    "google": (
        "https://accounts.google.com/o/oauth2/v2/auth",
        "https://oauth2.googleapis.com/token",
        "https://openidconnect.googleapis.com/v1/userinfo",
        "openid", "sub",
    ),
    "github": (
        "https://github.com/login/oauth/authorize",
        "https://github.com/login/oauth/access_token",
        "https://api.github.com/user",
        "", "id",
    ),
}


def credentials(provider):
    settings = get_settings()
    if provider == "google":
        return settings.google_client_id, settings.google_client_secret.get_secret_value(), settings.google_admin_subject
    return settings.github_client_id, settings.github_client_secret.get_secret_value(), settings.github_admin_id


def origin_for(request):
    settings = get_settings()
    origin = settings.oauth_origin.rstrip("/")
    url = urlsplit(origin)
    secure = url.scheme == "https" or (url.scheme == "http" and url.hostname == "localhost")
    if (settings.auth_enabled and secure and origin in settings.cors_allow_origins
            and not (url.username or url.password or url.path or url.query or url.fragment)
            and url.netloc == request.url.netloc):
        return origin
    return ""


def available_providers(request):
    if not origin_for(request):
        return []
    return [name for name in PROVIDERS if all(credentials(name))]


def signature(payload):
    return hmac.new(access_token().encode(), payload.encode(), hashlib.sha256).hexdigest()


@router.get("/{provider}/start")
def start(provider: str, request: Request):
    if provider not in available_providers(request):
        raise HTTPException(404, "Accesso esterno non configurato")
    origin = origin_for(request)
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    payload = f"{provider}.{state}.{verifier}.{int(time.time()) + LIFETIME}"
    authorize_url, _, _, scope, _ = PROVIDERS[provider]
    params = {
        "client_id": credentials(provider)[0],
        "redirect_uri": f"{origin}/api/auth/oauth/{provider}/callback",
        "response_type": "code", "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256",
    }
    if scope:
        params["scope"] = scope
    response = RedirectResponse(f"{authorize_url}?{urlencode(params)}", status_code=303)
    response.set_cookie(COOKIE, f"{payload}.{signature(payload)}", max_age=LIFETIME,
                        httponly=True, samesite="lax", secure=origin.startswith("https:"),
                        path="/api/auth/oauth")
    return response


@router.get("/{provider}/callback")
def callback(provider: str, request: Request, db: Session = Depends(get_db)):
    if provider not in available_providers(request):
        raise HTTPException(404, "Accesso esterno non configurato")
    origin = origin_for(request)
    response = RedirectResponse(f"{origin}/#accesso-esterno-fallito", status_code=303)
    response.delete_cookie(COOKIE, path="/api/auth/oauth", secure=origin.startswith("https:"), samesite="lax")
    response.headers["Referrer-Policy"] = "no-referrer"
    code = request.query_params.get("code", "")
    state = request.query_params.get("state", "")
    payload, _, signed = request.cookies.get(COOKIE, "").rpartition(".")
    if not code or not state.isascii() or not payload or not signed.isascii() or not hmac.compare_digest(signature(payload), signed):
        return response
    saved_provider, saved_state, verifier, expiry = payload.split(".")
    if saved_provider != provider or not hmac.compare_digest(state, saved_state) or time.time() >= int(expiry):
        return response

    client_id, client_secret, admin_id = credentials(provider)
    _, token_url, user_url, _, id_field = PROVIDERS[provider]
    try:
        with httpx.Client(timeout=10, headers={"Accept": "application/json"}) as client:
            token = client.post(token_url, data={
                "grant_type": "authorization_code", "code": code,
                "client_id": client_id, "client_secret": client_secret,
                "redirect_uri": f"{origin}/api/auth/oauth/{provider}/callback",
                "code_verifier": verifier,
            }).raise_for_status().json()["access_token"]
            info = client.get(user_url, headers={"Authorization": f"Bearer {token}"}).raise_for_status().json()
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return response
    if not isinstance(info, dict) or str(info.get(id_field, "")) != admin_id:
        return response
    owner = ensure_owner(db)
    if owner.status != "active" or owner.must_change_password:
        return response
    set_session(owner, request, response, db)
    response.headers["location"] = f"{origin}/"
    return response
