"""Schemi Pydantic per request/response delle API di chat."""
from datetime import datetime

from pydantic import BaseModel


class MessageOut(BaseModel):
    id: str
    role: str
    content: str
    model_used: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationOut(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ConversationDetailOut(ConversationOut):
    messages: list[MessageOut]


class CreateConversationIn(BaseModel):
    title: str | None = None


class SendMessageIn(BaseModel):
    content: str
    model: str
    provider: str | None = None


class ModelOut(BaseModel):
    id: str
    label: str
    size_bytes: int | None = None


class SettingsOut(BaseModel):
    default_provider: str
    default_model: str | None


class SettingsIn(BaseModel):
    default_provider: str
    default_model: str
