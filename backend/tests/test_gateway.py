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
