"""Real HTTP account flow. Test credentials stay in memory; the guest is suspended and erased."""
import json
import secrets
import uuid
from pathlib import Path
import httpx
ROOT = Path(__file__).resolve().parents[2]


def checked(response):
    response.raise_for_status()
    return response.json() if response.status_code != 204 else None


def local_session(client, username, password):
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    response.raise_for_status()
    # This is explicitly a loopback server-session test. HTTP clients refuse
    # Secure cookies over HTTP; actual browser/HTTPS verification is separate.
    session = response.cookies.get("nathion_session")
    assert session
    client.headers["Cookie"] = "nathion_session=" + session


def main():
    token = (ROOT / "backend/data/access-token.txt").read_text().strip()
    base = "http://localhost:4173"
    username = "verify_" + uuid.uuid4().hex[:12]
    password = secrets.token_urlsafe(32)
    user_id = invitation_id = None
    bootstrap_checked = False
    with httpx.Client(base_url=base, headers={"Authorization": f"Bearer {token}"}, trust_env=False, timeout=90) as admin:
        owner = next(user for user in checked(admin.get("/api/auth/admin/users")) if user["id"] == "owner")
        if owner["must_change_password"]:
            initial = (ROOT / "backend/data/admin-initial-password.txt").read_text().strip()
            with httpx.Client(base_url=base, trust_env=False, timeout=20) as normal:
                local_session(normal, owner["username"], initial)
                assert checked(normal.get("/api/auth/status"))["user"]["role"] == "admin"
                assert normal.get("/api/memory").status_code == 403
                stale = normal.headers["Cookie"]
                checked(normal.post("/api/auth/logout")); normal.headers.pop("Cookie")
                assert normal.get("/api/memory", headers={"Cookie": stale}).status_code == 401
                bootstrap_checked = True
        try:
            invitation = checked(admin.post("/api/auth/admin/invitations", json={"label": "Verifica automatica account"}))
            invitation_id = invitation["id"]
            with httpx.Client(base_url=base, trust_env=False, timeout=90) as guest:
                checked(guest.post("/api/auth/register", json={"invitation": invitation["token"], "username": username, "display_name": "Verifica temporanea", "password": password}))
                user = next(user for user in checked(admin.get("/api/auth/admin/users")) if user["username"] == username)
                user_id = user["id"]
                assert user["status"] == "pending" and user["role"] == "member"
                assert guest.post("/api/auth/login", json={"username": username, "password": password}).status_code == 401
                checked(admin.patch(f"/api/auth/admin/users/{user_id}", json={"status": "active", "hosted_access": True, "allowed_models": ["llama3.2:3b"], "daily_limit": 10}))
                local_session(guest, username, password)
                assert guest.get("/api/auth/admin/users").status_code == 403
                assert guest.get("/api/tools").status_code == 403
                memory = checked(guest.post("/api/memory", json={"content": "Nota temporanea per verificare isolamento account.", "category": "project", "source": "check_accounts"}))
                assert all(item["id"] != memory["id"] for item in checked(admin.get("/api/memory")))
                conversation = checked(guest.post("/api/chat/conversations", json={"title": "Verifica account"}))
                path = f'/api/chat/conversations/{conversation["id"]}/messages'
                assert guest.post(path, json={"content": "test", "model": "not-approved"}).status_code == 403
                result = checked(guest.post(path, json={"content": "Rispondi solo con la parola pronto.", "model": "llama3.2:3b", "provider": "ollama"}))
                assert any(message["role"] == "assistant" and "pronto" in message["content"].lower() for message in result["messages"])
                assert len(checked(guest.get("/api/export"))["memory"]) == 1
                checked(admin.patch(f"/api/auth/admin/users/{user_id}", json={"status": "disabled"}))
                assert guest.get("/api/memory").status_code == 401
        finally:
            if user_id:
                checked(admin.patch(f"/api/auth/admin/users/{user_id}", json={"status": "disabled"}))
                checked(admin.post(f"/api/auth/admin/users/{user_id}/erase-data", json={"confirmation": username}))
                assert checked(admin.get(f"/api/auth/admin/users/{user_id}/export"))["memory"] == []
            if invitation_id:
                checked(admin.delete("/api/auth/admin/invitations/" + invitation_id))
    report = {"bootstrap_password_gate_verified": bootstrap_checked, "server_sessions_verified": True,
              "guest_approval_verified": True, "real_local_guest_llm": True, "data_isolation_verified": True,
              "suspension_revokes_sessions": True, "temporary_guest_suspended_and_erased": True,
              "browser_https_cookie_verified": False}
    output = ROOT / "backend/data/voice-check/accounts-report.json"
    output.parent.mkdir(parents=True, exist_ok=True); output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("Real account approval, private data, local model access and session revocation verified.")


if __name__ == "__main__":
    main()
