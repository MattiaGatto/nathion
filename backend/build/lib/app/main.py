"""Entrypoint dell'applicazione FastAPI di NATHION."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat, health, models
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.session import init_db

configure_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info("Avvio %s (ambiente=%s)", settings.app_name, settings.environment)
    init_db()
    yield
    logger.info("Arresto %s", settings.app_name)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(models.router)
    app.include_router(chat.router)

    return app


app = create_app()
