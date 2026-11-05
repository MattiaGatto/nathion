"""Schemi Pydantic per request/response delle API di chat."""
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


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
    content: str = Field(min_length=1, max_length=12000)
    model: str = Field(min_length=1, max_length=200)
    provider: str | None = None

    @field_validator("content")
    @classmethod
    def meaningful_content(cls, content):
        if not content.strip():
            raise ValueError("Messaggio vuoto")
        return content


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
