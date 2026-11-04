"""Verify the protected same-origin deployment and a real two-agent DAG."""
import json
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]


def main():
    token = (ROOT / "backend/data/access-token.txt").read_text().strip()
    with httpx.Client(base_url="http://localhost:4173", timeout=200, trust_env=False) as client:
        assert client.get("/").status_code == 200
        assert client.get("/manifest.webmanifest").json()["name"] == "NATHION"
        assert client.get("/sw.js").status_code == 200
        assert client.get("/api/agents").status_code == 401
        login = client.post("/api/auth/login", json={"token": token}, headers={"origin": "http://localhost:4173"})
        login.raise_for_status()
        assert "httponly" in login.headers["set-cookie"].lower()
        assert len(client.get("/api/agents").json()) == 7
        assert len(client.get("/api/skills").json()) == 3
        note = client.post("/api/memory", json={"content": "Verifica prodotto: usa Python per la somma.", "category": "project", "source": "check_product"})
        note.raise_for_status()
        memory_id = note.json()["id"]
        try:
            run = client.post("/api/runs", json={"prompt": "Progetta una funzione somma Python", "model": "llama3.2:3b", "tasks": [
                {"id": "design", "agent_id": "architect", "instruction": "In massimo tre righe definisci una funzione somma di due interi Python."},
                {"id": "code", "agent_id": "coding", "instruction": "Usa la definizione ricevuta. Rispondi solo con la funzione Python e un assert, massimo dieci righe.", "depends_on": ["design"]}]})
            run.raise_for_status()
            result = run.json()
            assert result["status"] == "completed", result["trace"]
            assert memory_id in result["trace"][0]["memory_ids"]
            assert client.get("/api/runs/" + result["id"]).json()["result"] == result["result"]
            print(f"Real two-agent workflow completed: {result['id']}")
            output = ROOT / "backend/data/voice-check/product-report.json"
            output.write_text(json.dumps({"run_id": result["id"], "status": result["status"], "result": result["result"],
                                          "auth_verified": True, "same_origin_proxy_verified": True}, ensure_ascii=False, indent=2), encoding="utf-8")
        finally:
            client.delete("/api/memory/" + memory_id).raise_for_status()
        client.post("/api/auth/logout").raise_for_status()
        assert client.get("/api/memory").status_code == 401
    print("Authentication, proxy, PWA assets, skills, explicit memory and workflow persistence verified.")


if __name__ == "__main__":
    main()
