from app.core.identity import identity, preference_key
from app.core.hosting import check_model
"""
Endpoint per il selettore modello nelle impostazioni.

- GET  /api/models            -> modelli Ollama attualmente disponibili
- GET  /api/settings          -> provider/modello di default salvato
- PUT  /api/settings          -> salva la scelta dell'utente
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.models import AppSettings
from app.db.session import get_db
from app.llm.base import LLMProviderError
from app.llm.gateway import LLMGateway, get_gateway
from app.schemas.chat import ModelOut, SettingsIn, SettingsOut
from app.core.preferences import default_provider

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["models"])

_SETTINGS_PROVIDER_KEY = "default_provider"
_SETTINGS_MODEL_KEY = "default_model"


@router.get("/models", response_model=list[ModelOut])
async def list_models(provider: str | None = None, db: Session = Depends(get_db), gateway: LLMGateway = Depends(get_gateway)) -> list[ModelOut]:
    """Interroga Ollama per i modelli scaricati localmente, cosi' la UI
    puo' mostrare solo cio' che l'utente ha davvero a disposizione invece
    di un elenco statico che potrebbe non corrispondere."""
    try:
        models = await gateway.list_available_models(provider=provider or default_provider(db))
    except (LLMProviderError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    current = identity.get()
    return [ModelOut(id=m.id, label=m.label, size_bytes=m.size_bytes) for m in models if current.is_admin or m.id in current.allowed_models]


@router.get("/providers")
def providers(gateway: LLMGateway = Depends(get_gateway)):
    return list(gateway._providers) if identity.get().is_admin else ["ollama"]


@router.get("/settings", response_model=SettingsOut)
async def get_settings_endpoint(db: Session = Depends(get_db)) -> SettingsOut:
    provider_row = db.get(AppSettings, preference_key(_SETTINGS_PROVIDER_KEY))
    model_row = db.get(AppSettings, preference_key(_SETTINGS_MODEL_KEY))
    return SettingsOut(
        default_provider=default_provider(db),
        default_model=model_row.value if model_row else None,
    )


@router.put("/settings", response_model=SettingsOut)
async def update_settings(body: SettingsIn, db: Session = Depends(get_db), gateway: LLMGateway = Depends(get_gateway)) -> SettingsOut:
    check_model(body.default_model, body.default_provider)
    if body.default_provider not in gateway._providers:
        raise HTTPException(422, "Provider non configurato")
    for key, value in (
        (_SETTINGS_PROVIDER_KEY, body.default_provider),
        (_SETTINGS_MODEL_KEY, body.default_model),
    ):
        key = preference_key(key)
        row = db.get(AppSettings, key)
        if row is None:
            row = AppSettings(key=key, value=value)
            db.add(row)
        else:
            row.value = value
    db.commit()
    logger.info("Impostazioni aggiornate: provider=%s model=%s", body.default_provider, body.default_model)
    return SettingsOut(default_provider=body.default_provider, default_model=body.default_model)
