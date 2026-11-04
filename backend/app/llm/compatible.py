"""Opt-in OpenAI-compatible local/remote HTTP provider, with bounded SSE output."""
import json

import httpx

from app.llm.base import ChatMessage, LLMProvider, LLMProviderError, ModelInfo


class CompatibleProvider(LLMProvider):
    name = "compatible"

    def __init__(self, base_url: str, api_key: str = "", max_tokens: int = 512):
        self.base_url = base_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self.max_tokens = max_tokens

    async def list_models(self):
        try:
            async with httpx.AsyncClient(timeout=10, headers=self.headers) as client:
                response = await client.get(self.base_url + "/models")
                response.raise_for_status()
                return [ModelInfo(id=item["id"], label=item["id"]) for item in response.json()["data"]]
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise LLMProviderError("Provider compatibile non disponibile o risposta modelli non valida") from exc

    async def chat(self, messages: list[ChatMessage], model: str) -> str:
        return "".join([part async for part in self.chat_stream(messages, model)])

    async def chat_stream(self, messages: list[ChatMessage], model: str):
        body = {"model": model, "messages": [{"role": m.role, "content": m.content} for m in messages],
                "stream": True, "max_tokens": self.max_tokens}
        try:
            async with httpx.AsyncClient(timeout=120, headers=self.headers) as client:
                async with client.stream("POST", self.base_url + "/chat/completions", json=body) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if payload == "[DONE]":
                            return
                        chunk = json.loads(payload)
                        if "error" in chunk:
                            raise LLMProviderError("Il provider compatibile ha segnalato un errore")
                        for choice in chunk.get("choices", []):
                            if choice.get("finish_reason") == "length":
                                raise LLMProviderError("Risposta incompleta: limite token del provider compatibile")
                            text = choice.get("delta", {}).get("content")
                            if isinstance(text, str) and text:
                                yield text
        except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
            raise LLMProviderError("Errore nella comunicazione con il provider compatibile") from exc
