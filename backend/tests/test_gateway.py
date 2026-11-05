"""Verifica il contratto del gateway con un provider finto, senza
dipendere da un'istanza Ollama reale in esecuzione durante i test."""
from collections.abc import AsyncIterator

import pytest

from app.core.config import Settings
from app.llm.base import ChatMessage, LLMProvider, ModelInfo
from app.llm.gateway import LLMGateway


class FakeProvider(LLMProvider):
    name = "fake"

    async def list_models(self) -> list[ModelInfo]:
        return [ModelInfo(id="fake-model", label="Fake Model")]

    async def chat(self, messages: list[ChatMessage], model: str) -> str:
        return f"echo({model}): {messages[-1].content}"

    async def chat_stream(self, messages: list[ChatMessage], model: str) -> AsyncIterator[str]:
        for word in f"echo {messages[-1].content}".split():
            yield word + " "


@pytest.fixture()
def gateway_with_fake_provider():
    gateway = LLMGateway(Settings(default_llm_provider="fake"))
    gateway._providers["fake"] = FakeProvider()
    return gateway


async def test_chat_routes_to_selected_provider(gateway_with_fake_provider):
    reply = await gateway_with_fake_provider.chat(
        [ChatMessage(role="user", content="ciao")], model="fake-model", provider="fake"
    )
    assert reply == "echo(fake-model): ciao"


async def test_chat_stream_yields_chunks(gateway_with_fake_provider):
    chunks = [
        chunk
        async for chunk in gateway_with_fake_provider.chat_stream(
            [ChatMessage(role="user", content="ciao")], model="fake-model", provider="fake"
        )
    ]
    assert "".join(chunks).strip() == "echo ciao"


async def test_list_available_models(gateway_with_fake_provider):
    models = await gateway_with_fake_provider.list_available_models(provider="fake")
    assert models == [ModelInfo(id="fake-model", label="Fake Model")]


def test_unknown_provider_raises(gateway_with_fake_provider):
    with pytest.raises(ValueError):
        gateway_with_fake_provider.get_provider("does-not-exist")


async def test_ollama_request_has_resource_limits(monkeypatch):
    import httpx
    from app.llm.ollama_provider import OllamaProvider
    captured = []
    def handle(request):
        import json
        captured.append(json.loads(request.content))
        return httpx.Response(200, text='{"message":{"content":"ok"},"done":true}\n')
    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handle), **kwargs))
    provider = OllamaProvider("http://local", context_size=2048, max_output_tokens=128)
    assert await provider.chat([ChatMessage(role="user", content="test")], "test") == "ok"
    assert captured[0]["options"] == {"num_ctx": 2048, "num_predict": 128}


async def test_output_limit_is_not_reported_as_complete(monkeypatch):
    import httpx
    from app.llm.base import LLMProviderError
    from app.llm.ollama_provider import OllamaProvider
    real_client = httpx.AsyncClient
    transport = httpx.MockTransport(lambda _: httpx.Response(200, text='{"message":{"content":"partial"},"done":true,"done_reason":"length"}\n'))
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: real_client(transport=transport, **kwargs))
    from app.llm.base import OutputLimitError
    with pytest.raises(OutputLimitError, match="limite di risposta"):
        await OllamaProvider("http://local").chat([ChatMessage(role="user", content="test")], "test")


@pytest.mark.asyncio
async def test_ollama_proposals_use_schema_without_changing_normal_chat(monkeypatch):
    import json
    import httpx
    from app.api.proposals import PLAN_SCHEMA
    from app.llm.ollama_provider import OllamaProvider
    captured = []
    def handle(request):
        captured.append(json.loads(request.content))
        return httpx.Response(200, text='{"message":{"content":"{}"},"done":true,"done_reason":"stop"}\n')
    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handle), **kwargs))
    provider = OllamaProvider("http://local")
    await provider.chat_structured([], "model", PLAN_SCHEMA)
    await provider.chat([], "model")
    assert captured[0]["format"] == PLAN_SCHEMA
    assert captured[0]["options"]["temperature"] == 0
    assert "format" not in captured[1] and "temperature" not in captured[1]["options"]
    coding = next(item for item in PLAN_SCHEMA["properties"]["tasks"]["items"]["anyOf"] if item["properties"]["agent_id"]["enum"] == ["coding"])
    assert coding["properties"]["tool"] == {"type": "null"}
