from app.core.hosting import authorize_compute
from app.core.ownership import owned_get
"""
API di chat: CRUD conversazioni su REST, scambio messaggi in streaming
su WebSocket.

Flusso WebSocket (`/ws/chat/{conversation_id}`):
1. Il client si connette, passando `model` (e opzionalmente `provider`)
   come query param.
2. Il client invia un messaggio testuale puro (il contenuto dell'utente).
3. Il server salva il messaggio utente, chiama il gateway LLM in
   streaming, inoltra ogni chunk al client, poi salva la risposta
   completa e invia un marker di fine.
"""
import logging
import asyncio
import json
from contextlib import suppress
from pydantic import ValidationError

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.db.models import Conversation, Message, MessageRole
from app.db.session import get_db
from app.llm.base import ChatMessage, LLMProviderError, OutputLimitError
from app.llm.gateway import LLMGateway, get_gateway
from app.core.preferences import default_provider
from app.schemas.chat import (
    ConversationDetailOut,
    ConversationOut,
    CreateConversationIn,
    SendMessageIn,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])

_TITLE_MAX_LENGTH = 60
_DEFAULT_TITLE = "Nuova conversazione"


def _derive_title(text: str) -> str:
    """Titolo leggibile per lo storico conversazioni, ricavato dal primo
    messaggio utente (altrimenti ogni voce della sidebar si chiamerebbe
    'Nuova conversazione' e sarebbe impossibile distinguerle)."""
    cleaned = " ".join(text.strip().split())
    if len(cleaned) <= _TITLE_MAX_LENGTH:
        return cleaned or _DEFAULT_TITLE
    return cleaned[: _TITLE_MAX_LENGTH - 1].rstrip() + "…"


def _touch_and_maybe_title(conversation: Conversation, first_user_text: str) -> None:
    """Aggiorna updated_at (cosi' l'ordinamento dello storico riflette
    l'ultima attivita', non solo le modifiche al titolo) e imposta il
    titolo al primo messaggio, se non e' ancora stato personalizzato."""
    conversation.touch()
    if conversation.title == _DEFAULT_TITLE:
        conversation.title = _derive_title(first_user_text)


@router.post("/conversations", response_model=ConversationOut)
async def create_conversation(
    body: CreateConversationIn, db: Session = Depends(get_db)
) -> Conversation:
    conversation = Conversation(title=body.title or "Nuova conversazione")
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return conversation


@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(db: Session = Depends(get_db)) -> list[Conversation]:
    return db.query(Conversation).order_by(Conversation.updated_at.desc()).all()


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailOut)
async def get_conversation(conversation_id: str, db: Session = Depends(get_db)) -> Conversation:
    conversation = owned_get(db, Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversazione non trovata")
    return conversation


@router.delete("/conversations/{conversation_id}", status_code=204)
async def delete_conversation(conversation_id: str, db: Session = Depends(get_db)) -> None:
    conversation = owned_get(db, Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversazione non trovata")
    db.delete(conversation)  # cascade="all, delete-orphan" elimina anche i messaggi
    db.commit()


@router.post("/conversations/{conversation_id}/messages", response_model=ConversationDetailOut)
async def send_message(
    conversation_id: str,
    body: SendMessageIn,
    db: Session = Depends(get_db),
    gateway: LLMGateway = Depends(get_gateway),
) -> Conversation:
    """Versione non-streaming (REST), usata nei test automatici e come
    fallback se il client non vuole gestire il WebSocket."""
    conversation = owned_get(db, Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversazione non trovata")

    authorize_compute(body.model, body.provider or default_provider(db), charge=False)
    user_message = Message(
        conversation_id=conversation_id, role=MessageRole.user, content=body.content
    )
    db.add(user_message)
    _touch_and_maybe_title(conversation, body.content)
    db.commit()

    history = [ChatMessage(role=m.role.value, content=m.content) for m in conversation.messages]

    try:
        reply = await gateway.chat(history, model=body.model, provider=body.provider or default_provider(db))
    except (LLMProviderError, ValueError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    assistant_message = Message(
        conversation_id=conversation_id,
        role=MessageRole.assistant,
        content=reply,
        model_used=body.model,
    )
    db.add(assistant_message)
    db.commit()
    db.refresh(conversation)
    return conversation


@router.websocket("/ws/chat/{conversation_id}")
async def chat_websocket(
    websocket: WebSocket,
    conversation_id: str,
    model: str,
    provider: str | None = None,
    db: Session = Depends(get_db),
    gateway: LLMGateway = Depends(get_gateway),
) -> None:
    await websocket.accept()
    conversation = owned_get(db, Conversation, conversation_id)
    if conversation is None:
        await websocket.send_json({"type": "error", "detail": "Conversazione non trovata"})
        await websocket.close(code=4404)
        return
    job: asyncio.Task | None = None

    async def generate(history):
        try:
            full_reply = ""
            async for chunk in gateway.chat_stream(history, model=model, provider=provider or default_provider(db)):
                full_reply += chunk
                await websocket.send_json({"type": "chunk", "content": chunk})
            message = Message(conversation_id=conversation_id, role=MessageRole.assistant,
                              content=full_reply, model_used=model)
            db.add(message)
            db.commit()
            await websocket.send_json({"type": "done", "message_id": message.id})
        except OutputLimitError as exc:
            await websocket.send_json({"type": "error", "code": "output_limit", "detail": str(exc)})
        except HTTPException as exc:
            await websocket.send_json({"type": "error", "detail": exc.detail})
        except (LLMProviderError, ValueError) as exc:
            await websocket.send_json({"type": "error", "detail": str(exc)})
        except (WebSocketDisconnect, OSError):
            return
        except asyncio.CancelledError:
            raise
        except Exception:
            db.rollback()
            logger.exception("Errore di generazione nella conversazione %s", conversation_id)
            await websocket.send_json({"type": "error", "detail": "Generazione fallita. Riprova."})

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = None
            if isinstance(payload, dict) and payload.get("type") == "cancel":
                if job and not job.done():
                    job.cancel()
                    with suppress(asyncio.CancelledError):
                        await job
                job = None
                await websocket.send_json({"type": "cancelled"})
                continue
            if job and not job.done():
                await websocket.send_json({"type": "busy"})
                continue
            content = payload.get("content") if isinstance(payload, dict) and payload.get("type") == "message" else raw
            try:
                body = SendMessageIn(content=content, model=model, provider=provider)
            except ValidationError:
                await websocket.send_json({"type": "error", "detail": "Messaggio non valido (massimo 12000 caratteri)."})
                continue
            try:
                authorize_compute(model, provider or default_provider(db), charge=False)
            except HTTPException as exc:
                await websocket.send_json({"type": "error", "detail": exc.detail})
                continue
            db.add(Message(conversation_id=conversation_id, role=MessageRole.user, content=body.content))
            _touch_and_maybe_title(conversation, body.content)
            db.commit()
            history = [ChatMessage(role=m.role.value, content=m.content) for m in conversation.messages]
            if isinstance(payload, dict) and payload.get("voice") is True:
                history.insert(0, ChatMessage(role="system", content=(
                    "Rispondi in italiano naturale, adatto alla lettura ad alta voce. "
                    "Dai prima la risposta utile, di norma in due o tre frasi. "
                    "Evita tabelle e formattazione elaborata. Se non hai eseguito un'azione, dillo chiaramente."
                )))
            job = asyncio.create_task(generate(history))
    except WebSocketDisconnect:
        logger.info("Client disconnesso dalla conversazione %s", conversation_id)
    finally:
        if job:
            if not job.done():
                job.cancel()
            with suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError, OSError):
                await job
