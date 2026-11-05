from app.core.ownership import owned_get
"""Allowlisted local tools. Effects require an authenticated owner's approval."""
import ast
import json
import math
import operator
import asyncio
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.db.models import Memory, ToolAction
from app.db.session import get_db
from app import mcp_bridge
from app.core.config import get_settings

router = APIRouter(prefix="/api/tools", tags=["tools"])
REGISTRY = [
    {"id": "calculator", "description": "Aritmetica locale limitata", "approval": False, "permissions": ["compute"], "input": {"expression": "string, max 200 caratteri"}, "output": "number"},
    {"id": "clock", "description": "Ora UTC del server", "approval": False, "permissions": ["clock.read"], "input": {}, "output": "ISO 8601"},
    {"id": "memory.delete", "description": "Elimina una memoria selezionata", "approval": True, "permissions": ["memory.delete"], "input": {"memory_id": "UUID"}, "output": "deleted id"},
]


def calculate(expression: str) -> float | int:
    if len(expression) > 200:
        raise ValueError("Espressione troppo lunga")
    tree = ast.parse(expression, mode="eval")
    if len(list(ast.walk(tree))) > 60:
        raise ValueError("Espressione troppo complessa")
    operations = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
                  ast.Div: operator.truediv, ast.Mod: operator.mod}
    def visit(node):
        if isinstance(node, ast.Constant) and type(node.value) in {int, float}:
            value = node.value
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = visit(node.operand) * (-1 if isinstance(node.op, ast.USub) else 1)
        elif isinstance(node, ast.BinOp) and type(node.op) in operations:
            value = operations[type(node.op)](visit(node.left), visit(node.right))
        else:
            raise ValueError("Operazione non permessa")
        if not math.isfinite(value) or abs(value) > 1e12:
            raise ValueError("Risultato fuori limite")
        return value
    return visit(tree.body)


class ToolIn(BaseModel):
    tool: Literal["calculator", "clock", "memory.delete", "mcp"]
    expression: str = Field(default="", max_length=200)
    memory_id: str = Field(default="", max_length=36)
    server: str = Field(default="", max_length=80)
    remote_tool: str = Field(default="", max_length=100)
    arguments: dict = Field(default_factory=dict, max_length=50)

    @model_validator(mode="after")
    def bound_arguments(self):
        if len(json.dumps(self.arguments, allow_nan=False)) > 16000:
            raise ValueError("Argomenti troppo grandi")
        return self


@router.get("")
def registry():
    return REGISTRY + [{"id": "mcp", "description": "Strumenti HTTP configurati dal proprietario", "approval": True,
                        "permissions": ["mcp.call"], "servers": list(get_settings().mcp_servers)}]


@router.get("/mcp/{server}")
async def discover_mcp(server: str):
    try:
        mcp_bridge.resolve(server)
        return await mcp_bridge.connect_call(server)
    except ValueError as exc:
        raise HTTPException(403, "Server MCP non configurato") from exc
    except Exception as exc:
        raise HTTPException(503, "Server MCP o SDK opzionale non disponibile") from exc


@router.get("/actions")
def actions(db: Session = Depends(get_db)):
    return db.query(ToolAction).order_by(ToolAction.created_at.desc()).limit(100).all()


@router.delete("/actions/{action_id}", status_code=204)
def delete_action(action_id: str, db: Session = Depends(get_db)):
    action = owned_get(db, ToolAction, action_id)
    if not action:
        raise HTTPException(404, "Operazione non trovata")
    if action.status == "executing":
        raise HTTPException(409, "Operazione in esecuzione")
    db.delete(action); db.commit()


@router.post("/execute")
def execute(body: ToolIn, db: Session = Depends(get_db)):
    if body.tool == "mcp":
        try:
            digest = mcp_bridge.fingerprint(body.server, body.remote_tool)
        except ValueError as exc:
            raise HTTPException(403, "Server o strumento MCP non autorizzato") from exc
        action = ToolAction(tool="mcp", payload=json.dumps({"server": body.server, "tool": body.remote_tool,
                            "arguments": body.arguments, "configuration": digest}, ensure_ascii=False))
        db.add(action); db.commit(); db.refresh(action)
        return action
    if body.tool == "clock":
        return {"status": "completed", "result": datetime.now(timezone.utc).isoformat()}
    if body.tool == "calculator":
        try:
            return {"status": "completed", "result": calculate(body.expression)}
        except (ValueError, SyntaxError, ArithmeticError, OverflowError) as exc:
            raise HTTPException(422, "Espressione non valida o oltre i limiti") from exc
    if not owned_get(db, Memory, body.memory_id):
        raise HTTPException(404, "Memoria non trovata")
    action = ToolAction(tool=body.tool, payload=json.dumps({"memory_id": body.memory_id}))
    db.add(action); db.commit(); db.refresh(action)
    return action


@router.post("/actions/{action_id}/{decision}")
async def decide(action_id: str, decision: Literal["approve", "reject"], db: Session = Depends(get_db)):
    # Conditional update claims the action once, including concurrent requests.
    changed = db.execute(update(ToolAction).where(ToolAction.id == action_id, ToolAction.status == "pending")
                         .values(status="executing" if decision == "approve" else "rejected"))
    if changed.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "Azione inesistente o già decisa")
    action = owned_get(db, ToolAction, action_id)
    if decision == "approve" and action.tool == "mcp":
        # Persist the claim before crossing the network. A crash never retries
        # an operation whose remote effect cannot be established.
        db.commit(); db.refresh(action)
        payload = json.loads(action.payload)
        try:
            if mcp_bridge.fingerprint(payload["server"], payload["tool"]) != payload["configuration"]:
                action.status = "failed"
                action.result = json.dumps({"detail": "Configurazione cambiata. Richiedi una nuova approvazione."})
            else:
                result = await mcp_bridge.connect_call(payload["server"], payload["tool"], payload["arguments"])
                action.status = "failed" if result["is_error"] else "completed"
                action.result = json.dumps(result, ensure_ascii=False)
        except asyncio.CancelledError:
            action.status = "unknown"
            db.commit()
            raise
        except Exception as exc:
            action.status = "unknown"
            action.result = json.dumps({"detail": "Esito remoto non verificabile. Nessun nuovo tentativo automatico.", "error": type(exc).__name__})
    elif decision == "approve":
        memory_id = json.loads(action.payload)["memory_id"]
        memory = owned_get(db, Memory, memory_id)
        if memory:
            db.delete(memory)
        action.status = "completed"
        action.result = json.dumps({"deleted": memory_id})
    db.commit(); db.refresh(action)
    return action
