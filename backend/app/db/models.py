"""
Modelli di persistenza per la Milestone 1.

Scope volutamente minimo: Conversation + Message per la chat testuale,
AppSettings per salvare la scelta del provider/modello fatta dall'utente
dalle impostazioni del frontend. Memoria semantica/episodica (costituzione
§8) arriva nella Milestone 5.
"""
import uuid
from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class MessageRole(str, Enum):
    user = "user"
    assistant = "assistant"
    system = "system"


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String(200), default="Nuova conversazione")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
    )

    def touch(self) -> None:
        """Aggiorna updated_at esplicitamente. SQLAlchemy applica
        `onupdate` solo quando la RIGA della conversazione cambia;\
        aggiungere un Message figlio non la tocca, quindi senza questa
        chiamata lo storico (ordinato per updated_at) non rifletterebbe
        mai l'ultima attivita' reale di una conversazione."""
        self.updated_at = _now()


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"))
    role: Mapped[MessageRole] = mapped_column(SAEnum(MessageRole))
    content: Mapped[str] = mapped_column(Text)
    model_used: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class AppSettings(Base):
    """Singleton key-value per le impostazioni scelte dall'utente
    (es. modello Ollama selezionato). Una sola riga per chiave."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


class Memory(Base):
    __tablename__ = "memories"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    content: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(30))
    source: Mapped[str] = mapped_column(String(200))
    certainty: Mapped[str] = mapped_column(String(20), default="fact")
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    vectors: Mapped[list["MemoryVector"]] = relationship(cascade="all, delete-orphan")


class MemoryVector(Base):
    __tablename__ = "memory_vectors"
    memory_id: Mapped[str] = mapped_column(ForeignKey("memories.id"), primary_key=True)
    model: Mapped[str] = mapped_column(String(200))
    embedding: Mapped[str] = mapped_column(Text)


class Run(Base):
    __tablename__ = "runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    prompt: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="running")
    result: Mapped[str] = mapped_column(Text, default="")
    trace: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ToolAction(Base):
    __tablename__ = "tool_actions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    tool: Mapped[str] = mapped_column(String(50))
    payload: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    result: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
