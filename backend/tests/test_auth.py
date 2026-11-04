from app.core.auth import initialize_auth
from app.core.config import get_settings
from starlette.websockets import WebSocketDisconnect
import pytest


def test_auth_protects_http_websocket_and_logout(client, tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "auth_enabled", True)
    monkeypatch.setattr(get_settings(), "auth_token_file", str(tmp_path / "token"))
    initialize_auth()
    token = (tmp_path / "token").read_text()
    assert client.get("/health").status_code == 200
    assert client.get("/api/memory").status_code == 401
    with pytest.raises(WebSocketDisconnect) as error:
        with client.websocket_connect("/api/voice/ws"):
            pass
    assert error.value.code == 4401
    assert client.post("/api/auth/login", json={"token": "bad"}).status_code == 401
    assert client.post("/api/auth/login", json={"token": token}).status_code == 200
    assert client.get("/api/memory").status_code == 200
    assert client.post("/api/memory", headers={"origin": "https://evil.example"}, json={"content": "test"}).status_code == 403
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/memory").status_code == 401
    assert client.get("/api/memory", headers={"authorization": f"Bearer {token}"}).status_code == 200
