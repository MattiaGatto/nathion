"""Exercise the real scheduler worker with a temporary, read-only calculation."""
import json
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]


def main():
    token = (ROOT / "backend/data/access-token.txt").read_text().strip()
    with httpx.Client(base_url="http://localhost:4173", headers={"Authorization": f"Bearer {token}"}, trust_env=False, timeout=15) as client:
        response = client.post("/api/schedules", json={"prompt": "calcola 2+3", "model": "unused", "next_run_at": (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()})
        response.raise_for_status()
        job_id = response.json()["id"]
        try:
            deadline = time.monotonic() + 20
            while True:
                job = next(row for row in client.get("/api/schedules").json() if row["id"] == job_id)
                if job["last_status"] == "completed":
                    break
                if time.monotonic() > deadline:
                    raise RuntimeError("Worker non ha completato l'attività di verifica")
                time.sleep(0.5)
            run = client.get("/api/runs/" + job["last_run_id"]).json()
            assert run["result"] == "5" and job["enabled"] is False
            report = {"scheduler_worker_verified": True, "one_shot_disabled": True, "result": "5"}
            (ROOT / "backend/data/voice-check/schedule-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
            print(json.dumps(report))
            client.delete("/api/runs/" + run["id"]).raise_for_status()
        finally:
            client.patch("/api/schedules/" + job_id, json={"enabled": False})
            client.delete("/api/schedules/" + job_id)


if __name__ == "__main__":
    main()
