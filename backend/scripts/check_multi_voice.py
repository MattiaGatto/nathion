"""Exercise two real Piper profiles through the authenticated audio queue."""
import io
import json
import wave
from pathlib import Path

from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parents[2]


def main():
    token = (ROOT / "backend/data/access-token.txt").read_text().strip()
    output = ROOT / "backend/data/voice-check"
    report = []
    with connect("ws://localhost:4173/api/voice/ws", origin="http://localhost:4173", additional_headers={"Authorization": f"Bearer {token}"}) as socket:
        socket.send(json.dumps({"type": "speak", "segments": [
            {"text": "Ciao, sono il tuo agente per l'architettura.", "speaker": "Architect", "profile": "default"},
            {"text": "Ciao, mi occupo del codice e delle verifiche.", "speaker": "Coding", "profile": "riccardo"}]}))
        assert json.loads(socket.recv(timeout=15))["type"] == "ready"
        while True:
            event = json.loads(socket.recv(timeout=120))
            if event["type"] == "done":
                break
            if event["type"] == "error":
                raise RuntimeError(event["detail"])
            audio = socket.recv(timeout=120)
            with wave.open(io.BytesIO(audio)) as wav:
                sample_rate = wav.getframerate()
            (output / f"profile-{event['profile']}.wav").write_bytes(audio)
            report.append({"profile": event["profile"], "speaker": event["speaker"], "sample_rate": sample_rate, "bytes": len(audio)})
            socket.send(json.dumps({"type": "next"}))
    for item, filename in zip(report, ["voice.onnx.json", "riccardo.onnx.json"]):
        expected = json.loads((ROOT / "models" / filename).read_text(encoding="utf-8"))["audio"]["sample_rate"]
        assert item["sample_rate"] == expected
    assert [item["profile"] for item in report] == ["default", "riccardo"]
    (output / "multi-voice-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
