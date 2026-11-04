"""Real local embedding and semantic retrieval check through authenticated APIs."""
import json
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]


def main():
    token = (ROOT / "backend/data/access-token.txt").read_text().strip()
    with httpx.Client(base_url="http://localhost:4173", headers={"Authorization": f"Bearer {token}"}, trust_env=False, timeout=90) as client:
        saved = client.post("/api/memory", json={"content": "L'automobile è parcheggiata in garage.", "source": "semantic-check"})
        saved.raise_for_status()
        note = saved.json()
        try:
            assert saved.headers["X-Memory-Indexed"] == "true", "Modello embedding non disponibile"
            found = client.get("/api/memory", params={"q": "Dove si trova la macchina?"})
            found.raise_for_status()
            assert found.headers["X-Memory-Retrieval"] == "hybrid"
            assert note["id"] in [row["id"] for row in found.json()]
            report = {"semantic_match": True, "retrieval": "hybrid", "source": note["content"], "query": "Dove si trova la macchina?"}
            (ROOT / "backend/data/voice-check/memory-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps(report, ensure_ascii=False))
        finally:
            client.delete("/api/memory/" + note["id"]).raise_for_status()


if __name__ == "__main__":
    main()
