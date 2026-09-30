"""The MCP bridge: its tools forward to the ingest API and report problems in words an agent can act on."""

import asyncio
import json
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import pytest
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from sqlalchemy import select
from sqlalchemy.orm import Session

from tests.factories import add_rates, add_route, add_run, add_trip
from tripplanner.agent_bridge import IngestApi, build_server
from tripplanner.db import get_db
from tripplanner.main import create_app
from tripplanner.models import ActivitySuggestion, FlightRoute, Run, Trip


def server_for(db_session: Session, frontend_dist: Path, run: Run) -> MCPServer:
    """A bridge for `run`, talking to the real app over an in-process connection."""

    def request_session() -> Iterator[Session]:
        db_session.expire_all()
        yield db_session

    app = create_app(frontend_dist=frontend_dist)
    app.dependency_overrides[get_db] = request_session
    http = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 50000)),
        base_url="http://127.0.0.1:8000/api/agent/v1",
        headers={"Authorization": "Bearer test-agent-key"},
    )
    return build_server(IngestApi(http, str(run.id)), run.kind)


@pytest.fixture
def bridge(db_session: Session, frontend_dist: Path) -> Iterator[tuple[MCPServer, FlightRoute, Run]]:
    trip = add_trip(db_session)
    route = add_route(db_session, trip)
    add_rates(db_session, USD="1.10")
    run = add_run(db_session, trip)
    yield server_for(db_session, frontend_dist, run), route, run


@pytest.fixture
def planner(db_session: Session, frontend_dist: Path) -> tuple[MCPServer, Run]:
    trip = add_trip(db_session, "Costa Rica")
    trip.start_date, trip.end_date = date(2026, 11, 25), date(2026, 11, 30)
    run = add_run(db_session, trip, "itinerary_agent", params={"mode": "surprise"})
    return server_for(db_session, frontend_dist, run), run


def call(server: MCPServer, tool: str, **arguments: Any) -> str:
    result = asyncio.run(server.call_tool(tool, arguments))
    return result.content[0].text


def test_tools_offered_to_agents(bridge) -> None:
    server, _, _ = bridge
    tools = {t.name: t for t in asyncio.run(server.list_tools())}

    assert set(tools) == {"get_task", "lookup_airports", "submit_flight_quotes", "add_note", "finish_run"}
    quote_schema = json.dumps(tools["submit_flight_quotes"].input_schema)
    assert "source_url" in quote_schema and "passengers" in quote_schema


def test_planning_runs_get_the_planning_tools(planner, db_session: Session, frontend_dist: Path) -> None:
    server, run = planner
    tools = {t.name: t for t in asyncio.run(server.list_tools())}

    assert set(tools) == {"get_task", "suggest_activities", "add_note", "finish_run"}
    schema = json.dumps(tools["suggest_activities"].input_schema)
    assert "timing_note" in schema and "duration_min" in schema and "sources" in schema
    assert "named place" in tools["suggest_activities"].description
    lodging = add_run(db_session, db_session.get(Trip, run.trip_id), "lodging_agent")
    other = {t.name for t in asyncio.run(server_for(db_session, frontend_dist, lodging).list_tools())}
    assert other == {"get_task", "add_note", "finish_run"}


def test_suggested_activities_come_back_with_a_verdict_for_each(planner, db_session: Session) -> None:
    server, run = planner
    good = {
        "title": "Arenal hot springs",
        "category": "nature",
        "description": "Thermal pools fed by the volcano.",
        "why": "You like hot springs.",
        "day": "2026-11-28",
        "start_time": "17:00",
        "duration_min": 150,
        "sources": ["https://www.tabacon.com/"],
    }

    text = call(
        server,
        "suggest_activities",
        suggestions=[good, {**good, "title": "Bad day", "day": "2027-01-01"}, good],
    )

    assert text.startswith("1 accepted, 1 rejected, 1 duplicates.")
    assert "must be 2026-11-25 to 2026-11-30" in text
    [saved] = db_session.scalars(select(ActivitySuggestion)).all()
    assert (saved.run_id, saved.mode, saved.title, saved.status) == (
        run.id,
        "surprise",
        "Arenal hot springs",
        "new",
    )
    db_session.refresh(run)
    assert (run.accepted_count, run.rejected_count) == (1, 1)


def test_malformed_suggestions_are_refused_before_reaching_the_api(planner) -> None:
    server, _ = planner

    with pytest.raises(ToolError):
        call(server, "suggest_activities", suggestions=[{"title": "Somewhere", "category": "fun"}])
    with pytest.raises(ToolError):
        call(server, "suggest_activities", suggestions=[])


def test_planners_read_their_plan_with_get_task(planner) -> None:
    server, _ = planner

    task = json.loads(call(server, "get_task"))

    assert task["kind"] == "itinerary_agent" and task["plan"]["mode"] == "surprise"


def test_get_task_returns_the_run_context(bridge) -> None:
    server, route, _ = bridge

    task = json.loads(call(server, "get_task"))

    assert [r["id"] for r in task["routes"]] == [route.id]


def test_submitted_fares_come_back_with_a_verdict_for_each(bridge, db_session: Session) -> None:
    server, route, run = bridge
    good = {
        "route_id": route.id,
        "origin": "LAX",
        "destination": "NRT",
        "depart_date": "2026-11-05",
        "return_date": "2026-11-12",
        "price_total": 1284,
        "currency": "USD",
        "passengers": 2,
        "source_url": "https://www.united.com/fares/lax-nrt",
    }

    text = call(server, "submit_flight_quotes", quotes=[good, {**good, "origin": "SFO"}])

    assert text.startswith("1 accepted, 1 rejected, 0 duplicates.")
    assert "must be one of LAX" in text
    db_session.refresh(run)
    assert (run.accepted_count, run.rejected_count) == (1, 1)


def test_malformed_fares_are_refused_before_reaching_the_api(bridge) -> None:
    server, route, _ = bridge

    with pytest.raises(ToolError):
        call(server, "submit_flight_quotes", quotes=[{"route_id": route.id, "price_total": "cheap"}])


def test_notes_and_finish(bridge, db_session: Session) -> None:
    server, _, run = bridge

    saved = call(
        server, "add_note", title="Sale", body="ZIPAIR sale until Oct 3.", urls=["https://zipair.net/en"]
    )
    done = call(server, "finish_run", status="ok", summary="One note saved.")

    assert saved.startswith("Saved note")
    assert "stop now" in done
    db_session.refresh(run)
    assert run.report["summary"] == "One note saved."


def test_a_finished_run_tells_the_agent_to_stop(bridge, db_session: Session) -> None:
    server, _, run = bridge
    run.status = "cancelled"
    db_session.flush()

    with pytest.raises(ToolError, match="Stop working now"):
        call(server, "get_task")


def test_an_unreachable_app_is_reported_plainly() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    http = httpx.AsyncClient(
        transport=httpx.MockTransport(refuse), base_url="http://127.0.0.1:9/api/agent/v1"
    )
    server = build_server(IngestApi(http, "00000000-0000-0000-0000-000000000000"))

    with pytest.raises(ToolError, match="isn't reachable"):
        call(server, "get_task")
