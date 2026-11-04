"""Real, offline TTS -> VAD -> STT smoke test (no microphone needed)."""
import io
import json
import os
import sys
import time
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
os.environ["NATHION_VOICE_ENABLED"] = "true"
os.environ["NATHION_WHISPER_MODEL_PATH"] = str(ROOT / "models/whisper")
os.environ["NATHION_PIPER_MODEL_PATH"] = str(ROOT / "models/voice.onnx")
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"

from app.api.voice import synthesize_audio, transcribe_audio  # noqa: E402


def main() -> None:
    started = time.monotonic()
    phrase = "Ciao, questo è un test della voce locale. Il sistema è pronto."
    audio = synthesize_audio(phrase)
    synthesis_seconds = time.monotonic() - started
    with wave.open(io.BytesIO(audio)) as wav:
        duration = wav.getnframes() / wav.getframerate()
    started = time.monotonic()
    transcript = transcribe_audio(audio)
    recognition_seconds = time.monotonic() - started
    if not all(word in transcript.lower() for word in ["test", "voce", "sistema"]):
        raise RuntimeError(f"Unexpected transcript: {transcript}")
    output = ROOT / "backend/data/voice-check"
    output.mkdir(parents=True, exist_ok=True)
    (output / "sample.wav").write_bytes(audio)
    report = {"source_text": phrase, "transcript": transcript,
              "duration_seconds": round(duration, 2),
              "synthesis_seconds": round(synthesis_seconds, 2),
              "recognition_seconds": round(recognition_seconds, 2),
              "offline": True, "microphone_tested": False}
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
