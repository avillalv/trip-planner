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

from tripplanner.schemas.agent import AgentLodgingPickIn, AgentQuoteIn, AgentSuggestionIn

SERVER_NAME = "trip"
# What to save, and with which tool, for each kind of run.
SAVING = {
    "itinerary_agent": "Save ideas with suggest_activities and tips with add_note",
    "lodging_agent": "Save your ranked picks with suggest_lodging and tips with add_note",
}
DEFAULT_SAVING = "Record prices with submit_flight_quotes and findings with add_note"


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


def build_server(api: IngestApi, kind: str = "flight_agent") -> MCPServer:
    """The tools a run of this kind gets: the flight and research kinds price and research; the
    itinerary kind suggests things to do; the lodging kind ranks places to stay."""
    saving = SAVING.get(kind, DEFAULT_SAVING)
    instructions = (
        f"Tools for this Trip Planner run. Call get_task first. {saving} as you go, "
        "then call finish_run once at the end."
    )
    server = MCPServer(SERVER_NAME, instructions=instructions)

    async def get_task() -> str:
        """Your assignment: the trip and the rules for this run, plus the routes to search and the
        cheapest prices the app already knows (flight runs) or the days, weather, plans, interests, and
        earlier suggestions or the numbered places to stay to choose from (planning runs)."""
        return _json(await api.call("GET", f"/runs/{api.run_id}/context"))

    async def lookup_airports(
        query: Annotated[str, Field(min_length=2, max_length=60, description="City, airport name, or code")],
    ) -> str:
        """Find IATA airport codes by city or airport name."""
        return _json(await api.call("GET", "/airports", params={"q": query}))

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

    async def suggest_activities(
        suggestions: Annotated[list[AgentSuggestionIn], Field(min_length=1, max_length=20)],
    ) -> str:
        """Save things to do for the travelers to review (up to 20 per call, 40 per run).

        A good suggestion is a named place, tour, market, shop, or restaurant, with the day, start
        time, and length that suit it best on this trip; why it fits these travelers; timing_note
        saying why that day and time (hours, closures, weather, booking needs); and sources: the pages
        that showed those facts. Leave out day, start time, or length you can't justify. Save in
        batches as you go. The reply lists each item as accepted, rejected (with reasons), or a
        duplicate of something already suggested. Fix a rejected item only if a page supports the
        correction."""
        payload = {"suggestions": [s.model_dump(mode="json", exclude_none=True) for s in suggestions]}
        result = await api.call("POST", f"/runs/{api.run_id}/activity-suggestions", json=payload)
        counts = (
            f"{len(result['accepted'])} accepted, {len(result['rejected'])} rejected, "
            f"{len(result['duplicates'])} duplicates."
        )
        return f"{counts}\n{_json(result)}"

    async def suggest_lodging(
        picks: Annotated[list[AgentLodgingPickIn], Field(min_length=1, max_length=8)],
    ) -> str:
        """Save your ranked places to stay for the travelers to review (up to 8 per run, 3 to 6 is best).

        Pick each place by its index from get_task's offers, and give it a rank (1 = best, each rank
        used once). why ties the place to these travelers' interests and the days' plans; pros and
        cons are short and concrete things you learned from reviews and location research, not
        generic praise. The app fills in the price, photos, and details from its own search. The reply
        lists each pick, by the index you gave, as accepted, rejected (with reasons), or a duplicate of
        a place already saved. Fix a rejected pick only if the reason shows a real mistake."""
        payload = {"picks": [p.model_dump(mode="json") for p in picks]}
        result = await api.call("POST", f"/runs/{api.run_id}/lodging-picks", json=payload)
        counts = (
            f"{len(result['accepted'])} accepted, {len(result['rejected'])} rejected, "
            f"{len(result['duplicates'])} duplicates."
        )
        return f"{counts}\n{_json(result)}"

    async def add_note(
        title: Annotated[str, Field(min_length=1, max_length=160)],
        body: Annotated[str, Field(min_length=1, max_length=4000, description="Plain text; be specific")],
        urls: Annotated[list[str], Field(max_length=10, description="Pages that support the note")] = [],  # noqa: B006
    ) -> str:
        """Save a finding for the trip, e.g. a fare sale with its end date, a schedule change, an
        event during the trip dates, or a tip like "book the hot springs a week ahead". Include the
        pages you got it from."""
        note = await api.call(
            "POST", f"/runs/{api.run_id}/notes", json={"title": title, "body": body, "urls": urls}
        )
        return f"Saved note {note['id']}."

    async def finish_run(
        status: Literal["ok", "partial", "failed"],
        summary: Annotated[str, Field(min_length=1, max_length=2000, description="What you found, briefly")],
        sources_checked: Annotated[list[str], Field(max_length=40)] = [],  # noqa: B006
        issues: Annotated[list[str], Field(max_length=20, description="Problems, e.g. blocked sites")] = [],  # noqa: B006
    ) -> str:
        """Report how the run went. Call once, at the very end. "ok" = did the task as asked (finding
        nothing is still ok), "partial" = part of it couldn't be done, "failed" = couldn't do the task."""
        body = {"status": status, "summary": summary, "sources_checked": sources_checked, "issues": issues}
        result = await api.call("POST", f"/runs/{api.run_id}/finish", json=body)
        return str(result["message"])

    kind_tools = {
        "flight_agent": [lookup_airports, submit_flight_quotes],
        "research_agent": [lookup_airports, submit_flight_quotes],
        "itinerary_agent": [suggest_activities],
        "lodging_agent": [suggest_lodging],
    }
    for tool in [get_task, *kind_tools[kind], add_note, finish_run]:
        server.tool(structured_output=False)(tool)
    return server
