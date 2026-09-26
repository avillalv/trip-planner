"""The MCP bridge: its tools forward to the ingest API and report problems in words an agent can act on."""

import asyncio
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from sqlalchemy.orm import Session

from tests.factories import add_rates, add_route, add_run, add_trip
from tripplanner.agent_bridge import IngestApi, build_server
from tripplanner.db import get_db
from tripplanner.main import create_app
from tripplanner.models import FlightRoute, Run


@pytest.fixture
def bridge(db_session: Session, frontend_dist: Path) -> Iterator[tuple[MCPServer, FlightRoute, Run]]:
    trip = add_trip(db_session)
    route = add_route(db_session, trip)
    add_rates(db_session, USD="1.10")
    run = add_run(db_session, trip)

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
    yield build_server(IngestApi(http, str(run.id))), route, run


def call(server: MCPServer, tool: str, **arguments: Any) -> str:
    result = asyncio.run(server.call_tool(tool, arguments))
    return result.content[0].text


def test_tools_offered_to_agents(bridge) -> None:
    server, _, _ = bridge
    tools = {t.name: t for t in asyncio.run(server.list_tools())}

    assert set(tools) == {"get_task", "lookup_airports", "submit_flight_quotes", "add_note", "finish_run"}
    quote_schema = json.dumps(tools["submit_flight_quotes"].input_schema)
    assert "source_url" in quote_schema and "passengers" in quote_schema


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
