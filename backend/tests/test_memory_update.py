def test_update_invalidates_old_content_and_deduplication(client):
    note = client.post("/api/memory", json={"content": "Preferisco MySQL"}).json()
    updated = client.put("/api/memory/" + note["id"], json={"content": "Preferisco PostgreSQL", "category": "profile"})
    assert updated.json()["content"] == "Preferisco PostgreSQL"
    assert client.get("/api/memory?q=MySQL").json() == []
    assert client.get("/api/memory?q=PostgreSQL").json()[0]["id"] == note["id"]
    assert client.get("/api/memory-status").json() == {"model": "", "total": 1, "indexed": 0}
