"""Entrypoint dell'applicazione FastAPI di NATHION."""
import logging
import asyncio
from contextlib import suppress
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import chat, health, models, voice, voice_socket, workspace, tools, schedules, proposals
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core import ownership  # Register tenant guards before serving requests
from app.db.session import init_db, SessionLocal, get_db
from app.db.models import Run, ToolAction, Schedule
from app.core.auth import AuthenticationMiddleware, initialize_auth, router as auth_router

configure_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    scheduler = None
    logger.info("Avvio %s (ambiente=%s)", settings.app_name, settings.environment)
    if get_db not in app.dependency_overrides:
        init_db()
        initialize_auth()
        if settings.auth_enabled:
            from app.core.auth import ensure_owner
            with SessionLocal() as db:
                ensure_owner(db)
        with SessionLocal() as db:
            db.info["system"] = True
            db.query(Run).filter_by(status="running").update({"status": "interrupted"})
            db.query(ToolAction).filter_by(status="executing").update({"status": "unknown"})
            db.query(Schedule).filter_by(last_status="running").update({"last_status": "interrupted"})
            db.commit()
        from app.scheduler import serve
        scheduler = asyncio.create_task(serve())
    yield
    if scheduler:
        scheduler.cancel()
        with suppress(asyncio.CancelledError):
            await scheduler
    logger.info("Arresto %s", settings.app_name)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.add_middleware(AuthenticationMiddleware)

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
    app.include_router(voice.router)
    app.include_router(voice_socket.router)
    app.include_router(workspace.router)
    app.include_router(auth_router)
    app.include_router(tools.router)
    app.include_router(schedules.router)
    app.include_router(proposals.router)

    return app


app = create_app()
