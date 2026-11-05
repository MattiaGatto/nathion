"""
Configurazione centralizzata dell'applicazione.

Tutte le impostazioni sono lette da variabili d'ambiente (12-factor),
con default sensati per lo sviluppo locale. Vedi `.env.example` nella
root del repo per l'elenco completo.
"""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import BaseModel, Field, SecretStr, HttpUrl


class MCPConnection(BaseModel):
    url: HttpUrl
    allowed_tools: list[str] = Field(default_factory=list, max_length=50)
    headers: dict[str, SecretStr] = {}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="NATHION_", extra="ignore")

    # --- App ---
    app_name: str = "NATHION"
    environment: str = "development"  # development | production
    log_level: str = "INFO"
    voice_enabled: bool = False
    whisper_model_path: str = "./models/whisper"
    piper_model_path: str = "./models/voice.onnx"
    voice_language: str = "it"
    voice_profiles: dict[str, str] = {}
    admin_username: str = Field(default="mattia", pattern=r"^[a-z0-9][a-z0-9_.-]{2,31}$")
    admin_display_name: str = "Mattia"
    admin_email: str = ""
    personal_mode: bool = True
    oauth_origin: str = "http://localhost:4173"
    google_client_id: str = ""
    google_client_secret: SecretStr = SecretStr("")
    google_admin_subject: str = ""
    github_client_id: str = ""
    github_client_secret: SecretStr = SecretStr("")
    github_admin_id: str = ""
    auth_enabled: bool = True
    auth_token_file: str = "./data/access-token.txt"
    auth_cookie_secure: bool = False
    compatible_base_url: str = ""
    compatible_api_key: SecretStr = SecretStr("")
    memory_embedding_model: str = ""
    mcp_servers: dict[str, MCPConnection] = {}

    # --- Database ---
    # SQLite file-based per questa milestone. Path assoluto per evitare
    # ambiguità quando il processo gira dentro un container.
    database_url: str = "sqlite:///./data/nathion.db"

    # --- LLM Gateway ---
    # Provider di default selezionabile dall'utente a runtime (vedi
    # app.db.models.Settings), questo è solo il fallback iniziale.
    default_llm_provider: str = "ollama"
    default_llm_model: str = ""  # vuoto = nessun default forzato, si sceglie dalla UI

    # --- Ollama ---
    # In Docker su Windows/Mac con Docker Desktop, "host.docker.internal"
    # risolve all'host che fa girare Ollama. Su Linux nativo va sostituito
    # con l'IP del bridge Docker o con network_mode: host (vedi README).
    ollama_base_url: str = "http://host.docker.internal:11434"
    ollama_request_timeout_seconds: int = 120
    ollama_context_size: int = Field(default=2048, ge=512, le=131072)
    ollama_max_output_tokens: int = Field(default=512, ge=16, le=8192)

    # --- CORS ---
    cors_allow_origins: list[str] = ["http://localhost:5173", "http://localhost:4173"]

    @property
    def data_dir(self) -> Path:
        path = Path("./data")
        path.mkdir(parents=True, exist_ok=True)
        return path


@lru_cache
def get_settings() -> Settings:
    return Settings()
