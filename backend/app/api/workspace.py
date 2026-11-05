from app.core.identity import preference_key, owner_id
from app.core.hosting import check_model
from app.core.ownership import owned_get
import json
import asyncio
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session
from sqlalchemy import inspect

from app.db.models import Memory, MemoryVector, Run, AppSettings, Conversation, Message, ToolAction, Schedule
from app.db.session import get_db
from app.llm.gateway import LLMGateway, get_gateway
from app.core.preferences import default_provider
from app.memory import index_memory, retrieve_context
from app.core.config import get_settings
from app.runtime import AGENTS, AgentPatch, MemoryIn, RunIn, discover_skills, execute_run, fingerprint, retrieve, load_agents

router = APIRouter(prefix="/api", tags=["workspace"])
_run_lock = Lock()


@router.get("/agents")
def agents(db: Session = Depends(get_db)):
    return list(load_agents(db).values())


@router.patch("/agents/{agent_id}")
def configure_agent(agent_id: str, body: AgentPatch, db: Session = Depends(get_db)):
    check_model(body.model, "ollama")
    if agent_id not in AGENTS:
        raise HTTPException(404, "Agente non trovato")
    if body.voice_profile != "default" and body.voice_profile not in get_settings().voice_profiles:
        raise HTTPException(422, "Profilo vocale non configurato")
    key = preference_key(f"agent:{agent_id}")
    setting = db.get(AppSettings, key)
    if not setting:
        setting = AppSettings(key=key, value="{}")
        db.add(setting)
    setting.value = body.model_dump_json()
    db.commit()
    return load_agents(db)[agent_id]


@router.get("/skills")
def skills():
    return discover_skills()


@router.get("/memory")
async def memories(response: Response, q: str = Query(default="", max_length=1000), db: Session = Depends(get_db)):
    if not q:
        return db.query(Memory).order_by(Memory.created_at.desc()).limit(100).all()
    rows, mode = await retrieve_context(db, q, retrieve(db, q, 30), 30)
    response.headers["X-Memory-Retrieval"] = mode
    return rows


@router.post("/memory")
async def remember(body: MemoryIn, response: Response, db: Session = Depends(get_db)):
    try:
        digest = fingerprint(body)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    existing = db.query(Memory).filter_by(fingerprint=digest).first()
    if existing:
        response.headers["X-Memory-Indexed"] = str(await index_memory(db, existing)).lower()
        db.refresh(existing)
        return existing
    row = Memory(**body.model_dump(), fingerprint=digest)
    db.add(row); db.commit(); db.refresh(row)
    response.headers["X-Memory-Indexed"] = str(await index_memory(db, row)).lower()
    db.refresh(row)
    return row


@router.delete("/memory/{memory_id}", status_code=204)
def forget(memory_id: str, db: Session = Depends(get_db)):
    row = owned_get(db, Memory, memory_id)
    if not row:
        raise HTTPException(404, "Memoria non trovata")
    db.delete(row); db.commit()


@router.put("/memory/{memory_id}")
async def update_memory(memory_id: str, body: MemoryIn, response: Response, db: Session = Depends(get_db)):
    row = owned_get(db, Memory, memory_id)
    if not row:
        raise HTTPException(404, "Memoria non trovata")
    try:
        digest = fingerprint(body)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    duplicate = db.query(Memory).filter(Memory.fingerprint == digest, Memory.id != memory_id).first()
    if duplicate:
        raise HTTPException(409, "Esiste già una memoria equivalente")
    row.vectors.clear()
    for field, value in body.model_dump().items():
        setattr(row, field, value)
    row.fingerprint = digest
    db.commit(); db.refresh(row)
    response.headers["X-Memory-Indexed"] = str(await index_memory(db, row)).lower()
    db.refresh(row)
    return row


@router.get("/memory-status")
def memory_status(db: Session = Depends(get_db)):
    model = get_settings().memory_embedding_model
    return {"model": model, "total": db.query(Memory).count(),
            "indexed": db.query(MemoryVector).filter_by(model=model).count() if model else 0}


@router.post("/memory/reindex")
async def reindex(db: Session = Depends(get_db)):
    if not get_settings().memory_embedding_model:
        raise HTTPException(409, "Modello embedding non configurato")
    completed = 0
    try:
        async with asyncio.timeout(60):
            rows = db.query(Memory).outerjoin(MemoryVector).filter((MemoryVector.memory_id == None) | (MemoryVector.model != get_settings().memory_embedding_model)).limit(10).all()
            for row in rows:
                if not await index_memory(db, row):
                    break
                completed += 1
    except TimeoutError:
        pass
    return {"completed": completed, **memory_status(db)}


def run_out(row):
    return {"id": row.id, "prompt": row.prompt, "status": row.status,
            "result": row.result, "trace": json.loads(row.trace), "created_at": row.created_at}


@router.get("/runs")
def runs(db: Session = Depends(get_db)):
    return [run_out(row) for row in db.query(Run).order_by(Run.created_at.desc()).limit(30)]


@router.get("/runs/{run_id}")
def run_detail(run_id: str, db: Session = Depends(get_db)):
    row = owned_get(db, Run, run_id)
    if not row:
        raise HTTPException(404, "Attività non trovata")
    return run_out(row)


@router.delete("/runs/{run_id}", status_code=204)
def delete_run(run_id: str, db: Session = Depends(get_db)):
    row = owned_get(db, Run, run_id)
    if not row:
        raise HTTPException(404, "Attività non trovata")
    if row.status == "running":
        raise HTTPException(409, "Attività ancora in esecuzione")
    db.query(Schedule).filter_by(last_run_id=run_id).update({"last_run_id": None})
    db.delete(row); db.commit()


@router.get("/export")
def export_data(db: Session = Depends(get_db)):
    def rows(model):
        fields = [column.key for column in inspect(model).column_attrs]
        return [{field: getattr(row, field) for field in fields} for row in db.query(model).all()]
    prefix = "" if owner_id() == "owner" else f"user:{owner_id()}:"
    preferences = db.query(AppSettings).all()
    return {"format_version": 1, "conversations": rows(Conversation), "messages": rows(Message),
            "memory": rows(Memory), "runs": rows(Run), "tool_actions": rows(ToolAction), "schedules": rows(Schedule),
            "preferences": [{"key": row.key[len(prefix):], "value": row.value} for row in preferences
                            if row.key in {prefix + "default_model", prefix + "default_provider"} or row.key.startswith(prefix + "agent:")]}


@router.post("/runs")
async def start_run(body: RunIn, db: Session = Depends(get_db), gateway: LLMGateway = Depends(get_gateway)):
    if not _run_lock.acquire(blocking=False):
        raise HTTPException(429, "Un workflow è già in esecuzione")
    try:
        body.provider = body.provider or default_provider(db)
        return run_out(await execute_run(body, db, gateway))
    finally:
        _run_lock.release()
