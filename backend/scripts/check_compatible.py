"""Exercise the compatible adapter against the real local Ollama /v1 endpoint."""
import asyncio
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import Settings
from app.llm.gateway import LLMGateway
from app.llm.base import ChatMessage


async def main():
    gateway = LLMGateway(Settings(compatible_base_url="http://localhost:11434/v1"))
    models = await gateway.list_available_models("compatible")
    assert any(model.id == "llama3.2:3b" for model in models)
    result = ""
    async for part in gateway.chat_stream([ChatMessage(role="user", content="Rispondi solo con la parola pronto.")], "llama3.2:3b", "compatible"):
        result += part
    assert "pronto" in result.lower()
    target = Path(__file__).resolve().parents[1] / "data/voice-check/compatible-report.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"provider": "compatible", "real_local_model": "llama3.2:3b", "models_verified": True, "stream_verified": True}), encoding="utf-8")
    print("Compatible provider verified with real local Ollama /v1.")


if __name__ == "__main__":
    asyncio.run(main())
