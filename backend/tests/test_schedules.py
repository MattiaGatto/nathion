from datetime import datetime, timezone, timedelta

import pytest

from app.db.models import Schedule, Run
from app.scheduler import tick


@pytest.mark.asyncio
async def test_due_readonly_job_runs_once_and_is_persisted(db_session):
    job = Schedule(prompt="calcola 2+3", model="unused", next_run_at=datetime.now(timezone.utc) - timedelta(seconds=1))
    db_session.add(job); db_session.commit()
    result = await tick(db_session, None)
    assert result.result == "5"
    db_session.refresh(job)
    assert job.last_status == "completed" and not job.enabled
    assert job.last_run_id == result.id
    assert await tick(db_session, None) is None
    assert db_session.query(Run).count() == 1


def test_schedule_limits_and_pause(client):
    body = {"prompt": "Riepiloga il progetto", "model": "local", "next_run_at": datetime.now(timezone.utc).isoformat()}
    assert client.post("/api/schedules", json={**body, "repeat_seconds": 1}).status_code == 422
    assert client.post("/api/schedules", json={**body, "next_run_at": "2026-11-05T12:00:00"}).status_code == 422
    job = client.post("/api/schedules", json=body).json()
    assert client.patch("/api/schedules/" + job["id"], json={"enabled": False}).json()["enabled"] is False
    assert client.delete("/api/schedules/" + job["id"]).status_code == 204


def test_schedule_normalizes_user_timezone_to_utc(client):
    job = client.post("/api/schedules", json={"prompt": "test", "model": "local", "next_run_at": "2026-12-01T12:00:00+02:00"}).json()
    assert job["next_run_at"] == "2026-12-01T10:00:00+00:00"
