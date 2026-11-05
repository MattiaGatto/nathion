"""Real model planning and selective memory proposals, with temporary own data."""
import json
from pathlib import Path
import httpx
ROOT = Path(__file__).resolve().parents[2]


def main():
    token = (ROOT / "backend/data/access-token.txt").read_text().strip()
    with httpx.Client(base_url="http://localhost:4173", headers={"Authorization": f"Bearer {token}"}, trust_env=False, timeout=90) as client:
        plan = client.post("/api/plans", json={"prompt": "Definisci una funzione Python che somma due interi. Un solo task coding, istruzione breve.", "model": "llama3.2:3b", "provider": "ollama"})
        plan.raise_for_status()
        assert 1 <= len(plan.json()["tasks"]) <= 3
        conversation = client.post("/api/chat/conversations", json={"title": "Verifica proposte memoria"})
        conversation.raise_for_status(); conversation_id = conversation.json()["id"]
        try:
            response = client.post(f"/api/chat/conversations/{conversation_id}/messages", json={"content": "Per i miei progetti personali preferisco scrivere codice Python. Rispondi solo: ricevuto.", "model": "llama3.2:3b", "provider": "ollama"})
            response.raise_for_status()
            before = client.get("/api/memory").json()
            suggestions = client.post(f"/api/conversations/{conversation_id}/memory-suggestions", json={"model": "llama3.2:3b", "provider": "ollama"})
            suggestions.raise_for_status()
            assert suggestions.json()["suggestions"]
            assert all(item["certainty"] == "inference" for item in suggestions.json()["suggestions"])
            assert client.get("/api/memory").json() == before
            output = ROOT / "backend/data/voice-check/proposals-report.json"
            output.write_text(json.dumps({"real_llm_plan": True, "validated_tasks": plan.json()["tasks"], "memory_suggestions": True, "no_automatic_memory_write": True}, ensure_ascii=False, indent=2), encoding="utf-8")
            print("Real model plan validated; selective memory proposals verified without automatic saving.")
        finally:
            client.delete("/api/chat/conversations/" + conversation_id).raise_for_status()


if __name__ == "__main__":
    main()
