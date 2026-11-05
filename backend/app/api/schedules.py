from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.db.models import Schedule
from app.db.session import get_db

router = APIRouter(prefix="/api/schedules", tags=["schedules"])


class ScheduleIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=12000)
    model: str = Field(min_length=1, max_length=200)
    next_run_at: datetime
    repeat_seconds: int = Field(default=0, ge=0, le=31536000)

    @field_validator("next_run_at")
    @classmethod
    def timezone_required(cls, value):
        if value.tzinfo is None:
            raise ValueError("Specifica il fuso orario")
        return value.astimezone(timezone.utc)

    @field_validator("repeat_seconds")
    @classmethod
    def minimum_interval(cls, value):
        if 0 < value < 60:
            raise ValueError("Intervallo minimo sessanta secondi")
        return value


class ActiveIn(BaseModel):
    enabled: bool


def schedule_out(row):
    return {"id": row.id, "prompt": row.prompt, "model": row.model,
            "next_run_at": row.next_run_at.replace(tzinfo=timezone.utc).isoformat(),
            "repeat_seconds": row.repeat_seconds, "enabled": row.enabled,
            "last_run_id": row.last_run_id, "last_status": row.last_status}


@router.get("")
def list_schedules(db: Session = Depends(get_db)):
    return [schedule_out(row) for row in db.query(Schedule).order_by(Schedule.created_at.desc()).limit(100).all()]


@router.post("")
def create_schedule(body: ScheduleIn, db: Session = Depends(get_db)):
    if not body.prompt.strip():
        raise HTTPException(422, "Obiettivo vuoto")
    row = Schedule(**body.model_dump())
    db.add(row); db.commit(); db.refresh(row)
    return schedule_out(row)


@router.patch("/{schedule_id}")
def set_active(schedule_id: str, body: ActiveIn, db: Session = Depends(get_db)):
    row = db.get(Schedule, schedule_id)
    if not row:
        raise HTTPException(404, "Automazione non trovata")
    row.enabled = body.enabled
    db.commit(); db.refresh(row)
    return schedule_out(row)


@router.delete("/{schedule_id}", status_code=204)
def delete_schedule(schedule_id: str, db: Session = Depends(get_db)):
    row = db.get(Schedule, schedule_id)
    if not row:
        raise HTTPException(404, "Automazione non trovata")
    if row.last_status == "running":
        raise HTTPException(409, "Attività in corso. Metti in pausa le esecuzioni future e attendi il completamento.")
    db.delete(row); db.commit()
