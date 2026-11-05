from app.db.models import AppSettings


def test_export_excludes_configuration_secrets(client, db_session):
    db_session.add(AppSettings(key="service_api_key", value="must-stay-private"))
    db_session.commit()
    client.post("/api/memory", json={"content": "Una mia preferenza"})
    exported = client.get("/api/export")
    assert exported.status_code == 200
    assert exported.json()["memory"][0]["content"] == "Una mia preferenza"
    assert "must-stay-private" not in exported.text


def test_workflow_and_action_history_can_be_erased(client):
    run = client.post("/api/runs", json={"prompt": "calcola 2+2", "model": "stub"}).json()
    assert client.delete("/api/runs/" + run["id"]).status_code == 204
    assert client.get("/api/runs").json() == []
    note = client.post("/api/memory", json={"content": "Mantieni questa memoria"}).json()
    action = client.post("/api/tools/execute", json={"tool": "memory.delete", "memory_id": note["id"]}).json()
    assert client.delete("/api/tools/actions/" + action["id"]).status_code == 204
    assert client.get("/api/tools/actions").json() == []
    assert len(client.get("/api/memory").json()) == 1
