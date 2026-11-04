import json

import httpx
import pytest

from app.llm.base import ChatMessage, LLMProviderError
from app.llm.compatible import CompatibleProvider


async def test_models_and_streaming(monkeypatch):
    requests = []
    def respond(request):
        requests.append(request)
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "local-model"}]})
        return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"ciao"}}]}\n\ndata: [DONE]\n\n')
    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))
    provider = CompatibleProvider("http://local/v1", "test-key", 128)
    assert (await provider.list_models())[0].id == "local-model"
    assert await provider.chat([ChatMessage("user", "hello")], "local-model") == "ciao"
    assert json.loads(requests[-1].content)["max_tokens"] == 128
    assert requests[-1].headers["authorization"] == "Bearer test-key"


async def test_provider_failure_does_not_expose_key(monkeypatch):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(lambda _: httpx.Response(401)), **kwargs))
    with pytest.raises(LLMProviderError) as error:
        await CompatibleProvider("http://local/v1", "private-key").list_models()
    assert "private-key" not in str(error.value)


def test_provider_preference_and_agent_config_persist(client):
    assert "ollama" in client.get("/api/providers").json()
    assert client.put("/api/settings", json={"default_provider": "missing", "default_model": "x"}).status_code == 422
    changed = client.patch("/api/agents/coding", json={"model": "special-model", "memory_access": "none", "timeout_seconds": 30})
    assert changed.status_code == 200
    agent = next(a for a in client.get("/api/agents").json() if a["id"] == "coding")
    assert agent["model"] == "special-model" and agent["memory_access"] == "none"
