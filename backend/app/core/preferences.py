from app.core.config import get_settings
from app.db.models import AppSettings


def default_provider(db):
    row = db.get(AppSettings, "default_provider")
    return row.value if row else get_settings().default_llm_provider
