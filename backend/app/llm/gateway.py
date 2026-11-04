"""
LLM Gateway.

Punto unico da cui il resto dell'applicazione chiede "parlami con un
modello": sceglie il provider configurato, espone l'elenco dei modelli
disponibili (per il selettore nelle impostazioni, come richiesto) e
inoltra le chiamate di chat.

Aggiungere un nuovo provider in futuro = registrarlo in `_PROVIDERS`,
nessun altro file da toccare.
"""
import logging
from collections.abc import AsyncIterator

from app.core.config import Settings, get_settings
from app.llm.base import ChatMessage, LLMProvider, ModelInfo
from app.llm.ollama_provider import OllamaProvider
from app.llm.compatible import CompatibleProvider

logger = logging.getLogger(__name__)


class LLMGateway:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._providers: dict[str, LLMProvider] = {
            "ollama": OllamaProvider(
                base_url=settings.ollama_base_url,
                timeout_seconds=settings.ollama_request_timeout_seconds,
                context_size=settings.ollama_context_size,
                max_output_tokens=settings.ollama_max_output_tokens,
            ),
            # Futuri provider (Milestone successive o on-demand):
            # "lmstudio": LMStudioProvider(...),
            # "openai": OpenAIProvider(...),
        }
        if settings.compatible_base_url:
            self._providers["compatible"] = CompatibleProvider(settings.compatible_base_url,
                settings.compatible_api_key.get_secret_value(), settings.ollama_max_output_tokens)

    def get_provider(self, name: str | None = None) -> LLMProvider:
        provider_name = name or self._settings.default_llm_provider
        try:
            return self._providers[provider_name]
        except KeyError as exc:
            raise ValueError(
                f"Provider LLM '{provider_name}' sconosciuto. "
                f"Disponibili: {list(self._providers)}"
            ) from exc

    async def list_available_models(self, provider: str | None = None) -> list[ModelInfo]:
        return await self.get_provider(provider).list_models()

    async def chat(
        self, messages: list[ChatMessage], model: str, provider: str | None = None
    ) -> str:
        return await self.get_provider(provider).chat(messages, model)

    async def chat_stream(
        self, messages: list[ChatMessage], model: str, provider: str | None = None
    ) -> AsyncIterator[str]:
        async for chunk in self.get_provider(provider).chat_stream(messages, model):
            yield chunk


_gateway: LLMGateway | None = None


def get_gateway() -> LLMGateway:
    """Dependency FastAPI: singleton del gateway per tutta la vita del
    processo (i provider mantengono solo config, nessuno stato pesante)."""
    global _gateway
    if _gateway is None:
        _gateway = LLMGateway(get_settings())
    return _gateway
