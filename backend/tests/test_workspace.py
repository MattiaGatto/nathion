import pytest
from pydantic import ValidationError

from app.runtime import RunIn, discover_skills


def test_skills_are_real_files():
    assert {skill.id for skill in discover_skills()} == {"architecture", "code-review", "planning"}


def test_cycle_rejected():
    with pytest.raises(ValidationError):
        RunIn(prompt="test", model="stub", tasks=[
            {"id": "a", "agent_id": "coding", "instruction": "x", "depends_on": ["b"]},
            {"id": "b", "agent_id": "architect", "instruction": "y", "depends_on": ["a"]}])


def test_memory_selective_deduplicated_and_searchable(client):
    assert client.get("/api/memory").json() == []
    first = client.post("/api/memory", json={"content": "Uso PostgreSQL nel progetto", "category": "project"}).json()
    duplicate = client.post("/api/memory", json={"content": "uso postgresql  nel progetto", "category": "project"}).json()
    assert first["id"] == duplicate["id"]
    assert client.get("/api/memory?q=PostgreSQL").json()[0]["id"] == first["id"]
    assert client.get("/api/memory?q=irrilevante").json() == []
    assert client.delete("/api/memory/" + first["id"]).status_code == 204
    assert client.get("/api/memory").json() == []


def test_workflow_dependencies_skills_and_persistence(client):
    response = client.post("/api/runs", json={"prompt": "Progetta codice", "model": "stub-model", "tasks": [
        {"id": "design", "agent_id": "architect", "instruction": "Definisci API"},
        {"id": "implementation", "agent_id": "coding", "instruction": "Scrivi codice", "depends_on": ["design"]}]})
    assert response.status_code == 200
    run = response.json()
    assert run["status"] == "completed"
    events = run["trace"]
    design_done = next(i for i, e in enumerate(events) if e["type"] == "completed" and e["task"] == "design")
    code_start = next(i for i, e in enumerate(events) if e["type"] == "started" and e["task"] == "implementation")
    assert design_done < code_start
    assert events[code_start]["skills"] == ["code-review"]
    assert client.get("/api/runs/" + run["id"]).json()["result"] == run["result"]


def test_task_limit_and_unknown_agent(client):
    response = client.post("/api/runs", json={"prompt": "test", "model": "stub", "tasks": [
        {"id": "x", "agent_id": "unknown", "instruction": "test"}]})
    assert response.status_code == 422
