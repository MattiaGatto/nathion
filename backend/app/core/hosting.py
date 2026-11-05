"""Enforce current hosting grants at the shared compute boundary."""
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy.dialects.sqlite import insert
from app.core.identity import identity
from app.core.auth import database, principal
from app.db.models import User, UsageDay, UserSession


def current_principal():
    current = identity.get()
    if not current:
        raise HTTPException(401, "Accesso richiesto")
    if current.id == "owner" and not current.session_hash:
        return current
    with database() as db:
        user = db.get(User, current.id)
        if not user or user.status != "active":
            raise HTTPException(403, "Account non autorizzato")
        if current.session_hash:
            session = db.get(UserSession, current.session_hash)
            if not session or session.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
                raise HTTPException(401, "Sessione scaduta o revocata")
        return principal(user, current.operator)


def check_model(model, provider=None):
    current = current_principal()
    if not current.is_admin:
        if provider not in (None, "ollama") or (model is not None and model not in current.allowed_models):
            raise HTTPException(403, "Modello o provider non autorizzato dall'amministratore")
    return current


def authorize_compute(model=None, provider=None, charge=True):
    current = check_model(model, provider)
    if current.is_admin:
        return
    if not current.hosted_access:
        raise HTTPException(403, "Uso del server in attesa di approvazione")
    if not charge:
        return
    day = datetime.now(timezone.utc).date().isoformat()
    with database() as db:
        db.execute(insert(UsageDay).values(user_id=current.id, day=day, used=0).on_conflict_do_nothing())
        updated = db.query(UsageDay).filter_by(user_id=current.id, day=day).filter(UsageDay.used < current.daily_limit).update({UsageDay.used: UsageDay.used + 1})
        db.commit()
        if not updated:
            raise HTTPException(429, "Quota giornaliera esaurita. Ogni chiamata di un agente conta come richiesta.")
