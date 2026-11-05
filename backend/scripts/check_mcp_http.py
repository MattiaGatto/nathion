"""Real HTTP MCP handshake/call plus approval API, with isolated temporary data."""
import json
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import get_settings, MCPConnection
from app.db.models import Base
from app.db.session import get_db
from app.main import app


def main():
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("mcp_verification_server.py")), "--port", str(port)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
    settings = get_settings()
    original_auth, original_servers = settings.auth_enabled, settings.mcp_servers
    try:
        deadline = time.monotonic() + 30
        while True:
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1):
                    break
            except OSError:
                if process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError("Server di verifica MCP non pronto")
                time.sleep(0.2)
        settings.auth_enabled = False  # Isolated TestClient only, never production.
        settings.mcp_servers = {"verification": MCPConnection(url=f"http://127.0.0.1:{port}/mcp", allowed_tools=["add"])}
        with tempfile.TemporaryDirectory() as directory:
            engine = create_engine(f"sqlite:///{Path(directory) / 'test.db'}", connect_args={"check_same_thread": False})
            Base.metadata.create_all(engine)
            sessions = sessionmaker(bind=engine)
            def isolated_db():
                with sessions() as db:
                    yield db
            app.dependency_overrides[get_db] = isolated_db
            with TestClient(app) as client:
                discovered = client.get("/api/tools/mcp/verification")
                assert discovered.status_code == 200, discovered.text
                assert discovered.json()[0]["name"] == "add"
                action = client.post("/api/tools/execute", json={"tool": "mcp", "server": "verification", "remote_tool": "add", "arguments": {"a": 2, "b": 3}}).json()
                assert action["status"] == "pending"
                result = client.post(f"/api/tools/actions/{action['id']}/approve").json()
                assert result["status"] == "completed", result
                assert "5" in json.loads(result["result"])["text"]
            engine.dispose()
        report = {"transport": "Streamable HTTP", "sdk": "official Python MCP", "tool": "add", "result": 5,
                  "approval_verified": True, "production_data_used": False}
        (ROOT / "backend/data/voice-check/mcp-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report))
    finally:
        app.dependency_overrides.pop(get_db, None)
        settings.auth_enabled, settings.mcp_servers = original_auth, original_servers
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait(timeout=5)


if __name__ == "__main__":
    main()
