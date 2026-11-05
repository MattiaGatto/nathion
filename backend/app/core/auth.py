"""Local accounts with explicit hosting grants and revocable browser sessions."""
import hashlib
import json
import secrets
import time
from collections import defaultdict, deque
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from http.cookies import CookieError, SimpleCookie
from pathlib import Path
from threading import BoundedSemaphore

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.core.config import get_settings
from app.core.identity import Principal, identity, database_provider
from app.db.models import User, UserSession, Invitation
from app.db.session import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])
COOKIE = "nathion_session"
_attempts = defaultdict(deque)
_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
_slots = BoundedSemaphore(2)
_dummy = _hasher.hash(secrets.token_urlsafe(32))

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def hash_password(value):
    with _slots:
        return _hasher.hash(value)

def verify_password(encoded, value):
    with _slots:
        try:
            return _hasher.verify(encoded, value)
        except (VerificationError, InvalidHashError):
            return False

def access_token():
    return Path(get_settings().auth_token_file).read_text(encoding="utf-8").strip()

def initialize_auth():
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

def ensure_owner(db):
    user = db.get(User, "owner")
    if user:
        return user
    path = Path(get_settings().auth_token_file).with_name("admin-initial-password.txt")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        password = path.read_text(encoding="utf-8").strip()
    else:
        password = secrets.token_urlsafe(24)
        with path.open("x", encoding="utf-8") as file:
            file.write(password)
        path.chmod(0o600)
    user = User(id="owner", username=get_settings().admin_username, display_name=get_settings().admin_display_name,
                password_hash=hash_password(password), role="admin", status="active", hosted_access=True, must_change_password=True)
    db.add(user); db.commit()
    return user

@contextmanager
def database(factory=None):
    generator = (factory or database_provider.get() or get_db)()
    try:
        yield next(generator)
    finally:
        generator.close()

def cookie_token(headers):
    try:
        cookies = SimpleCookie(); cookies.load(headers.get("cookie", ""))
        return cookies[COOKIE].value
    except (CookieError, KeyError):
        return ""

def principal(user, operator=False, session_hash=""):
    return Principal(id=user.id, username=user.username, display_name=user.display_name, role=user.role,
        hosted_access=user.hosted_access, allowed_models=tuple(json.loads(user.allowed_models)), daily_limit=user.daily_limit,
        must_change_password=user.must_change_password, operator=operator, session_hash=session_hash)

def resolve(headers, db):
    if not get_settings().auth_enabled:
        return Principal()
    authorization = headers.get("authorization", "")
    if authorization.startswith("Bearer ") and secrets.compare_digest(authorization[7:], access_token()):
        return principal(ensure_owner(db), True)
    token = cookie_token(headers)
    session = db.get(UserSession, digest(token)) if token else None
    if not session or session.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
        return None
    user = db.get(User, session.user_id)
    return principal(user, session.operator, session.token_hash) if user and user.status == "active" else None

class AuthenticationMiddleware:
    def __init__(self, app):
        self.app = app
    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"} or not scope.get("path", "").startswith("/api/"):
            return await self.app(scope, receive, send)
        factory = scope["app"].dependency_overrides.get(get_db, get_db)
        provider_marker = database_provider.set(factory)
        marker = identity.set(None)
        try:
            headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
            mutation = scope["type"] == "websocket" or scope.get("method") not in {"GET", "HEAD", "OPTIONS"}
            path = scope["path"]
            public = path in {"/api/auth/status", "/api/auth/login", "/api/auth/register"} or scope.get("method") == "OPTIONS"
            with database(factory) as db:
                current = resolve(headers, db)
            identity.set(current)
            code, detail = 0, ""
            if mutation and headers.get("origin") and headers["origin"] not in get_settings().cors_allow_origins:
                code, detail = 403, "Origine non autorizzata"
            elif not public and not current:
                code, detail = 401, "Accesso richiesto"
            elif not public and current:
                if current.must_change_password and not current.operator and path not in {"/api/auth/password", "/api/auth/logout"}:
                    code, detail = 403, "Cambia la password iniziale"
                elif not current.is_admin and (path.startswith("/api/auth/admin") or path.startswith("/api/tools") or path.startswith("/api/schedules")):
                    code, detail = 403, "Funzione riservata all'amministratore"
            if not code:
                return await self.app(scope, receive, send)
            if scope["type"] == "websocket":
                return await send({"type": "websocket.close", "code": 4401 if code == 401 else 4403})
            await Response(json.dumps({"detail": detail}), status_code=code, media_type="application/json")(scope, receive, send)
        finally:
            identity.reset(marker); database_provider.reset(provider_marker)

def user_out(user):
    return {"id": user.id, "username": user.username, "display_name": user.display_name, "role": user.role,
            "status": user.status, "hosted_access": user.hosted_access, "allowed_models": json.loads(user.allowed_models),
            "daily_limit": user.daily_limit, "must_change_password": user.must_change_password}

def set_session(user, request, response, db, operator=False):
    token = secrets.token_urlsafe(32)
    db.query(UserSession).filter(UserSession.expires_at < datetime.now(timezone.utc)).delete(synchronize_session=False)
    db.add(UserSession(token_hash=digest(token), user_id=user.id,
                       expires_at=datetime.now(timezone.utc) + timedelta(hours=8), operator=operator))
    db.commit()
    response.set_cookie(COOKIE, token, httponly=True, secure=get_settings().auth_cookie_secure or request.url.scheme == "https",
                        samesite="strict", path="/api", max_age=8 * 3600)

def throttle(request):
    now = time.monotonic()
    if len(_attempts) > 2048:
        for key in list(_attempts):
            if not _attempts[key] or _attempts[key][-1] < now - 60:
                del _attempts[key]
        if len(_attempts) > 2048:
            raise HTTPException(429, "Riprova tra un minuto")
    attempts = _attempts[request.client.host if request.client else "local"]
    while attempts and attempts[0] < now - 60:
        attempts.popleft()
    if len(attempts) >= 5:
        raise HTTPException(429, "Troppi tentativi. Attendi un minuto.")
    attempts.append(now)

class LoginIn(BaseModel):
    username: str = Field(default="", max_length=32)
    password: str = Field(default="", max_length=200)
    token: str = Field(default="", max_length=200)
class PasswordIn(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: str = Field(min_length=12, max_length=200)
class RegisterIn(BaseModel):
    invitation: str = Field(min_length=20, max_length=200)
    username: str = Field(pattern=r"^[a-z0-9][a-z0-9_.-]{2,31}$")
    display_name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=12, max_length=200)

@router.get("/status")
def status():
    current = identity.get()
    return {"enabled": get_settings().auth_enabled, "authenticated": current is not None,
            "user": {key: value for key, value in current.__dict__.items() if key not in {"session_hash", "operator"}} if current else None}

@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    throttle(request)
    owner = ensure_owner(db)
    operator = bool(body.token) and secrets.compare_digest(body.token, access_token())
    user = owner if operator else db.query(User).filter_by(username=body.username.lower()).first()
    valid = operator or verify_password(user.password_hash if user else _dummy, body.password)
    if not valid or not user or user.status != "active":
        raise HTTPException(401, "Credenziali non valide o account in attesa di approvazione")
    set_session(user, request, response, db, operator)
    return {"authenticated": True, "user": user_out(user)}

@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    db.query(UserSession).filter_by(token_hash=digest(cookie_token(request.headers))).delete(); db.commit()
    response.delete_cookie(COOKIE, path="/api", samesite="strict")
    return {"authenticated": False}

@router.post("/password")
def password(body: PasswordIn, request: Request, response: Response, db: Session = Depends(get_db)):
    throttle(request)
    user = db.get(User, identity.get().id)
    if not user or not verify_password(user.password_hash, body.current_password):
        raise HTTPException(401, "Password attuale non valida")
    if body.new_password == body.current_password:
        raise HTTPException(422, "Scegli una nuova password")
    user.password_hash = hash_password(body.new_password); user.must_change_password = False
    db.query(UserSession).filter_by(user_id=user.id).delete(); db.commit()
    set_session(user, request, response, db)
    if user.id == "owner":
        Path(get_settings().auth_token_file).with_name("admin-initial-password.txt").unlink(missing_ok=True)
    return {"changed": True}

@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    throttle(request)
    invitation = db.query(Invitation).filter_by(token_hash=digest(body.invitation)).first()
    now = datetime.now(timezone.utc)
    if not invitation or invitation.revoked or invitation.used_by or invitation.expires_at.replace(tzinfo=timezone.utc) <= now:
        raise HTTPException(400, "Invito non valido o scaduto")
    user = User(username=body.username, display_name=body.display_name, password_hash=hash_password(body.password))
    try:
        db.add(user); db.flush()
        claimed = db.query(Invitation).filter_by(id=invitation.id, revoked=False, used_by=None).filter(Invitation.expires_at > now).update({"used_by": user.id}, synchronize_session=False)
        if not claimed:
            db.rollback(); raise HTTPException(409, "Invito già utilizzato")
        db.commit()
    except IntegrityError:
        db.rollback(); raise HTTPException(409, "Nome utente non disponibile")
    return {"status": "pending", "detail": "Account creato. Attendi l'approvazione dell'amministratore."}

class InviteIn(BaseModel):
    label: str = Field(min_length=1, max_length=100)
    days: int = Field(default=7, ge=1, le=30)
class UserPatch(BaseModel):
    status: str = Field(pattern="^(pending|active|disabled)$")
    hosted_access: bool = False
    allowed_models: list[str] = Field(default_factory=list, max_length=50)
    daily_limit: int = Field(default=50, ge=0, le=1000)

@router.get("/admin/users")
def users(db: Session = Depends(get_db)):
    return [user_out(row) for row in db.query(User).order_by(User.created_at).all()]

@router.patch("/admin/users/{user_id}")
def update_user(user_id: str, body: UserPatch, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Account non trovato")
    if user.id == "owner":
        raise HTTPException(409, "L'amministratore principale non può essere sospeso o limitato")
    if any(not model.strip() or len(model) > 200 for model in body.allowed_models):
        raise HTTPException(422, "Modello non valido")
    user.status = body.status; user.hosted_access = body.hosted_access
    user.allowed_models = json.dumps(sorted(set(body.allowed_models))); user.daily_limit = body.daily_limit
    db.query(UserSession).filter_by(user_id=user.id).delete(); db.commit()
    return user_out(user)

@router.get("/admin/invitations")
def invitations(db: Session = Depends(get_db)):
    return [{"id": row.id, "label": row.label, "expires_at": row.expires_at, "revoked": row.revoked, "used": row.used_by is not None}
            for row in db.query(Invitation).order_by(Invitation.expires_at.desc()).limit(100)]

@router.post("/admin/invitations", status_code=201)
def invite(body: InviteIn, db: Session = Depends(get_db)):
    token = secrets.token_urlsafe(32)
    row = Invitation(token_hash=digest(token), label=body.label, expires_at=datetime.now(timezone.utc) + timedelta(days=body.days))
    db.add(row); db.commit(); db.refresh(row)
    return {"id": row.id, "token": token, "expires_at": row.expires_at}

@router.delete("/admin/invitations/{invite_id}", status_code=204)
def revoke_invitation(invite_id: str, db: Session = Depends(get_db)):
    row = db.get(Invitation, invite_id)
    if not row:
        raise HTTPException(404, "Invito non trovato")
    row.revoked = True; db.commit()

class ConfirmIn(BaseModel):
    confirmation: str = Field(max_length=32)


@router.get("/usage")
def usage(db: Session = Depends(get_db)):
    from app.db.models import UsageDay
    current = identity.get()
    day = datetime.now(timezone.utc).date().isoformat()
    row = db.get(UsageDay, (current.id, day))
    return {"day": day, "used": row.used if row else 0, "limit": None if current.is_admin else current.daily_limit}


@router.post("/admin/users/{user_id}/password")
def reset_password(user_id: str, body: ConfirmIn, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user or user.username != body.confirmation:
        raise HTTPException(400, "Conferma il nome utente")
    if user_id == "owner" and not identity.get().operator:
        raise HTTPException(403, "Il recupero dell'amministratore richiede la chiave operatore sul PC")
    temporary = secrets.token_urlsafe(24)
    user.password_hash = hash_password(temporary); user.must_change_password = True
    db.query(UserSession).filter_by(user_id=user_id).delete(); db.commit()
    return {"temporary_password": temporary, "must_change_password": True}


@router.get("/admin/users/{user_id}/export")
def export_user(user_id: str, db: Session = Depends(get_db)):
    from app.api.workspace import export_data
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Account non trovato")
    marker = identity.set(principal(user))
    try:
        return export_data(db)
    finally:
        identity.reset(marker)


@router.post("/admin/users/{user_id}/erase-data")
def erase_user_data(user_id: str, body: ConfirmIn, db: Session = Depends(get_db)):
    from app.db.models import Conversation, Message, Memory, MemoryVector, Run, ToolAction, Schedule, AppSettings, UsageDay
    from app.core.identity import preference_key
    user = db.get(User, user_id)
    if not user or user.username != body.confirmation:
        raise HTTPException(400, "Conferma il nome utente")
    if user.id == "owner" or user.status != "disabled":
        raise HTTPException(409, "La cancellazione richiede un account ospite sospeso")
    marker = identity.set(principal(user))
    try:
        if db.query(Run).filter_by(status="running").count():
            raise HTTPException(409, "Attendi la conclusione delle attività in corso")
        db.query(UserSession).filter_by(user_id=user_id).delete()
        for model in (MemoryVector, Message, Conversation, Memory, ToolAction, Schedule, Run):
            db.query(model).delete(synchronize_session=False)
        # Explicit prefix, without SQL LIKE wildcards supplied by a caller.
        prefix = f"user:{user_id}:"
        for row in db.query(AppSettings).all():
            if row.key.startswith(prefix):
                db.delete(row)
        db.query(UsageDay).filter_by(user_id=user_id).delete(); db.commit()
        return {"erased": True}
    finally:
        identity.reset(marker)
