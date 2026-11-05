from fastapi import HTTPException
from app.core.hosting import compute_slot
"""Optional local vectors, with explicit lexical fallback and bounded RRF retrieval."""
import json
import math

import httpx

from app.core.config import get_settings
from app.db.models import Memory, MemoryVector


async def embedding(text: str) -> list[float]:
    settings = get_settings()
    with compute_slot(None, "ollama"):
        return await _embedding_request(text, settings)


async def _embedding_request(text, settings):
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(settings.ollama_base_url.rstrip("/") + "/api/embed", json={
            "model": settings.memory_embedding_model, "input": text[:8000], "truncate": True,
            "keep_alive": "0"})
        response.raise_for_status()
        vector = response.json()["embeddings"][0]
    if not isinstance(vector, list) or not 1 <= len(vector) <= 4096:
        raise ValueError("Dimensione embedding non valida")
    values = [float(value) for value in vector]
    norm = math.sqrt(sum(value * value for value in values))
    if not math.isfinite(norm) or norm == 0:
        raise ValueError("Embedding non valido")
    return [value / norm for value in values]


async def index_memory(db, memory: Memory) -> bool:
    model = get_settings().memory_embedding_model
    if not model:
        return False
    current = db.query(MemoryVector).filter_by(memory_id=memory.id).first()
    if current and current.model == model:
        return True
    try:
        vector = await embedding(memory.content)
    except (HTTPException, httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
        return False
    if current is None:
        current = MemoryVector(memory_id=memory.id, model=model, embedding="[]")
        db.add(current)
    current.model = model
    current.embedding = json.dumps(vector)
    db.commit()
    return True


async def retrieve_context(db, query: str, lexical, limit: int = 5):
    model = get_settings().memory_embedding_model
    candidates = db.query(Memory, MemoryVector).join(MemoryVector).filter(MemoryVector.model == model).order_by(Memory.created_at.desc()).limit(1000).all() if model else []
    if not candidates:
        return lexical[:limit], "bm25"
    try:
        query_vector = await embedding(query)
    except (HTTPException, httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
        return lexical[:limit], "bm25-fallback"
    semantic = []
    for memory, vector in candidates:
        values = json.loads(vector.embedding)
        if len(values) == len(query_vector):
            similarity = sum(a * b for a, b in zip(values, query_vector))
            if similarity >= 0.4:
                semantic.append((similarity, memory))
    ranked = [memory for _, memory in sorted(semantic, key=lambda item: item[0], reverse=True)]
    scores, rows = {}, {}
    for order in [lexical, ranked]:
        for rank, memory in enumerate(order[:30]):
            scores[memory.id] = scores.get(memory.id, 0) + 1 / (60 + rank + 1)
            rows[memory.id] = memory
    result = [rows[key] for key in sorted(scores, key=scores.get, reverse=True)[:limit]]
    return result, "hybrid"
