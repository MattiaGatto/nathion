import httpx

from app.core.config import get_settings
from app import memory
from app.db.models import MemoryVector


def test_semantic_match_without_shared_words_and_delete_cleanup(client, db_session, monkeypatch):
    monkeypatch.setattr(get_settings(), "memory_embedding_model", "local-embed")
    async def encode(text):
        return [1.0, 0.0] if text in {"automobile", "veicolo"} else [0.0, 1.0]
    monkeypatch.setattr(memory, "embedding", encode)
    note = client.post("/api/memory", json={"content": "automobile"}).json()
    response = client.get("/api/memory?q=veicolo")
    assert response.headers["X-Memory-Retrieval"] == "hybrid"
    assert response.json()[0]["id"] == note["id"]
    client.delete("/api/memory/" + note["id"])
    assert db_session.query(MemoryVector).count() == 0


def test_embedding_outage_has_explicit_lexical_fallback(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "memory_embedding_model", "local-embed")
    async def working(_):
        return [1.0, 0.0]
    monkeypatch.setattr(memory, "embedding", working)
    client.post("/api/memory", json={"content": "PostgreSQL"})
    async def failing(_):
        raise httpx.ConnectError("offline")
    monkeypatch.setattr(memory, "embedding", failing)
    response = client.get("/api/memory?q=PostgreSQL")
    assert response.headers["X-Memory-Retrieval"] == "bm25-fallback"
    assert len(response.json()) == 1
