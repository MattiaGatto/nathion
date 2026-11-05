"""
Interfaccia astratta per un provider LLM.

Principio "provider-agnostic" (costituzione NATHION §3.2): nessun punto
del codice applicativo deve dipendere direttamente da Ollama, OpenAI, ecc.
Tutto passa attraverso questa interfaccia, cosi' aggiungere un nuovo
provider (LM Studio, vLLM, OpenAI...) significa implementare questa
classe, non toccare orchestratore/API.
"""
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass


@dataclass
class ChatMessage:
    role: str  # "user" | "assistant" | "system"
    content: str


@dataclass
class ModelInfo:
    """Un modello disponibile per questo provider, cosi' come mostrato
    nelle impostazioni del frontend."""

    id: str  # identificatore da passare al provider (es. "llama3.1:8b")
    label: str  # nome leggibile in UI
    size_bytes: int | None = None


class LLMProvider(ABC):
    """Contratto che ogni provider deve rispettare."""

    name: str

    @abstractmethod
    async def list_models(self) -> list[ModelInfo]:
        """Modelli attualmente disponibili per questo provider (es.
        interrogando `GET /api/tags` di Ollama). Usato per popolare il
        selettore modello nelle impostazioni."""

    @abstractmethod
    async def chat(self, messages: list[ChatMessage], model: str) -> str:
        """Risposta completa (non in streaming)."""

    async def chat_structured(self, messages: list[ChatMessage], model: str, schema: dict) -> str:
        """Fallback for providers without constrained decoding; callers still validate."""
        return await self.chat(messages, model)

    @abstractmethod
    async def chat_stream(self, messages: list[ChatMessage], model: str) -> AsyncIterator[str]:
        """Risposta in streaming, un chunk di testo alla volta. Usata dal
        WebSocket della chat."""


class LLMProviderError(RuntimeError):
    """Sollevata quando il provider non e' raggiungibile o risponde con
    un errore. L'API la traduce in un messaggio chiaro per l'utente
    invece di un 500 generico."""


class OutputLimitError(LLMProviderError):
    """The provider stopped before completing the response."""
