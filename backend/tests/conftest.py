"""Fixture condivise per i test. Usa un DB SQLite in-memory separato da
quello di sviluppo, cosi' i test non toccano mai data/nathion.db, e un
gateway LLM finto, cosi' i test non dipendono da un'istanza Ollama reale
in esecuzione."""
from collections.abc import AsyncIterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models import Base
from app.db.session import get_db
from app.llm.base import ChatMessage, LLMProvider, ModelInfo
from app.llm.gateway import LLMGateway, get_gateway
from app.main import app


class StubProvider(LLMProvider):
    name = "stub"

    async def list_models(self) -> list[ModelInfo]:
        return [ModelInfo(id="stub-model", label="Stub Model")]

    async def chat(self, messages: list[ChatMessage], model: str) -> str:
        return f"risposta di test per: {messages[-1].content}"

    async def chat_stream(self, messages: list[ChatMessage], model: str) -> AsyncIterator[str]:
        for word in f"risposta di test per: {messages[-1].content}".split():
            yield word + " "


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db_session):
    def override_get_db():
        yield db_session

    def override_get_gateway():
        gateway = LLMGateway.__new__(LLMGateway)
        gateway._settings = type("Stub", (), {"default_llm_provider": "ollama"})()
        gateway._providers = {"ollama": StubProvider(), "stub": StubProvider()}
        return gateway

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_gateway] = override_get_gateway
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
