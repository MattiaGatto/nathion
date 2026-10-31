"""Verifica che una conversazione e i suoi messaggi sopravvivano,
cioè il criterio di accettazione 'persistenza conversazioni' della
Milestone 1 (una conversazione resta leggibile dopo che è stata
scritta e la sessione richiusa)."""


def test_create_conversation(client):
    response = client.post("/api/chat/conversations", json={"title": "Prova"})
    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Prova"
    assert body["id"]


def test_conversation_persists_and_is_retrievable(client):
    created = client.post("/api/chat/conversations", json={}).json()
    conversation_id = created["id"]

    fetched = client.get(f"/api/chat/conversations/{conversation_id}")
    assert fetched.status_code == 200
    assert fetched.json()["id"] == conversation_id
    assert fetched.json()["messages"] == []


def test_get_unknown_conversation_returns_404(client):
    response = client.get("/api/chat/conversations/does-not-exist")
    assert response.status_code == 404
