"""Local Windows MCP connector with fixed actions and a separate shared secret."""
import hmac
import os
import platform
import shutil
import subprocess
from pathlib import Path

import uvicorn
from mcp.server import MCPServer
from starlette.responses import JSONResponse

ROOT = Path(__file__).resolve().parent.parent
KEY = (ROOT / "backend/data/pc-connector-key.txt").read_text(encoding="utf-8").strip()
if os.name != "nt" or len(KEY) < 32:
    raise RuntimeError("Configurazione connettore Windows non valida")

server = MCPServer("NATHION PC")


@server.tool()
def pc_status() -> str:
    """Show the Windows version, processor count and free project disk space."""
    free_gib = shutil.disk_usage(ROOT).free / 2**30
    return f"Windows {platform.release()}. Processori logici: {os.cpu_count()}. Spazio libero: {free_gib:.1f} GiB."


def open_builtin(name: str, label: str) -> str:
    executable = Path(os.environ["SystemRoot"]) / "System32" / name
    subprocess.Popen([str(executable)], shell=False)
    return f"Avvio di {label} richiesto a Windows."


@server.tool()
def open_calculator() -> str:
    """Open Windows Calculator in the active desktop session."""
    return open_builtin("calc.exe", "Calcolatrice")


@server.tool()
def open_notepad() -> str:
    """Open Windows Notepad without passing a filename or command."""
    return open_builtin("notepad.exe", "Blocco note")


mcp_app = server.streamable_http_app()


async def app(scope, receive, send):
    if scope["type"] == "http":
        headers = dict(scope["headers"])
        expected = ("Bearer " + KEY).encode("ascii")
        if not hmac.compare_digest(headers.get(b"authorization", b""), expected):
            return await JSONResponse({"detail": "Accesso richiesto"}, status_code=401)(scope, receive, send)
    await mcp_app(scope, receive, send)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=18753, access_log=False)
