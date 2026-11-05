import pytest
from app import mcp_bridge
from app.core.config import get_settings, MCPConnection


def test_remote_calls_are_pending_and_bound_to_reviewed_config(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "mcp_servers", {"local": MCPConnection(url="http://localhost:9000/mcp", allowed_tools=["add"])})
    calls = []
    async def remote(*args):
        calls.append(args)
        return {"text": "3", "is_error": False, "truncated": False}
    monkeypatch.setattr(mcp_bridge, "connect_call", remote)
    request = {"tool": "mcp", "server": "local", "remote_tool": "add", "arguments": {"a": 1, "b": 2}}
    action = client.post("/api/tools/execute", json=request).json()
    assert action["status"] == "pending" and calls == []
    assert client.post(f"/api/tools/actions/{action['id']}/approve").json()["status"] == "completed"
    assert len(calls) == 1
    assert client.post(f"/api/tools/actions/{action['id']}/approve").status_code == 409
    changed = client.post("/api/tools/execute", json=request).json()
    get_settings().mcp_servers["local"] = MCPConnection(url="http://localhost:9001/mcp", allowed_tools=["add"])
    assert client.post(f"/api/tools/actions/{changed['id']}/approve").json()["status"] == "failed"
    assert len(calls) == 1


def test_mcp_unknown_tools_fail_closed(client):
    assert client.post("/api/tools/execute", json={"tool": "mcp", "server": "arbitrary", "remote_tool": "delete"}).status_code == 403


def test_uncertain_remote_outcome_is_not_retried(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "mcp_servers", {"local": MCPConnection(url="http://localhost:9000/mcp", allowed_tools=["add"])})
    calls = []
    async def timeout(*args):
        calls.append(args)
        raise TimeoutError()
    monkeypatch.setattr(mcp_bridge, "connect_call", timeout)
    action = client.post("/api/tools/execute", json={"tool": "mcp", "server": "local", "remote_tool": "add"}).json()
    assert client.post(f"/api/tools/actions/{action['id']}/approve").json()["status"] == "unknown"
    assert client.post(f"/api/tools/actions/{action['id']}/approve").status_code == 409
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_real_mcp_protocol_with_in_process_server(monkeypatch):
    pytest.importorskip("mcp")
    from mcp.server import MCPServer
    import mcp.client.streamable_http
    server = MCPServer("test")
    @server.tool()
    def add(a: int, b: int) -> int:
        return a + b
    monkeypatch.setattr(get_settings(), "mcp_servers", {"local": MCPConnection(url="http://localhost:9000/mcp", allowed_tools=["add"])})
    # The real SDK speaks MCP in memory; only the network transport is replaced.
    monkeypatch.setattr(mcp.client.streamable_http, "streamable_http_client", lambda *args, **kwargs: server)
    tools = await mcp_bridge.connect_call("local")
    assert tools[0]["name"] == "add"
    result = await mcp_bridge.connect_call("local", "add", {"a": 2, "b": 3})
    assert result["is_error"] is False and "5" in result["text"]
