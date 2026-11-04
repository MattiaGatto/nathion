import json
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.models import Memory, Run
from app.db.session import get_db
from app.llm.gateway import LLMGateway, get_gateway
from app.runtime import AGENTS, MemoryIn, RunIn, discover_skills, execute_run, fingerprint, retrieve

router = APIRouter(prefix="/api", tags=["workspace"])
_run_lock = Lock()


@router.get("/agents")
def agents():
    return list(AGENTS.values())


@router.get("/skills")
def skills():
    return discover_skills()


@router.get("/memory")
def memories(q: str = Query(default="", max_length=1000), db: Session = Depends(get_db)):
    return retrieve(db, q, 30) if q else db.query(Memory).order_by(Memory.created_at.desc()).limit(100).all()


@router.post("/memory")
def remember(body: MemoryIn, db: Session = Depends(get_db)):
    try:
        digest = fingerprint(body)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    existing = db.query(Memory).filter_by(fingerprint=digest).first()
    if existing:
        return existing
    row = Memory(**body.model_dump(), fingerprint=digest)
    db.add(row); db.commit(); db.refresh(row)
    return row


@router.delete("/memory/{memory_id}", status_code=204)
def forget(memory_id: str, db: Session = Depends(get_db)):
    row = db.get(Memory, memory_id)
    if not row:
        raise HTTPException(404, "Memoria non trovata")
    db.delete(row); db.commit()


def run_out(row):
    return {"id": row.id, "prompt": row.prompt, "status": row.status,
            "result": row.result, "trace": json.loads(row.trace), "created_at": row.created_at}


@router.get("/runs")
def runs(db: Session = Depends(get_db)):
    return [run_out(row) for row in db.query(Run).order_by(Run.created_at.desc()).limit(30)]


@router.get("/runs/{run_id}")
def run_detail(run_id: str, db: Session = Depends(get_db)):
    row = db.get(Run, run_id)
    if not row:
        raise HTTPException(404, "Attività non trovata")
    return run_out(row)


@router.post("/runs")
async def start_run(body: RunIn, db: Session = Depends(get_db), gateway: LLMGateway = Depends(get_gateway)):
    if not _run_lock.acquire(blocking=False):
        raise HTTPException(429, "Un workflow è già in esecuzione")
    try:
        return run_out(await execute_run(body, db, gateway))
    finally:
        _run_lock.release()
