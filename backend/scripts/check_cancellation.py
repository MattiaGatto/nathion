"""Cancel a real Ollama stream and verify that no partial assistant is saved."""
import json
import time
from pathlib import Path

import httpx
from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[2]


def main():
    token = (ROOT / "backend/data/access-token.txt").read_text().strip()
    headers = {"Authorization": f"Bearer {token}"}
    with httpx.Client(base_url="http://localhost:4173", headers=headers, trust_env=False) as client:
        response = client.post("/api/chat/conversations", json={"title": "Verifica interruzione"})
        response.raise_for_status()
        conversation_id = response.json()["id"]
        with connect(f"ws://localhost:4173/api/chat/ws/chat/{conversation_id}?model=llama3.2:3b&provider=ollama", origin="http://localhost:4173", additional_headers=headers) as socket:
            socket.send(json.dumps({"type": "message", "content": "Scrivi un lungo elenco numerato di cento consigli dettagliati per imparare Python."}))
            first = json.loads(socket.recv(timeout=120))
            assert first["type"] == "chunk", first
            started = time.monotonic()
            socket.send(json.dumps({"type": "cancel"}))
            while True:
                event = json.loads(socket.recv(timeout=10))
                if event["type"] == "cancelled":
                    break
                assert event["type"] == "chunk", event
            latency = round(time.monotonic() - started, 3)
        messages = client.get(f"/api/chat/conversations/{conversation_id}").json()["messages"]
        assert [message["role"] for message in messages] == ["user"]
    report = {"conversation_id": conversation_id, "cancelled": True,
              "partial_assistant_saved": False, "cancellation_ack_seconds": latency}
    (ROOT / "backend/data/voice-check/cancellation-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
