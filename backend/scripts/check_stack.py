"""Exercise real running containers: audio WebSocket -> Ollama -> audio queue."""
import json
from pathlib import Path

import httpx
from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "backend/data/voice-check"


def main() -> None:
    token_file = ROOT / "backend/data/access-token.txt"
    token = token_file.read_text(encoding="utf-8").strip() if token_file.exists() else ""
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    audio = (OUTPUT / "sample.wav").read_bytes()
    with connect("ws://127.0.0.1:8000/api/voice/ws", origin="http://localhost:4173",
                 open_timeout=15, additional_headers=headers) as socket:
        socket.send(json.dumps({"type": "transcribe", "mime": "audio/wav"}))
        assert json.loads(socket.recv(timeout=15))["type"] == "ready"
        for offset in range(0, len(audio), 16000):
            socket.send(audio[offset:offset + 16000])
        socket.send(json.dumps({"type": "finish"}))
        while True:
            message = json.loads(socket.recv(timeout=180))
            if message["type"] == "error":
                raise RuntimeError(message["detail"])
            if message["type"] == "transcript":
                transcript = message["text"]
                break
    print(f"Real WebSocket STT: {transcript}", flush=True)
    with httpx.Client(base_url="http://127.0.0.1:8000", timeout=180, trust_env=False, headers=headers) as client:
        assert client.get("/health").status_code == 200
        models = client.get("/api/models?provider=ollama")
        models.raise_for_status()
        ids = [model["id"] for model in models.json()]
        model = next((item for item in ids if item.startswith("llama3.2:3b")), ids[0])
        response = client.post("/api/chat/conversations", json={"title": "Verifica voce locale"})
        response.raise_for_status()
        conversation_id = response.json()["id"]
        response = client.post(f"/api/chat/conversations/{conversation_id}/messages", json={
            "model": model, "provider": "ollama", "content": transcript + " Rispondi in italiano con una sola frase breve."
        })
        response.raise_for_status()
        reply = response.json()["messages"][-1]["content"]
        persisted = client.get(f"/api/chat/conversations/{conversation_id}")
        persisted.raise_for_status()
        assert persisted.json()["messages"][-1]["content"] == reply
    print(f"Real Ollama ({model}): {reply}", flush=True)
    parts = []
    with connect("ws://127.0.0.1:8000/api/voice/ws", origin="http://localhost:4173", additional_headers=headers) as socket:
        socket.send(json.dumps({"type": "speak", "text": reply}))
        assert json.loads(socket.recv(timeout=15))["type"] == "ready"
        while True:
            event = json.loads(socket.recv(timeout=180))
            if event["type"] == "error":
                raise RuntimeError(event["detail"])
            if event["type"] == "done":
                break
            assert event["type"] == "audio"
            data = socket.recv(timeout=180)
            assert isinstance(data, bytes) and data.startswith(b"RIFF")
            (OUTPUT / f"reply-{len(parts)}.wav").write_bytes(data)
            parts.append({"text": event["text"], "bytes": len(data)})
            socket.send(json.dumps({"type": "next"}))
    report = {"transcript": transcript, "model": model, "conversation_id": conversation_id,
              "reply": reply, "audio_parts": parts, "microphone_tested": False}
    (OUTPUT / "stack-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
