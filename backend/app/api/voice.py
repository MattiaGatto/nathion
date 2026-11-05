from app.core.hosting import authorize_compute
"""Local voice adapters. No automatic downloads or retained recordings."""
import asyncio
import io
import logging
import wave
from functools import lru_cache, partial
from pathlib import Path
from threading import Lock

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, model_validator
from starlette.concurrency import run_in_threadpool

from app.core.config import get_settings

router = APIRouter(prefix="/api/voice", tags=["voice"])
logger = logging.getLogger(__name__)
MAX_AUDIO_BYTES = 8 * 1024 * 1024
_model_lock = Lock()
_admission = Lock()


class SpeechIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    profile: str = Field(default="default", pattern=r"^[a-z][a-z0-9_-]{0,29}$")
    speaker: str = Field(default="", max_length=80)


class SpeechQueueIn(BaseModel):
    segments: list[SpeechIn] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def bound_queue(self):
        if sum(len(item.text) for item in self.segments) > 16000:
            raise ValueError("Coda audio troppo lunga")
        return self


def require_voice() -> None:
    if not get_settings().voice_enabled:
        raise HTTPException(503, "Voce locale disattivata: consulta docs/VOICE.md.")


@lru_cache(maxsize=1)
def whisper_model():
    from faster_whisper import WhisperModel

    settings = get_settings()
    if not Path(settings.whisper_model_path).is_dir():
        raise RuntimeError("Modello Whisper locale assente")
    return WhisperModel(settings.whisper_model_path, device="cpu", compute_type="int8",
                        local_files_only=True)


@lru_cache(maxsize=4)
def piper_voice(profile: str = "default"):
    from piper import PiperVoice

    settings = get_settings()
    model_path = settings.piper_model_path if profile == "default" else settings.voice_profiles.get(profile)
    if not model_path:
        raise ValueError("Profilo vocale sconosciuto")
    path = Path(model_path)
    if not path.is_file() or not Path(str(path) + ".json").is_file():
        raise RuntimeError("Modello Piper o configurazione assente")
    return PiperVoice.load(str(path))


def transcribe_audio(audio: bytes) -> str:
    with _model_lock:
        model = whisper_model()
        # Decode first to bound duration before expensive inference.
        from faster_whisper.audio import decode_audio

        samples = decode_audio(io.BytesIO(audio), sampling_rate=16000)
        if len(samples) > 16000 * 60:
            raise ValueError("Registrazione oltre 60 secondi")
        segments, _ = model.transcribe(samples, language=get_settings().voice_language,
                                       vad_filter=True, beam_size=1)
        return " ".join(segment.text.strip() for segment in segments).strip()


def synthesize_audio(text: str, profile: str = "default") -> bytes:
    with _model_lock:
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            piper_voice(profile).synthesize_wav(text, wav)
        return output.getvalue()


@router.get("/status")
def status():
    settings = get_settings()
    return {"enabled": settings.voice_enabled,
            "profiles": [name for name, path in {"default": settings.piper_model_path, **settings.voice_profiles}.items() if Path(path).is_file() and Path(path + ".json").is_file()],
            "whisper_model_present": Path(settings.whisper_model_path).is_dir(),
            "piper_model_present": Path(settings.piper_model_path).is_file()
            and Path(settings.piper_model_path + ".json").is_file()}


async def execute(function, argument):
    authorize_compute()
    # Reject overlapping jobs instead of allowing an unbounded inference queue.
    if not _admission.acquire(blocking=False):
        raise HTTPException(429, "Motore vocale occupato, riprova tra poco.")

    def run():
        try:
            return function(argument)
        finally:
            # Keep admission until native inference ends, even on disconnect.
            _admission.release()

    job = asyncio.create_task(run_in_threadpool(run))
    job.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)
    try:
        return await asyncio.shield(job)
    except (ImportError, RuntimeError, OSError) as exc:
        logger.warning("Voice engine unavailable: %s", type(exc).__name__)
        raise HTTPException(503, "Motore vocale non pronto: verifica dipendenze e modelli locali.") from exc
    except Exception as exc:
        logger.warning("Voice processing failed: %s", type(exc).__name__)
        raise HTTPException(422, "Elaborazione audio fallita: verifica formato e durata (massimo 60 secondi).") from exc


@router.post("/transcribe")
async def transcribe(request: Request):
    require_voice()
    if request.headers.get("content-type", "").split(";")[0] not in {
        "audio/webm", "audio/ogg", "audio/mp4", "audio/wav", "audio/x-wav"
    }:
        raise HTTPException(415, "Formato audio non supportato")
    audio = bytearray()
    async for chunk in request.stream():
        if len(audio) + len(chunk) > MAX_AUDIO_BYTES:
            raise HTTPException(413, "Registrazione troppo grande (massimo 8 MiB)")
        audio.extend(chunk)
    if not audio:
        raise HTTPException(422, "Registrazione vuota")
    text = await execute(transcribe_audio, bytes(audio))
    return {"text": text}


@router.post("/speak")
async def speak(body: SpeechIn):
    require_voice()
    if not body.text.strip():
        raise HTTPException(422, "Testo vuoto")
    synthesize = synthesize_audio if body.profile == "default" else partial(synthesize_audio, profile=body.profile)
    audio = await execute(synthesize, body.text)
    return Response(audio, media_type="audio/wav", headers={"Cache-Control": "no-store"})
