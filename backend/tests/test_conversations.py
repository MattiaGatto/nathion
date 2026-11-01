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


def test_send_message_persists_both_sides_and_titles_conversation(client):
    conversation_id = client.post("/api/chat/conversations", json={}).json()["id"]

    response = client.post(
        f"/api/chat/conversations/{conversation_id}/messages",
        json={"content": "Ciao NATHION, come stai?", "model": "stub-model", "provider": "stub"},
    )
    assert response.status_code == 200
    body = response.json()

    assert len(body["messages"]) == 2
    assert body["messages"][0]["role"] == "user"
    assert body["messages"][0]["content"] == "Ciao NATHION, come stai?"
    assert body["messages"][1]["role"] == "assistant"
    assert "risposta di test" in body["messages"][1]["content"]
    assert body["messages"][1]["model_used"] == "stub-model"

    # Il titolo di default viene sostituito dal primo messaggio utente,
    # cosi' lo storico conversazioni e' leggibile.
    assert body["title"] == "Ciao NATHION, come stai?"


def test_conversation_list_is_sorted_by_last_activity(client):
    old = client.post("/api/chat/conversations", json={"title": "Vecchia"}).json()
    new = client.post("/api/chat/conversations", json={"title": "Nuova"}).json()

    # Attiva la conversazione "vecchia" per ultima: deve salire in cima
    # allo storico, perche' l'ordinamento segue l'ultima attivita' e non
    # solo l'ordine di creazione.
    client.post(
        f"/api/chat/conversations/{old['id']}/messages",
        json={"content": "ping", "model": "stub-model", "provider": "stub"},
    )

    listed = client.get("/api/chat/conversations").json()
    ids_in_order = [c["id"] for c in listed]
    assert ids_in_order.index(old["id"]) < ids_in_order.index(new["id"])


def test_delete_conversation_removes_it(client):
    conversation_id = client.post("/api/chat/conversations", json={}).json()["id"]

    delete_response = client.delete(f"/api/chat/conversations/{conversation_id}")
    assert delete_response.status_code == 204

    get_response = client.get(f"/api/chat/conversations/{conversation_id}")
    assert get_response.status_code == 404


def test_delete_unknown_conversation_returns_404(client):
    response = client.delete("/api/chat/conversations/does-not-exist")
    assert response.status_code == 404
