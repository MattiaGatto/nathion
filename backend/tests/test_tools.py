import pytest

from app.api.tools import calculate


def test_safe_calculation():
    assert calculate("(12 + 3) / -5") == -3


@pytest.mark.parametrize("expression", ["__import__('os').system('whoami')", "2 ** 100000", "1 / 0", "1e309", "True", "[1, 2]"])
def test_no_code_execution_or_unbounded_arithmetic(client, expression):
    assert client.post("/api/tools/execute", json={"tool": "calculator", "expression": expression}).status_code == 422


def test_destructive_tool_requires_approval_exactly_once(client):
    note = client.post("/api/memory", json={"content": "Da eliminare con conferma"}).json()
    action = client.post("/api/tools/execute", json={"tool": "memory.delete", "memory_id": note["id"]}).json()
    assert action["status"] == "pending"
    assert len(client.get("/api/memory").json()) == 1
    assert client.post(f"/api/tools/actions/{action['id']}/approve").json()["status"] == "completed"
    assert client.get("/api/memory").json() == []
    assert client.post(f"/api/tools/actions/{action['id']}/approve").status_code == 409


def test_rejected_action_preserves_memory(client):
    note = client.post("/api/memory", json={"content": "Da mantenere"}).json()
    action = client.post("/api/tools/execute", json={"tool": "memory.delete", "memory_id": note["id"]}).json()
    assert client.post(f"/api/tools/actions/{action['id']}/reject").json()["status"] == "rejected"
    assert len(client.get("/api/memory").json()) == 1


def test_agent_tool_execution_is_allowlisted(client):
    run = client.post("/api/runs", json={"prompt": "calcola 12 + 3", "model": "stub"}).json()
    assert run["status"] == "completed"
    assert run["result"] == "15"
    assert any(event["type"] == "tool" for event in run["trace"])
    forbidden = client.post("/api/runs", json={"prompt": "test", "model": "stub", "tasks": [
        {"id": "bad", "agent_id": "research", "instruction": "1+1", "tool": "calculator"}]}).json()
    assert forbidden["status"] == "failed"
    assert forbidden["trace"][-1]["error"] == "PermissionError"
