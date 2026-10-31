"""Healthcheck — usato da Docker Compose e dal frontend per lo
'Indicatore dello stato dell'assistente' (costituzione §4.1)."""
from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
