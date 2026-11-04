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

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.db.models import Conversation, Message, MessageRole
from app.db.session import SessionLocal, get_db
from app.llm.base import ChatMessage, LLMProviderError
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
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversazione non trovata")
    return conversation


@router.delete("/conversations/{conversation_id}", status_code=204)
async def delete_conversation(conversation_id: str, db: Session = Depends(get_db)) -> None:
    conversation = db.get(Conversation, conversation_id)
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
    conversation = db.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversazione non trovata")

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
) -> None:
    await websocket.accept()

    # Sessione dedicata a questa connessione, aperta e chiusa qui
    # esplicitamente: `next(get_db())` avrebbe lasciato la generator
    # function di `get_db` sospesa, con il suo `finally` (altro
    # `db.close()`) eseguito solo alla garbage collection invece che in
    # modo deterministico.
    db: Session = SessionLocal()
    gateway = get_gateway()

    try:
        conversation = db.get(Conversation, conversation_id)
        if conversation is None:
            await websocket.send_json({"type": "error", "detail": "Conversazione non trovata"})
            await websocket.close(code=4404)
            return

        while True:
            user_text = await websocket.receive_text()

            user_message = Message(
                conversation_id=conversation_id, role=MessageRole.user, content=user_text
            )
            db.add(user_message)
            _touch_and_maybe_title(conversation, user_text)
            db.commit()

            history = [
                ChatMessage(role=m.role.value, content=m.content) for m in conversation.messages
            ]

            full_reply = ""
            try:
                async for chunk in gateway.chat_stream(history, model=model, provider=provider or default_provider(db)):
                    full_reply += chunk
                    await websocket.send_json({"type": "chunk", "content": chunk})
            except (LLMProviderError, ValueError) as exc:
                await websocket.send_json({"type": "error", "detail": str(exc)})
                continue

            assistant_message = Message(
                conversation_id=conversation_id,
                role=MessageRole.assistant,
                content=full_reply,
                model_used=model,
            )
            db.add(assistant_message)
            db.commit()

            await websocket.send_json({"type": "done", "message_id": assistant_message.id})

    except WebSocketDisconnect:
        logger.info("Client disconnesso dalla conversazione %s", conversation_id)
    finally:
        db.close()
