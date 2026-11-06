"""Persistent local, read-only workflows. No shell, remote tools or notifications."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import update

from app.api.workspace import _run_lock
from app.db.models import Schedule
from app.db.session import SessionLocal
from app.llm.gateway import get_gateway
from app.runtime import RunIn, execute_run

logger = logging.getLogger(__name__)


async def tick(db, gateway, now=None):
    if not _run_lock.acquire(blocking=False):
        return None
    try:
        now = now or datetime.now(timezone.utc)
        job = db.query(Schedule).filter(Schedule.enabled == True, Schedule.next_run_at <= now).order_by(Schedule.next_run_at).first()
        if job is None:
            return None
        claim = db.execute(update(Schedule).where(Schedule.id == job.id, Schedule.enabled == True, Schedule.next_run_at == job.next_run_at)
                           .values(enabled=bool(job.repeat_seconds), next_run_at=now + timedelta(seconds=job.repeat_seconds), last_status="running"))
        if claim.rowcount != 1:
            db.rollback(); return None
        db.commit(); db.refresh(job)
        try:
            result = await execute_run(RunIn(prompt=job.prompt, model=job.model, provider="ollama"), db, gateway)
            job.last_run_id, job.last_status = result.id, result.status
            db.commit()
            return result
        except asyncio.CancelledError:
            job.last_status = "interrupted"
            db.commit()
            raise
        except Exception:
            job.last_status = "failed"
            db.commit()
            raise
    finally:
        _run_lock.release()


async def serve():
    while True:
        try:
            with SessionLocal() as db:
                await tick(db, get_gateway())
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Scheduled workflow failed: %s", type(exc).__name__)
        await asyncio.sleep(1)
