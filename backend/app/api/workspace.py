from app.core.identity import preference_key, owner_id
from app.core.hosting import check_model
from app.core.ownership import owned_get
import json
import asyncio
import hashlib
import re
from datetime import timezone
from pathlib import PurePath
from threading import Lock
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from sqlalchemy.orm import Session
from sqlalchemy import inspect

from app.db.models import Memory, MemoryVector, Run, AppSettings, Conversation, Message, ToolAction, Schedule
from app.db.session import get_db
from app.llm.gateway import LLMGateway, get_gateway
from app.core.preferences import default_provider
from app.memory import index_memory, retrieve_context
from app.core.config import get_settings
from app.runtime import (AGENTS, AgentIdentity, AgentPatch, MemoryIn, RunIn, Task, VoiceTurn, discover_skills, execute_run,
                         fingerprint, retrieve, load_agents, resolve_voice_agent, spoken_words)

from app.agent_documents import MAX_BYTES, MAX_DOCUMENTS, document_info, document_prefix, documents, extract_text

router = APIRouter(prefix="/api", tags=["workspace"])
_run_lock = Lock()


@router.get("/agents")
def agents(db: Session = Depends(get_db)):
    return list(load_agents(db).values())


def unique_agent_name(existing, name: str, exclude: str = ""):
    words = spoken_words(name)
    if any(agent.id != exclude and spoken_words(agent.name) == words for agent in existing.values()):
        raise HTTPException(409, "Esiste già un agente con questo nome")


@router.post("/agents", status_code=201)
async def create_agent(body: AgentIdentity, db: Session = Depends(get_db)):
    existing = load_agents(db)
    unique_agent_name(existing, body.name)
    if sum(agent.custom for agent in existing.values()) >= 12:
        raise HTTPException(409, "Puoi creare fino a 12 agenti personali")
    agent_id = f"custom-{uuid4().hex[:20]}"
    db.add(AppSettings(key=preference_key(f"agent:{agent_id}"), value=body.model_dump_json()))
    db.commit()
    return load_agents(db)[agent_id]


@router.patch("/agents/{agent_id}")
async def configure_agent(agent_id: str, body: AgentPatch, db: Session = Depends(get_db)):
    check_model(body.model, "ollama")
    existing = load_agents(db)
    agent = existing.get(agent_id)
    if not agent:
        raise HTTPException(404, "Agente non trovato")
    if body.identity:
        if not agent.custom:
            raise HTTPException(422, "Nome e ruolo sono modificabili solo per gli agenti personali")
        unique_agent_name(existing, body.identity.name, exclude=agent_id)
    if body.voice_profile != "default" and body.voice_profile not in get_settings().voice_profiles:
        raise HTTPException(422, "Profilo vocale non configurato")
    key = preference_key(f"agent:{agent_id}")
    setting = db.get(AppSettings, key)
    if not setting:
        setting = AppSettings(key=key, value="{}")
        db.add(setting)
    values = json.loads(setting.value)
    values.update(body.model_dump(exclude_unset=True, exclude={"identity"}))
    if body.identity:
        values.update(body.identity.model_dump())
    setting.value = json.dumps(values, ensure_ascii=False)
    db.commit()
    return load_agents(db)[agent_id]


@router.get("/agents/presets")
def agent_presets(db: Session = Depends(get_db)):
    active = load_agents(db)
    return [{"id": agent.id, "name": agent.name, "job_role": agent.job_role, "description": agent.description}
            for agent in AGENTS.values() if agent.id not in active]


@router.post("/agents/presets/{agent_id}", status_code=201)
async def restore_agent_preset(agent_id: str, db: Session = Depends(get_db)):
    preset = AGENTS.get(agent_id)
    if not preset:
        raise HTTPException(404, "Preset non trovato")
    active = load_agents(db)
    if agent_id in active:
        raise HTTPException(409, "Questo agente è già attivo")
    unique_agent_name(active, preset.name)
    key = preference_key(f"agent:{agent_id}")
    setting = db.get(AppSettings, key)
    if setting:
        setting.value = '{"enabled": true}'
    else:
        db.add(AppSettings(key=key, value='{"enabled": true}'))
    db.commit()
    return load_agents(db)[agent_id]


@router.delete("/agents/{agent_id}", status_code=204)
async def delete_agent(agent_id: str, db: Session = Depends(get_db)):
    agent = load_agents(db).get(agent_id)
    if not agent:
        raise HTTPException(404, "Agente non trovato")
    for document in documents(db, agent_id):
        db.delete(document)
    key = preference_key(f"agent:{agent_id}")
    setting = db.get(AppSettings, key)
    if agent.custom:
        db.delete(setting)
    elif setting:
        setting.value = '{"deleted": true}'
    else:
        db.add(AppSettings(key=key, value='{"deleted": true}'))
    db.commit()


@router.get("/agents/{agent_id}/documents")
def list_agent_documents(agent_id: str, db: Session = Depends(get_db)):
    if agent_id not in load_agents(db):
        raise HTTPException(404, "Agente non trovato")
    return [document_info(row) for row in documents(db, agent_id)]


@router.post("/agents/{agent_id}/documents", status_code=201)
async def add_agent_document(agent_id: str, request: Request, name: str = Query(min_length=1, max_length=180),
                             db: Session = Depends(get_db)):
    if agent_id not in load_agents(db):
        raise HTTPException(404, "Agente non trovato")
    name = PurePath(name.replace("\\", "/")).name.strip()
    if not name or any(not character.isprintable() for character in name):
        raise HTTPException(422, "Nome file non valido")
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_BYTES:
            raise HTTPException(413, "Il file supera 8 MB")
        content.extend(chunk)
    try:
        text = await run_in_threadpool(extract_text, name, bytes(content))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(422, "Impossibile leggere il documento. Controlla che il file sia integro.") from exc
    # The agent may have been removed while the document was being parsed.
    if agent_id not in load_agents(db):
        raise HTTPException(404, "Agente non trovato")
    doc_id = hashlib.sha256(text.encode()).hexdigest()[:24]
    key = document_prefix(agent_id) + doc_id
    if db.get(AppSettings, key):
        raise HTTPException(409, "Questo testo è già presente nella memoria dell’agente")
    existing = documents(db, agent_id)
    if any(document_info(item)["name"].casefold() == name.casefold() for item in existing):
        raise HTTPException(409, "Nome già presente. Rimuovi il documento precedente oppure rinomina il nuovo file.")
    if len(existing) >= MAX_DOCUMENTS:
        raise HTTPException(409, "Limite di 24 documenti per agente raggiunto")
    row = AppSettings(key=key, value=json.dumps({"name": name, "text": text}, ensure_ascii=False))
    db.add(row)
    db.commit()
    return document_info(row)


@router.delete("/agents/{agent_id}/documents/{doc_id}", status_code=204)
def delete_agent_document(agent_id: str, doc_id: str, db: Session = Depends(get_db)):
    if agent_id not in load_agents(db) or not re.fullmatch(r"[0-9a-f]{24}", doc_id):
        raise HTTPException(404, "Documento non trovato")
    row = db.get(AppSettings, document_prefix(agent_id) + doc_id)
    if not row:
        raise HTTPException(404, "Documento non trovato")
    db.delete(row)
    db.commit()


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
            "result": row.result, "trace": json.loads(row.trace), "created_at": row.created_at.replace(tzinfo=row.created_at.tzinfo or timezone.utc).isoformat()}


@router.get("/runs")
def runs(db: Session = Depends(get_db)):
    return [run_out(row) for row in db.query(Run).order_by(Run.created_at.desc()).limit(30)]


@router.get("/runs/log")
def run_log(db: Session = Depends(get_db)):
    return [run_out(row) for row in db.query(Run).order_by(Run.created_at.desc())]


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
                            if row.key in {prefix + "default_model", prefix + "default_provider", prefix + "personal_profile"} or row.key.startswith(prefix + "agent:")]}


async def run_workflow(body, db, gateway, agents=None):
    if not _run_lock.acquire(blocking=False):
        raise HTTPException(429, "Un workflow è già in esecuzione")
    try:
        body.provider = body.provider or default_provider(db)
        return run_out(await execute_run(body, db, gateway, agents))
    finally:
        _run_lock.release()


@router.post("/runs")
async def start_run(body: RunIn, db: Session = Depends(get_db), gateway: LLMGateway = Depends(get_gateway)):
    return await run_workflow(body, db, gateway)


class VoiceTargetIn(BaseModel):
    command: str = Field(min_length=1, max_length=24100)


class VoiceRunIn(VoiceTargetIn):
    agent_id: str | None = Field(default=None, max_length=60)
    history: list[VoiceTurn] = Field(default_factory=list, max_length=3)
    model: str | None = Field(default=None, min_length=1, max_length=200)


@router.post("/runs/voice/target")
def voice_target(body: VoiceTargetIn, db: Session = Depends(get_db)):
    agent, prompt = resolve_voice_agent(load_agents(db), body.command, allow_empty=True)
    return {"id": agent.id, "name": agent.name, "voice_profile": agent.voice_profile, "prompt": prompt}


@router.post("/runs/voice")
async def voice_run(body: VoiceRunIn, db: Session = Depends(get_db), gateway: LLMGateway = Depends(get_gateway)):
    agents = load_agents(db)
    if body.agent_id:
        agent = agents.get(body.agent_id)
        if not agent:
            raise HTTPException(404, "L’agente non è più disponibile. Torna a Nathion o scegli un altro agente.")
        prompt = body.command.strip()
        if not prompt:
            raise HTTPException(422, "Dimmi cosa vuoi chiedere all’agente.")
    else:
        agent, prompt = resolve_voice_agent(agents, body.command)
    model = agent.model or body.model
    if not model:
        raise HTTPException(422, "Scegli un modello per l’agente o per la chat")
    if len(prompt) > 24000:
        raise HTTPException(422, "La richiesta supera 24.000 caratteri")
    task = Task(id="direct", agent_id=agent.id, instruction=prompt)
    run = await run_workflow(RunIn(prompt=prompt, model=model, tasks=[task], voice_history=body.history), db, gateway, agents)
    return {**run, "agent_name": agent.name, "voice_profile": agent.voice_profile}
