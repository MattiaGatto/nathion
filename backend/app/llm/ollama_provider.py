"""
Provider LLM per Ollama (locale).

Usa l'API HTTP nativa di Ollama:
- GET  /api/tags   -> elenco modelli scaricati localmente
- POST /api/chat   -> chat completion (con stream: true/false)

Documentazione: https://github.com/ollama/ollama/blob/main/docs/api.md
"""
import json
import logging
from collections.abc import AsyncIterator

import httpx

from app.llm.base import ChatMessage, LLMProvider, LLMProviderError, ModelInfo, OutputLimitError

logger = logging.getLogger(__name__)


class OllamaProvider(LLMProvider):
    name = "ollama"

    def __init__(self, base_url: str, timeout_seconds: int = 120, context_size: int = 2048, max_output_tokens: int = 512) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_seconds
        self._options = {"num_ctx": context_size, "num_predict": max_output_tokens}

    async def list_models(self) -> list[ModelInfo]:
        url = f"{self._base_url}/api/tags"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(url)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("Impossibile contattare Ollama su %s: %s", url, exc)
            raise LLMProviderError(
                f"Ollama non raggiungibile su {self._base_url}. "
                "Verifica che sia in esecuzione e che l'URL sia corretto "
                "(NATHION_OLLAMA_BASE_URL)."
            ) from exc

        payload = response.json()
        return [
            ModelInfo(
                id=model["name"],
                label=model["name"],
                size_bytes=model.get("size"),
            )
            for model in payload.get("models", [])
        ]

    async def chat(self, messages: list[ChatMessage], model: str) -> str:
        chunks = [chunk async for chunk in self.chat_stream(messages, model)]
        return "".join(chunks)

    async def chat_structured(self, messages: list[ChatMessage], model: str, schema: dict) -> str:
        return "".join([chunk async for chunk in self.chat_stream(messages, model, response_format=schema)])

    async def chat_stream(self, messages: list[ChatMessage], model: str, response_format: dict | None = None) -> AsyncIterator[str]:
        url = f"{self._base_url}/api/chat"
        body = {
            "model": model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": True,
            "options": self._options,
        }

        if response_format is not None:
            body["format"] = response_format
            body["options"] = {**self._options, "temperature": 0}

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                async with client.stream("POST", url, json=body) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        data = json.loads(line)
                        if error := data.get("error"):
                            raise LLMProviderError(f"Errore da Ollama: {error}")
                        content = data.get("message", {}).get("content", "")
                        if content:
                            yield content
                        if data.get("done"):
                            if data.get("done_reason") == "length":
                                raise OutputLimitError("Il modello ha raggiunto il limite di risposta. Chiedi una parte più breve o specifica della richiesta.")
                            break
        except httpx.HTTPError as exc:
            logger.warning("Errore chiamando Ollama su %s: %s", url, exc)
            raise LLMProviderError(
                f"Ollama non raggiungibile su {self._base_url}, oppure il "
                f"modello '{model}' non e' installato (prova 'ollama pull {model}')."
            ) from exc
