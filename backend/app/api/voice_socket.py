"""Bounded WebSocket audio transport with progressive STT and queued WAV output."""
import asyncio
import json
import re
import time
from contextlib import suppress
from functools import partial

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.api import voice
from app.core.config import get_settings

router = APIRouter(prefix="/api/voice", tags=["voice"])
ALLOWED_TYPES = {"audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/x-wav"}


def speech_parts(text: str) -> list[str]:
    # Each independently playable WAV is bounded to keep the first audio prompt.
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    parts: list[str] = []
    for sentence in sentences:
        words = sentence.split()
        part = ""
        for word in words:
            if part and len(part) + len(word) > 280:
                parts.append(part)
                part = ""
            part = f"{part} {word}".strip()
        if part:
            parts.append(part)
    return parts


async def recognize(socket: WebSocket) -> None:
    audio = bytearray()
    last_preview = time.monotonic()
    preview: asyncio.Task | None = None

    async def send_preview(snapshot: bytes):
        try:
            text = await voice.execute(voice.transcribe_audio, snapshot)
            if text:
                await socket.send_json({"type": "partial", "text": text})
        except HTTPException:
            # A truncated container may not decode yet, or inference may be busy.
            # Final recognition still reports errors explicitly.
            pass

    await socket.send_json({"type": "ready"})
    try:
        async with asyncio.timeout(90):
            while True:
                message = await socket.receive()
                if message["type"] == "websocket.disconnect":
                    raise WebSocketDisconnect()
                if data := message.get("bytes"):
                    if len(data) > 512 * 1024 or len(audio) + len(data) > voice.MAX_AUDIO_BYTES:
                        raise HTTPException(413, "Registrazione troppo grande")
                    audio.extend(data)
                    if time.monotonic() - last_preview >= 4 and (preview is None or preview.done()):
                        # Observe exceptions before replacing a completed task.
                        if preview is not None:
                            await preview
                        preview = asyncio.create_task(send_preview(bytes(audio)))
                        last_preview = time.monotonic()
                elif text := message.get("text"):
                    command = json.loads(text)
                    if not isinstance(command, dict):
                        raise HTTPException(422, "Comando vocale non valido")
                    if command.get("type") == "cancel":
                        return
                    if command.get("type") != "finish":
                        raise HTTPException(422, "Comando vocale non valido")
                    if preview:
                        await preview
                    if not audio:
                        raise HTTPException(422, "Registrazione vuota")
                    result = await voice.execute(voice.transcribe_audio, bytes(audio))
                    await socket.send_json({"type": "transcript", "text": result})
                    return
    finally:
        if preview and not preview.done():
            preview.cancel()
            with suppress(asyncio.CancelledError):
                await preview


async def speak(socket: WebSocket, segments: list[voice.SpeechIn]) -> None:
    parts = [(part, segment.profile, segment.speaker) for segment in segments for part in speech_parts(segment.text)]
    await socket.send_json({"type": "ready", "parts": len(parts)})
    for index, (part, profile, speaker) in enumerate(parts):
        synthesize = voice.synthesize_audio if profile == "default" else partial(voice.synthesize_audio, profile=profile)
        audio = await voice.execute(synthesize, part)
        await socket.send_json({"type": "audio", "index": index, "text": part, "speaker": speaker, "profile": profile})
        await socket.send_bytes(audio)
        # Client acknowledgement bounds the queue to one segment and permits
        # cancellation between segments instead of synthesizing a whole answer.
        async with asyncio.timeout(120):
            command = await socket.receive_json()
        if not isinstance(command, dict):
            raise HTTPException(422, "Conferma audio non valida")
        if command.get("type") == "cancel":
            return
        if command.get("type") != "next":
            raise HTTPException(422, "Conferma audio non valida")
    await socket.send_json({"type": "done"})


@router.websocket("/ws")
async def voice_websocket(socket: WebSocket) -> None:
    # WebSocket handshakes do not go through CORS middleware.
    origin = socket.headers.get("origin")
    if origin and origin not in get_settings().cors_allow_origins:
        await socket.close(code=4403)
        return
    await socket.accept()
    try:
        voice.require_voice()
        async with asyncio.timeout(10):
            start = await socket.receive_json()
        if not isinstance(start, dict):
            raise HTTPException(422, "Richiesta vocale non valida")
        if start.get("type") == "transcribe":
            if str(start.get("mime", "")).split(";")[0] not in ALLOWED_TYPES:
                raise HTTPException(415, "Formato audio non supportato")
            await recognize(socket)
        elif start.get("type") == "speak":
            queue = voice.SpeechQueueIn.model_validate({"segments": start["segments"]}) if "segments" in start else voice.SpeechQueueIn(segments=[voice.SpeechIn.model_validate(start)])
            if any(not item.text.strip() for item in queue.segments):
                raise HTTPException(422, "Testo vuoto")
            async with asyncio.timeout(600):
                await speak(socket, queue.segments)
        else:
            raise HTTPException(422, "Richiesta vocale non valida")
    except WebSocketDisconnect:
        return
    except HTTPException as exc:
        await socket.send_json({"type": "error", "detail": exc.detail})
    except (ValueError, TypeError, ValidationError):
        await socket.send_json({"type": "error", "detail": "Richiesta vocale non valida"})
    except TimeoutError:
        await socket.send_json({"type": "error", "detail": "Sessione vocale scaduta"})
    finally:
        with suppress(RuntimeError, OSError):
            await socket.close()
