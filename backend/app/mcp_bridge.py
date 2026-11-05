"""Opt-in HTTP MCP adapter. No subprocesses, arbitrary endpoints or implicit calls."""
import asyncio
import hashlib
import json
from threading import BoundedSemaphore

from app.core.config import get_settings
_connections = BoundedSemaphore(2)


def resolve(server_id: str, tool_name: str | None = None):
    server = get_settings().mcp_servers.get(server_id)
    if server is None or (tool_name is not None and tool_name not in server.allowed_tools):
        raise ValueError("Server o strumento MCP non autorizzato")
    return server


def fingerprint(server_id: str, tool_name: str):
    server = resolve(server_id, tool_name)
    payload = {"url": str(server.url), "tool": tool_name,
               "headers": {key: value.get_secret_value() for key, value in server.headers.items()}}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


async def connect_call(server_id: str, tool_name: str | None = None, arguments: dict | None = None):
    if not _connections.acquire(blocking=False):
        raise RuntimeError("Connessioni MCP occupate")
    try:
        return await _connect_call(server_id, tool_name, arguments)
    finally:
        _connections.release()


async def _connect_call(server_id: str, tool_name: str | None = None, arguments: dict | None = None):
    # Import only when configured. Missing optional dependency fails explicitly.
    from mcp import Client
    import httpx2
    from mcp.client.streamable_http import streamable_http_client

    server = resolve(server_id, tool_name)
    headers = {key: value.get_secret_value() for key, value in server.headers.items()}
    async with asyncio.timeout(30):
        async with httpx2.AsyncClient(headers=headers, timeout=20, trust_env=False) as http_client:
            transport = streamable_http_client(str(server.url), http_client=http_client, max_sse_event_size=128 * 1024)
            async with Client(transport) as client:
                if tool_name is None:
                    result = await client.list_tools()
                    return [{"name": tool.name, "description": tool.description, "input_schema": tool.input_schema}
                            for tool in result.tools if tool.name in server.allowed_tools]
                result = await client.call_tool(tool_name, arguments or {})
                texts = [block.text for block in result.content if getattr(block, "type", None) == "text"]
                text = "\n".join(texts) or json.dumps(result.structured_content, ensure_ascii=False)
                return {"text": text[:16000], "truncated": len(text) > 16000, "is_error": result.is_error}
