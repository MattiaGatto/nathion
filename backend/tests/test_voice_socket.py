import pytest
from types import SimpleNamespace
from starlette.websockets import WebSocketDisconnect

from app.api import voice, voice_socket
from app.core.config import get_settings


@pytest.fixture(autouse=True)
def enabled(monkeypatch):
    monkeypatch.setattr(get_settings(), "voice_enabled", True)


def test_streamed_recording(client, monkeypatch):
    captured = []
    def transcribe(audio):
        captured.append(audio)
        return "voce locale"
    monkeypatch.setattr(voice, "transcribe_audio", transcribe)
    with client.websocket_connect("/api/voice/ws") as socket:
        socket.send_json({"type": "transcribe", "mime": "audio/webm;codecs=opus"})
        assert socket.receive_json()["type"] == "ready"
        socket.send_bytes(b"first")
        socket.send_bytes(b"second")
        socket.send_json({"type": "finish"})
        assert socket.receive_json() == {"type": "transcript", "text": "voce locale"}
    assert captured == [b"firstsecond"]


def test_speech_backpressure_and_cancel(client, monkeypatch):
    generated = []
    def synthesize(text):
        generated.append(text)
        return b"RIFF-first"
    monkeypatch.setattr(voice, "synthesize_audio", synthesize)
    with client.websocket_connect("/api/voice/ws") as socket:
        socket.send_json({"type": "speak", "text": "Prima frase. Seconda frase."})
        assert socket.receive_json() == {"type": "ready", "parts": 2}
        assert socket.receive_json()["text"] == "Prima frase."
        assert socket.receive_bytes() == b"RIFF-first"
        socket.send_json({"type": "cancel"})
        with pytest.raises(WebSocketDisconnect):
            socket.receive_json()
    assert generated == ["Prima frase."]


def test_speech_continues_on_ack(client, monkeypatch):
    monkeypatch.setattr(voice, "synthesize_audio", lambda text: text.encode())
    with client.websocket_connect("/api/voice/ws") as socket:
        socket.send_json({"type": "speak", "text": "Uno. Due."})
        assert socket.receive_json()["parts"] == 2
        for text in ["Uno.", "Due."]:
            assert socket.receive_json()["text"] == text
            assert socket.receive_bytes() == text.encode()
            socket.send_json({"type": "next"})
        assert socket.receive_json() == {"type": "done"}


def test_progressive_transcript_precedes_final(client, monkeypatch):
    times = iter([0, 5, 5, 5])
    monkeypatch.setattr(voice_socket, "time", SimpleNamespace(monotonic=lambda: next(times)))
    monkeypatch.setattr(voice, "transcribe_audio", lambda audio: audio.decode())
    with client.websocket_connect("/api/voice/ws") as socket:
        socket.send_json({"type": "transcribe", "mime": "audio/webm"})
        assert socket.receive_json()["type"] == "ready"
        socket.send_bytes(b"prima")
        assert socket.receive_json() == {"type": "partial", "text": "prima"}
        socket.send_bytes(b" seconda")
        socket.send_json({"type": "finish"})
        assert socket.receive_json() == {"type": "transcript", "text": "prima seconda"}


def test_cross_origin_rejected(client):
    with pytest.raises(WebSocketDisconnect) as error:
        with client.websocket_connect("/api/voice/ws", headers={"origin": "https://untrusted.example"}):
            pass
    assert error.value.code == 4403


@pytest.mark.parametrize("payload", [[], {"type": "unknown"}, {"type": "speak", "text": " "},
                                    {"type": "transcribe", "mime": "text/html"}])
def test_invalid_start(client, payload):
    with client.websocket_connect("/api/voice/ws") as socket:
        socket.send_json(payload)
        assert socket.receive_json()["type"] == "error"


def test_socket_size_limit(client, monkeypatch):
    monkeypatch.setattr(voice, "MAX_AUDIO_BYTES", 3)
    with client.websocket_connect("/api/voice/ws") as socket:
        socket.send_json({"type": "transcribe", "mime": "audio/webm"})
        socket.receive_json()
        socket.send_bytes(b"1234")
        assert socket.receive_json()["type"] == "error"


def test_parts_keep_words():
    text = "Una parola " * 100
    parts = voice_socket.speech_parts(text)
    assert len(parts) > 1
    assert " ".join(parts).split() == text.split()


def test_distinct_profiles_share_one_acknowledged_queue(client, monkeypatch):
    generated = []
    def synthesize(text, profile="default"):
        generated.append((text, profile))
        return b"RIFF-" + profile.encode()
    monkeypatch.setattr(voice, "synthesize_audio", synthesize)
    with client.websocket_connect("/api/voice/ws") as socket:
        socket.send_json({"type": "speak", "segments": [
            {"text": "Primo contributo.", "profile": "default", "speaker": "Architect"},
            {"text": "Secondo contributo.", "profile": "riccardo", "speaker": "Coding"}]})
        assert socket.receive_json()["parts"] == 2
        for profile, speaker in [("default", "Architect"), ("riccardo", "Coding")]:
            metadata = socket.receive_json()
            assert (metadata["profile"], metadata["speaker"]) == (profile, speaker)
            assert socket.receive_bytes() == b"RIFF-" + profile.encode()
            socket.send_json({"type": "next"})
        assert socket.receive_json() == {"type": "done"}
    assert generated == [("Primo contributo.", "default"), ("Secondo contributo.", "riccardo")]
