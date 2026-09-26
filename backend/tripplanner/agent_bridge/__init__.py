"""Stdio MCP server that gives an agent run typed tools for the ingest API.

Claude Code starts it for each run (see worker/agents/runner.py). It stores nothing itself:
every tool forwards to /api/agent/v1, which validates and saves.
"""

import json
from typing import Annotated, Any, Literal

import httpx
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field

from tripplanner.schemas.agent import AgentQuoteIn

SERVER_NAME = "trip"
INSTRUCTIONS = (
    "Tools for this Trip Planner run. Call get_task first. Record prices with submit_flight_quotes "
    "and findings with add_note as you go, then call finish_run once at the end."
)


class IngestApi:
    """Calls to the local ingest API for one run."""

    def __init__(self, http: httpx.AsyncClient, run_id: str) -> None:
        self.http = http
        self.run_id = run_id

    async def call(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            response = await self.http.request(method, path, **kwargs)
        except httpx.TimeoutException as exc:
            raise ToolError("Trip Planner took too long to answer. Try once more, then move on.") from exc
        except httpx.HTTPError as exc:
            raise ToolError(
                "Trip Planner isn't reachable, so nothing can be saved. Stop and say so in your last message."
            ) from exc
        if response.status_code == 409:
            raise ToolError("This run has ended (it may have been cancelled or timed out). Stop working now.")
        if response.is_error:
            raise ToolError(f"Trip Planner refused the request ({response.status_code}): {_detail(response)}")
        return response.json()


def _detail(response: httpx.Response) -> str:
    try:
        detail = response.json().get("detail")
    except ValueError:
        return response.text[:300]
    if isinstance(detail, list):
        return "; ".join(f"{'.'.join(map(str, d.get('loc', [])))}: {d.get('msg')}" for d in detail)
    return str(detail)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def build_server(api: IngestApi) -> MCPServer:
    server = MCPServer(SERVER_NAME, instructions=INSTRUCTIONS)

    @server.tool(structured_output=False)
    async def get_task() -> str:
        """Your assignment: the trip, the routes to search (with ids and date rules), the cheapest
        prices the app already knows, and the rules for this run."""
        return _json(await api.call("GET", f"/runs/{api.run_id}/context"))

    @server.tool(structured_output=False)
    async def lookup_airports(
        query: Annotated[str, Field(min_length=2, max_length=60, description="City, airport name, or code")],
    ) -> str:
        """Find IATA airport codes by city or airport name."""
        return _json(await api.call("GET", "/airports", params={"q": query}))

    @server.tool(structured_output=False)
    async def submit_flight_quotes(
        quotes: Annotated[list[AgentQuoteIn], Field(min_length=1, max_length=50)],
    ) -> str:
        """Record flight prices you saw on web pages during this run (up to 50 per call).

        Submit as you go rather than all at the end. The reply lists each item as accepted,
        rejected (with the reasons), or a duplicate of a price already saved. Only fix and resend a
        rejected item if the page really supports the correction; never adjust facts to pass."""
        payload = {"quotes": [q.model_dump(mode="json", exclude_none=True) for q in quotes]}
        result = await api.call("POST", f"/runs/{api.run_id}/flight-quotes", json=payload)
        counts = (
            f"{len(result['accepted'])} accepted, {len(result['rejected'])} rejected, "
            f"{len(result['duplicates'])} duplicates."
        )
        return f"{counts}\n{_json(result)}"

    @server.tool(structured_output=False)
    async def add_note(
        title: Annotated[str, Field(min_length=1, max_length=160)],
        body: Annotated[str, Field(min_length=1, max_length=4000, description="Plain text; be specific")],
        urls: Annotated[list[str], Field(max_length=10, description="Pages that support the note")] = [],  # noqa: B006
    ) -> str:
        """Save a finding for the trip, e.g. a fare sale with its end date, a schedule change,
        or an event during the trip dates. Include the pages you got it from."""
        note = await api.call(
            "POST", f"/runs/{api.run_id}/notes", json={"title": title, "body": body, "urls": urls}
        )
        return f"Saved note {note['id']}."

    @server.tool(structured_output=False)
    async def finish_run(
        status: Literal["ok", "partial", "failed"],
        summary: Annotated[str, Field(min_length=1, max_length=2000, description="What you found, briefly")],
        sources_checked: Annotated[list[str], Field(max_length=40)] = [],  # noqa: B006
        issues: Annotated[list[str], Field(max_length=20, description="Problems, e.g. blocked sites")] = [],  # noqa: B006
    ) -> str:
        """Report how the run went. Call once, at the very end. "ok" = searched as asked (finding
        nothing is still ok), "partial" = some searches couldn't be done, "failed" = couldn't do the task."""
        body = {"status": status, "summary": summary, "sources_checked": sources_checked, "issues": issues}
        result = await api.call("POST", f"/runs/{api.run_id}/finish", json=body)
        return str(result["message"])

    return server
