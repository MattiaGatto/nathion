"""Non-destructive SQLite ownership upgrade, with a pre-migration snapshot."""
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import inspect, text

TABLES = ("conversations", "messages", "memories", "memory_vectors", "runs", "tool_actions", "schedules")


def migrate_ownership(engine):
    inspector = inspect(engine)
    existing = set(inspector.get_table_names())
    missing = [table for table in TABLES if table in existing and "owner_id" not in {column["name"] for column in inspector.get_columns(table)}]
    if not missing:
        return None
    if engine.dialect.name != "sqlite":
        raise RuntimeError("Migrazione ownership automatica disponibile solo per SQLite")
    backup = None
    database = engine.url.database
    if database and database != ":memory:":
        path = Path(database).resolve()
        directory = path.parent / "backups"
        directory.mkdir(exist_ok=True)
        backup = directory / ("pre-accounts-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f") + ".sqlite3")
        with sqlite3.connect(str(path)) as source, sqlite3.connect(str(backup)) as target:
            source.backup(target)
        backup.chmod(0o600)
    with engine.begin() as connection:
        for table in missing:
            connection.execute(text(f'ALTER TABLE "{table}" ADD COLUMN owner_id VARCHAR(36) NOT NULL DEFAULT \'owner\''))
            connection.execute(text(f'CREATE INDEX IF NOT EXISTS "ix_{table}_owner_id" ON "{table}" (owner_id)'))
    return backup
