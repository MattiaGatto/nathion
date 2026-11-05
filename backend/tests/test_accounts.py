"""Adversarial account, tenant, session and migration regression tests."""
from datetime import datetime, timedelta, timezone
import json
import sqlite3

import pytest
from sqlalchemy import create_engine, text
from starlette.websockets import WebSocketDisconnect

from app.core.auth import initialize_auth, ensure_owner, hash_password, digest, COOKIE, _attempts
from app.core.config import get_settings
from app.core.identity import identity, Principal
from app.core.ownership import owned_get
from app.db.models import User, UserSession, Memory, Run, UsageDay, AppSettings
from app.db.migrations import migrate_ownership


@pytest.fixture
def accounts(client, db_session, monkeypatch, tmp_path):
    settings = get_settings()
    monkeypatch.setattr(settings, "auth_enabled", True)
    monkeypatch.setattr(settings, "auth_token_file", str(tmp_path / "access-token.txt"))
    monkeypatch.setattr(settings, "auth_cookie_secure", False)
    monkeypatch.setattr(settings, "memory_embedding_model", "")
    _attempts.clear(); initialize_auth()
    owner = ensure_owner(db_session)
    owner.must_change_password = False
    encoded = hash_password("a long test password")
    owner.password_hash = encoded
    for key in ("alice", "bob"):
        db_session.add(User(id=key, username=key, display_name=key, password_hash=encoded,
            role="member", status="active", hosted_access=True, allowed_models='["stub-model"]', daily_limit=5))
        db_session.add(UserSession(token_hash=digest(key + "-session"), user_id=key,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1)))
    db_session.commit()
    def headers(key):
        return {"Cookie": f"{COOKIE}={key}-session"}
    admin = {"Authorization": "Bearer " + (tmp_path / "access-token.txt").read_text()}
    yield client, db_session, headers, admin
    _attempts.clear()


def test_tenants_cannot_read_change_or_delete_each_others_data(accounts):
    client, db, headers, admin = accounts
    a, b = headers("alice"), headers("bob")
    memory = client.post("/api/memory", headers=a, json={"content": "Dato privato"}).json()
    duplicate_other = client.post("/api/memory", headers=b, json={"content": "Dato privato"}).json()
    assert memory["id"] != duplicate_other["id"]
    assert [row["id"] for row in client.get("/api/memory", headers=b).json()] == [duplicate_other["id"]]
    assert client.put("/api/memory/" + memory["id"], headers=b, json={"content": "intrusione"}).status_code == 404
    assert client.delete("/api/memory/" + memory["id"], headers=b).status_code == 404
    conversation = client.post("/api/chat/conversations", headers=a, json={}).json()
    assert client.get("/api/chat/conversations/" + conversation["id"], headers=b).status_code == 404
    assert client.delete("/api/chat/conversations/" + conversation["id"], headers=b).status_code == 404
    assert client.post("/api/chat/conversations/" + conversation["id"] + "/messages", headers=b,
        json={"content": "test", "model": "stub-model"}).status_code == 404
    with client.websocket_connect(f'/api/chat/ws/chat/{conversation["id"]}?model=stub-model', headers=b) as socket:
        assert socket.receive_json()["type"] == "error"
    assert client.get("/api/memory", headers=admin).json() == []


def test_private_preferences_and_export_do_not_leak(accounts):
    client, db, headers, admin = accounts
    assert client.put("/api/settings", headers=headers("alice"), json={"default_provider": "ollama", "default_model": "stub-model"}).status_code == 200
    assert client.patch("/api/agents/general", headers=headers("alice"), json={"model": "stub-model"}).status_code == 200
    assert client.get("/api/settings", headers=headers("bob")).json()["default_model"] is None
    assert client.get("/api/agents", headers=headers("bob")).json()[0]["model"] is None
    export = client.get("/api/export", headers=headers("bob")).json()
    assert export["preferences"] == []
    assert client.get("/api/export", headers=admin).json()["preferences"] == []
    assert all(not key.startswith("user:") for key in [row["key"] for row in client.get("/api/export", headers=headers("alice")).json()["preferences"]])


def test_members_cannot_invoke_admin_apis_or_unapproved_models(accounts):
    client, db, headers, admin = accounts
    a = headers("alice")
    for path in ("/api/auth/admin/users", "/api/auth/admin/invitations", "/api/tools", "/api/schedules"):
        assert client.get(path, headers=a).status_code == 403
    assert client.post("/api/auth/admin/invitations", headers=a, json={"label": "test"}).status_code == 403
    assert client.put("/api/settings", headers=a, json={"default_provider": "stub", "default_model": "stub-model"}).status_code == 403
    assert client.patch("/api/agents/general", headers=a, json={"model": "forbidden"}).status_code == 403
    assert client.get("/api/models?provider=stub", headers=a).status_code == 403
    conv = client.post("/api/chat/conversations", headers=a, json={}).json()
    path = f'/api/chat/conversations/{conv["id"]}/messages'
    assert client.post(path, headers=a, json={"content": "test", "model": "forbidden"}).status_code == 403
    assert client.post(path, headers=a, json={"content": "test", "model": "stub-model", "provider": "stub"}).status_code == 403
    assert client.get("/api/providers", headers=a).json() == ["ollama"]


def test_quota_is_shared_by_chat_and_agents_and_is_per_user(accounts):
    client, db, headers, admin = accounts
    user = db.get(User, "alice"); user.daily_limit = 1; db.commit()
    a = headers("alice")
    conv = client.post("/api/chat/conversations", headers=a, json={}).json()
    path = f'/api/chat/conversations/{conv["id"]}/messages'
    assert client.post(path, headers=a, json={"content": "one", "model": "stub-model"}).status_code == 200
    assert client.post(path, headers=a, json={"content": "two", "model": "stub-model"}).status_code == 429
    run = client.post("/api/runs", headers=a, json={"prompt": "test", "model": "stub-model"}).json()
    assert run["status"] == "failed"
    assert db.query(UsageDay).filter_by(user_id="alice").one().used == 1
    other = client.post("/api/chat/conversations", headers=headers("bob"), json={}).json()
    assert client.post(f'/api/chat/conversations/{other["id"]}/messages', headers=headers("bob"), json={"content": "ok", "model": "stub-model"}).status_code == 200


def test_invite_is_single_use_pending_until_admin_approval(accounts):
    client, db, headers, admin = accounts
    invitation = client.post("/api/auth/admin/invitations", headers=admin, json={"label": "Carlo"}).json()
    assert "token_hash" not in json.dumps(client.get("/api/auth/admin/invitations", headers=admin).json())
    body = {"invitation": invitation["token"], "username": "carlo", "display_name": "Carlo", "password": "a new long password"}
    assert client.post("/api/auth/register", json=body).status_code == 201
    assert client.post("/api/auth/register", json={**body, "username": "dario"}).status_code == 400
    assert client.post("/api/auth/login", json={"username": "carlo", "password": body["password"]}).status_code == 401
    user = db.query(User).filter_by(username="carlo").one()
    assert client.patch(f"/api/auth/admin/users/{user.id}", headers=admin,
        json={"status": "active", "hosted_access": True, "allowed_models": ["stub-model"], "daily_limit": 5}).status_code == 200
    assert client.post("/api/auth/login", json={"username": "carlo", "password": body["password"]}).status_code == 200
    assert client.get("/api/auth/status").json()["user"]["username"] == "carlo"
    assert client.patch("/api/auth/admin/users/owner", headers=admin, json={"status": "disabled"}).status_code == 409


def test_revoked_invites_and_origin_checks(accounts):
    client, db, headers, admin = accounts
    invitation = client.post("/api/auth/admin/invitations", headers=admin, json={"label": "Revoca"}).json()
    assert client.delete("/api/auth/admin/invitations/" + invitation["id"], headers=admin).status_code == 204
    body = {"invitation": invitation["token"], "username": "carlo", "display_name": "Carlo", "password": "a new long password"}
    assert client.post("/api/auth/register", json=body).status_code == 400
    assert client.post("/api/auth/register", headers={"Origin": "https://evil.example"}, json=body).status_code == 403
    assert client.post("/api/auth/login", headers={"Origin": "https://evil.example"}, json={"username": "mattia", "password": "a long test password"}).status_code == 403


def test_initial_password_gate_and_revoked_sessions(accounts, tmp_path):
    client, db, headers, admin = accounts
    owner = db.get(User, "owner"); owner.must_change_password = True; db.commit()
    assert client.post("/api/auth/login", json={"username": "mattia", "password": "a long test password"}).status_code == 200
    previous = client.cookies.get(COOKIE)
    assert client.get("/api/memory").status_code == 403
    assert client.post("/api/auth/password", json={"current_password": "a long test password", "new_password": "a different long password"}).status_code == 200
    assert client.get("/api/memory").status_code == 200
    assert client.get("/api/memory", headers={"Cookie": f"{COOKIE}={previous}"}).status_code == 401
    assert client.get("/api/auth/status").json()["user"]["must_change_password"] is False
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/memory").status_code == 401


def test_approval_change_revokes_open_websocket_compute(accounts):
    client, db, headers, admin = accounts
    a = headers("alice")
    conv = client.post("/api/chat/conversations", headers=a, json={}).json()
    with client.websocket_connect(f'/api/chat/ws/chat/{conv["id"]}?model=stub-model', headers=a) as socket:
        assert client.patch("/api/auth/admin/users/alice", headers=admin,
            json={"status": "disabled"}).status_code == 200
        socket.send_json({"type": "message", "content": "should fail"})
        event = socket.receive_json()
        assert event["type"] == "error"
        assert "autorizzato" in event["detail"]
    assert client.get("/api/memory", headers=a).status_code == 401


def test_hosted_access_and_voice_require_approval(accounts, monkeypatch):
    from app.api import voice
    client, db, headers, admin = accounts
    user = db.get(User, "alice"); user.hosted_access = False; db.commit()
    a = headers("alice")
    conv = client.post("/api/chat/conversations", headers=a, json={}).json()
    assert client.post(f'/api/chat/conversations/{conv["id"]}/messages', headers=a, json={"content": "test", "model": "stub-model"}).status_code == 403
    monkeypatch.setattr(get_settings(), "voice_enabled", True)
    with client.websocket_connect("/api/voice/ws", headers=a) as socket:
        socket.send_json({"type": "speak", "text": "test"})
        assert socket.receive_json()["type"] == "ready"
        assert socket.receive_json()["type"] == "error"


def test_identity_map_and_bulk_operations_remain_scoped(accounts):
    client, db, headers, admin = accounts
    a = client.post("/api/memory", headers=headers("alice"), json={"content": "alice"}).json()
    b = client.post("/api/memory", headers=headers("bob"), json={"content": "bob"}).json()
    marker = identity.set(Principal(id="alice", role="member"))
    try:
        assert owned_get(db, Memory, b["id"]) is None
        assert db.query(Memory).delete(synchronize_session=False) == 1
        db.commit()
    finally:
        identity.reset(marker)
    assert len(client.get("/api/memory", headers=headers("bob")).json()) == 1


def test_legacy_database_migration_backups_and_preserves_records(tmp_path):
    path = tmp_path / "legacy.sqlite3"
    engine = create_engine("sqlite:///" + str(path))
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE conversations (id VARCHAR(36) PRIMARY KEY, title TEXT)"))
        connection.execute(text("INSERT INTO conversations VALUES ('old', 'Storico Mattia')"))
    backup = migrate_ownership(engine)
    assert backup and backup.is_file()
    with engine.connect() as connection:
        assert connection.execute(text("SELECT id, title, owner_id FROM conversations")).one() == ("old", "Storico Mattia", "owner")
    with sqlite3.connect(backup) as connection:
        assert connection.execute("SELECT title FROM conversations").fetchone()[0] == "Storico Mattia"
        assert "owner_id" not in {row[1] for row in connection.execute("PRAGMA table_info(conversations)")}
    assert migrate_ownership(engine) is None


def test_admin_exports_erases_only_disabled_guest_data_and_resets_password(accounts):
    client, db, headers, admin = accounts
    client.post("/api/memory", headers=headers("alice"), json={"content": "alice private"})
    client.post("/api/memory", headers=headers("bob"), json={"content": "bob private"})
    exported = client.get("/api/auth/admin/users/alice/export", headers=admin).json()
    assert [row["content"] for row in exported["memory"]] == ["alice private"]
    assert client.post("/api/auth/admin/users/alice/erase-data", headers=admin, json={"confirmation": "alice"}).status_code == 409
    assert client.post("/api/auth/admin/users/alice/password", headers=headers("bob"), json={"confirmation": "alice"}).status_code == 403
    temporary = client.post("/api/auth/admin/users/alice/password", headers=admin, json={"confirmation": "alice"}).json()
    assert len(temporary["temporary_password"]) >= 24
    assert client.get("/api/memory", headers=headers("alice")).status_code == 401
    assert client.patch("/api/auth/admin/users/alice", headers=admin, json={"status": "disabled"}).status_code == 200
    assert client.post("/api/auth/admin/users/alice/erase-data", headers=admin, json={"confirmation": "bob"}).status_code == 400
    assert client.post("/api/auth/admin/users/alice/erase-data", headers=admin, json={"confirmation": "alice"}).status_code == 200
    assert client.get("/api/auth/admin/users/alice/export", headers=admin).json()["memory"] == []
    assert [row["content"] for row in client.get("/api/memory", headers=headers("bob")).json()] == ["bob private"]


@pytest.mark.parametrize("tasks", [
    [{"id": "a", "agent_id": "missing", "instruction": "test"}],
    [{"id": "a", "agent_id": "general", "instruction": "test", "depends_on": ["a"]}],
    [{"id": "a", "agent_id": "coding", "instruction": "2+2", "tool": "calculator"}],
    [{"id": "a", "agent_id": "general", "instruction": "test", "tool": "shell"}],
    [],
])
def test_model_plans_reject_invalid_agents_dependencies_and_tools(client, monkeypatch, tasks):
    from tests.conftest import StubProvider
    async def answer(self, messages, model):
        return json.dumps({"tasks": tasks})
    monkeypatch.setattr(StubProvider, "chat", answer)
    assert client.post("/api/plans", json={"prompt": "test", "model": "stub-model"}).status_code == 422
    assert client.get("/api/runs").json() == []


def test_model_plan_is_a_proposal_until_explicit_execution(client, monkeypatch):
    from tests.conftest import StubProvider
    async def answer(self, messages, model):
        return json.dumps({"tasks": [{"id": "one", "agent_id": "general", "instruction": "2 + 3", "tool": "calculator"}]})
    monkeypatch.setattr(StubProvider, "chat", answer)
    proposal = client.post("/api/plans", json={"prompt": "Somma", "model": "stub-model"})
    assert proposal.status_code == 200
    assert client.get("/api/runs").json() == []
    run = client.post("/api/runs", json={"prompt": "Somma", "model": "stub-model", "tasks": proposal.json()["tasks"]}).json()
    assert run["status"] == "completed" and run["result"] == "5"


def test_memory_suggestions_are_private_unsaved_and_marked_as_inference(accounts, monkeypatch):
    from tests.conftest import StubProvider
    client, db, headers, admin = accounts
    async def answer(self, messages, model):
        assert "user_utterances" in messages[-1].content
        return json.dumps({"suggestions": [{"content": "Preferisco Python", "category": "profile"}]})
    conv = client.post("/api/chat/conversations", headers=headers("alice"), json={}).json()
    marker = identity.set(Principal(id="alice", role="member"))
    try:
        from app.db.models import Message, MessageRole
        db.add(Message(conversation_id=conv["id"], role=MessageRole.user, content="Preferisco Python")); db.commit()
    finally:
        identity.reset(marker)
    monkeypatch.setattr(StubProvider, "chat", answer)
    path = f'/api/conversations/{conv["id"]}/memory-suggestions'
    assert client.post(path, headers=headers("bob"), json={"model": "stub-model"}).status_code == 404
    response = client.post(path, headers=headers("alice"), json={"model": "stub-model"})
    assert response.status_code == 200
    suggestion = response.json()["suggestions"][0]
    assert suggestion["certainty"] == "inference" and suggestion["source"] == "conversation:" + conv["id"]
    assert client.get("/api/memory", headers=headers("alice")).json() == []
    assert client.post("/api/memory", headers=headers("alice"), json=suggestion).status_code == 200
    assert client.get("/api/memory", headers=headers("bob")).json() == []


def test_monitoring_is_aggregate_and_admin_only(accounts):
    client, db, headers, admin = accounts
    assert client.get("/api/auth/admin/diagnostics", headers=headers("alice")).status_code == 403
    state = client.get("/api/auth/admin/diagnostics", headers=admin).json()
    assert state["users"] == 3
    assert "password" not in json.dumps(state) and "token" not in json.dumps(state)



@pytest.mark.asyncio
async def test_global_compute_bound_releases_slots_after_completion():
    import asyncio
    from fastapi import HTTPException
    from app.llm.gateway import LLMGateway
    from app.llm.base import ChatMessage
    release = asyncio.Event()
    entered = 0
    class Provider:
        async def chat(self, messages, model):
            nonlocal entered
            entered += 1
            await release.wait()
            return "ok"
    gateway = LLMGateway.__new__(LLMGateway)
    gateway._settings = type("Config", (), {"default_llm_provider": "ollama"})()
    gateway._providers = {"ollama": Provider()}
    tasks = [asyncio.create_task(gateway.chat([ChatMessage(role="user", content="test")], "model")) for _ in range(2)]
    while entered < 2:
        await asyncio.sleep(0)
    try:
        with pytest.raises(HTTPException) as error:
            await gateway.chat([], "model")
        assert error.value.status_code == 429
    finally:
        release.set(); await asyncio.gather(*tasks)
    assert await gateway.chat([], "model") == "ok"


def test_manual_sqlite_backup_is_consistent_and_separate(tmp_path, monkeypatch, capsys):
    from scripts.backup_database import main
    source = tmp_path / "source.sqlite3"
    with sqlite3.connect(source) as connection:
        connection.execute("CREATE TABLE example (value TEXT)")
        connection.execute("INSERT INTO example VALUES ('retained')")
    monkeypatch.setattr(get_settings(), "database_url", "sqlite:///" + str(source))
    main()
    filename = capsys.readouterr().out.strip()
    backup = tmp_path / "backups" / filename
    assert backup.is_file() and backup != source
    with sqlite3.connect(backup) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert connection.execute("SELECT value FROM example").fetchone()[0] == "retained"


def test_personal_profile_is_private_and_exportable(accounts):
    client, _, headers, admin = accounts
    alice = headers("alice")
    bob = headers("bob")
    assert client.get("/api/auth/profile").status_code == 401
    assert client.put("/api/auth/profile", headers=alice, json={"address": "x" * 301}).status_code == 422
    data = {"first_name": "Alice", "last_name": "Rossi", "address": "Indirizzo di prova"}
    assert client.put("/api/auth/profile", headers=alice, json=data).json() == data
    assert client.get("/api/auth/profile", headers=alice).json() == data
    assert client.get("/api/auth/profile", headers=bob).json()["address"] == ""
    assert client.get("/api/auth/profile", headers=admin).json()["address"] == ""
    exported = client.get("/api/export", headers=alice).json()["preferences"]
    assert json.loads(next(row["value"] for row in exported if row["key"] == "personal_profile")) == data
