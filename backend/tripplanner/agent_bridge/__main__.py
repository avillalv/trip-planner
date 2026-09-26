"""Entry point: `python -m tripplanner.agent_bridge --run-id <uuid> [--api-url http://127.0.0.1:8000]`.

The API key comes from .env, so nothing secret appears in Claude's MCP config or command line.
"""

import argparse
import logging
import sys
from uuid import UUID

import httpx

from tripplanner.agent_bridge import IngestApi, build_server
from tripplanner.config import get_settings


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m tripplanner.agent_bridge")
    parser.add_argument("--run-id", required=True, type=UUID)
    parser.add_argument("--api-url", help="Trip Planner's address on this PC (default: from .env)")
    args = parser.parse_args()

    # Claude keeps the bridge's stderr; per-request lines from httpx would only add noise there.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    settings = get_settings()
    key = settings.agent_ingest_api_key.get_secret_value() if settings.agent_ingest_api_key else ""
    if not key:
        print("AGENT_INGEST_API_KEY isn't set in .env.", file=sys.stderr)
        sys.exit(1)
    api_url = (args.api_url or f"http://127.0.0.1:{settings.port}").rstrip("/")
    http = httpx.AsyncClient(
        base_url=f"{api_url}/api/agent/v1",
        headers={"Authorization": f"Bearer {key}"},
        timeout=30,
        trust_env=False,  # never send the key through a proxy
    )
    build_server(IngestApi(http, str(args.run_id))).run()


if __name__ == "__main__":
    main()
