from app.core.identity import identity, preference_key
from app.core.config import get_settings
from app.db.models import AppSettings


def default_provider(db):
    if identity.get() and not identity.get().is_admin:
        return "ollama"
    row = db.get(AppSettings, preference_key("default_provider"))
    return row.value if row else get_settings().default_llm_provider
