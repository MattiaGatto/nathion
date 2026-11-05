import asyncio
from threading import Event

from app.llm.gateway import get_gateway
from app.main import app


def test_cancellation_closes_provider_and_preserves_only_complete_messages(client):
    stopped = Event()
    class BlockingGateway:
        async def chat_stream(self, *args, **kwargs):
            try:
                yield "testo parziale"
                await asyncio.Event().wait()
            finally:
                stopped.set()
    app.dependency_overrides[get_gateway] = lambda: BlockingGateway()
    conversation = client.post("/api/chat/conversations", json={}).json()
    with client.websocket_connect(f"/api/chat/ws/chat/{conversation['id']}?model=stub-model") as socket:
        socket.send_json({"type": "message", "content": "Prima richiesta"})
        assert socket.receive_json() == {"type": "chunk", "content": "testo parziale"}
        socket.send_json({"type": "cancel"})
        assert socket.receive_json() == {"type": "cancelled"}
        assert stopped.wait(1)
    messages = client.get(f"/api/chat/conversations/{conversation['id']}").json()["messages"]
    assert [message["role"] for message in messages] == ["user"]


def test_socket_accepts_legacy_text_and_rejects_empty_messages(client):
    conversation = client.post("/api/chat/conversations", json={}).json()
    with client.websocket_connect(f"/api/chat/ws/chat/{conversation['id']}?model=stub-model") as socket:
        socket.send_text("   ")
        assert socket.receive_json()["type"] == "error"
        socket.send_text("ciao")
        chunks = []
        while True:
            event = socket.receive_json()
            if event["type"] == "done":
                break
            chunks.append(event["content"])
        assert "ciao" in "".join(chunks)
