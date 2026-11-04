"""API contracts and resource limits; no real voice models used here."""
import pytest
import asyncio
from threading import Event

from fastapi import HTTPException

from app.api import voice
from app.core.config import get_settings


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(get_settings(), "voice_enabled", True)


def test_voice_disabled(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "voice_enabled", False)
    assert client.get("/api/voice/status").json()["enabled"] is False
    assert client.post("/api/voice/speak", json={"text": "ciao"}).status_code == 503


def test_transcribe_and_no_disk_upload(client, enabled, monkeypatch):
    received = []
    def transcribe(audio):
        received.append(audio)
        return "ciao NATHION"
    monkeypatch.setattr(voice, "transcribe_audio", transcribe)
    response = client.post("/api/voice/transcribe", content=b"test",
                           headers={"Content-Type": "audio/webm;codecs=opus"})
    assert response.json() == {"text": "ciao NATHION"}
    assert received == [b"test"]


def test_audio_limits(client, enabled, monkeypatch):
    monkeypatch.setattr(voice, "MAX_AUDIO_BYTES", 3)
    assert client.post("/api/voice/transcribe", content=b"1234",
                       headers={"Content-Type": "audio/wav"}).status_code == 413
    assert client.post("/api/voice/transcribe", content=b"",
                       headers={"Content-Type": "audio/wav"}).status_code == 422
    assert client.post("/api/voice/transcribe", content=b"test").status_code == 415


def test_speech_validation(client, enabled):
    for text in ["", "   ", "x" * 4001]:
        assert client.post("/api/voice/speak", json={"text": text}).status_code == 422


def test_speech_response(client, enabled, monkeypatch):
    monkeypatch.setattr(voice, "synthesize_audio", lambda text: b"RIFF-test")
    response = client.post("/api/voice/speak", json={"text": "ciao"})
    assert response.content == b"RIFF-test"
    assert response.headers["content-type"] == "audio/wav"
    assert response.headers["cache-control"] == "no-store"


def test_unavailable_model_is_explicit(client, enabled, monkeypatch):
    def unavailable(text):
        raise RuntimeError("private model location")
    monkeypatch.setattr(voice, "synthesize_audio", unavailable)
    response = client.post("/api/voice/speak", json={"text": "ciao"})
    assert response.status_code == 503
    assert "private model location" not in response.text


def test_corrupt_audio(client, enabled, monkeypatch):
    def corrupt(audio):
        raise ValueError("invalid audio")
    monkeypatch.setattr(voice, "transcribe_audio", corrupt)
    assert client.post("/api/voice/transcribe", content=b"invalid",
                       headers={"Content-Type": "audio/wav"}).status_code == 422


@pytest.mark.asyncio
async def test_cancelled_client_keeps_engine_busy_until_inference_finishes():
    started, release, finished = Event(), Event(), Event()
    def blocking(_):
        started.set()
        try:
            release.wait(timeout=5)
        finally:
            finished.set()
    task = asyncio.create_task(voice.execute(blocking, None))
    try:
        assert await asyncio.to_thread(started.wait, 5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        with pytest.raises(HTTPException) as error:
            await voice.execute(lambda _: None, None)
        assert error.value.status_code == 429
    finally:
        release.set()
        assert await asyncio.to_thread(finished.wait, 5)
        # Admission is released in the wrapper immediately after blocking returns.
        for _ in range(100):
            if not voice._admission.locked():
                break
            await asyncio.sleep(0.01)
    assert not voice._admission.locked()
