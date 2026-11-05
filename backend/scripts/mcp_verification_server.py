"""Read-only loopback MCP fixture, launched only by check_mcp_http.py."""
import argparse
from mcp.server import MCPServer

server = MCPServer("NATHION verification")


@server.tool()
def add(a: int, b: int) -> int:
    """Add two test integers without external effects."""
    return a + b


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    server.run("streamable-http", host="127.0.0.1", port=args.port)
