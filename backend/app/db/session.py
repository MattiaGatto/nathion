"""
Gestione della sessione database (SQLAlchemy, engine SQLite).
"""
from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
import sqlite3
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.db.models import Base

@event.listens_for(Engine, "connect")
def sqlite_integrity(connection, record):
    if isinstance(connection, sqlite3.Connection):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=5000")


settings = get_settings()

if "sqlite" in settings.database_url:
    # Garantisce che ./data esista prima che SQLite provi ad aprire il
    # file — altrimenti create_engine fallisce con "unable to open
    # database file" al primo utilizzo.
    settings.data_dir

# check_same_thread=False: necessario con SQLite quando FastAPI gestisce
# le richieste su thread diversi dal thread di avvio.
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    """Crea le tabelle se non esistono. Per questa milestone niente
    migration tool (Alembic) ancora: viene introdotto quando lo schema
    inizia a cambiare in modo incompatibile tra ambienti."""
    from app.db.migrations import migrate_ownership
    migrate_ownership(engine)
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
