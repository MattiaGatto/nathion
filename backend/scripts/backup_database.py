"""Consistent SQLite snapshot; authentication secrets stay inside the private backup."""
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import sys
from sqlalchemy.engine import make_url

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import get_settings


def main():
    url = make_url(get_settings().database_url)
    if url.get_backend_name() != "sqlite" or not url.database or url.database == ":memory:":
        raise RuntimeError("Backup automatico disponibile solo per SQLite su file")
    source = Path(url.database).resolve()
    if not source.is_file():
        raise RuntimeError("Database locale assente")
    directory = source.parent / "backups"; directory.mkdir(exist_ok=True)
    target = directory / ("manual-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-%f") + ".sqlite3")
    with sqlite3.connect(str(source)) as origin, sqlite3.connect(str(target)) as backup:
        origin.backup(backup)
        if backup.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Verifica del backup fallita")
    target.chmod(0o600)
    print(target.name)


if __name__ == "__main__":
    main()
