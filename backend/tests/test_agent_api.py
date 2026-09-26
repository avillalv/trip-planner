"""The ingest API agents write through: access rules, per-item validation, and the rejection log."""

from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tests.factories import add_airport, add_person, add_rates, add_route, add_run, add_trip
from tripplanner.models import AgentNote, FlightQuote, FlightRoute, IngestRejection, Run, Trip
from tripplanner.services.agent_ingest import blocked_domain, source_problem

AGENT = {"Authorization": "Bearer test-agent-key"}


@pytest.fixture
def setup(db_session: Session) -> tuple[FlightRoute, Run]:
    trip = add_trip(db_session)
    trip.travelers.append(add_person(db_session, "Alex"))
    route = add_route(db_session, trip)  # LAX to NRT, depart Nov 5-7, 7-8 nights, 2 adults
    add_rates(db_session, USD="1.10", JPY="165")
    return route, add_run(db_session, trip)


def fare(route: FlightRoute, **overrides: Any) -> dict[str, Any]:
    item: dict[str, Any] = {
        "route_id": route.id,
        "origin": "LAX",
        "destination": "NRT",
        "depart_date": "2026-11-05",
        "return_date": "2026-11-12",
        "price_total": "1284.00",
        "currency": "USD",
        "passengers": 2,
        "airlines": ["ZIPAIR"],
        "source_url": "https://www.kayak.com/flights/LAX-NRT/2026-11-05/2026-11-12/2adults",
        "seen_on": "Kayak",
    }
    item.update(overrides)
    return {k: v for k, v in item.items() if v != "<drop>"}


def submit(client: TestClient, run: Run, *items: dict[str, Any]) -> dict[str, Any]:
    response = client.post(
        f"/api/agent/v1/runs/{run.id}/flight-quotes", json={"quotes": list(items)}, headers=AGENT
    )
    assert response.status_code == 200, response.text
    return response.json()


# --- Access -----------------------------------------------------------------------------------


def test_requests_need_the_agent_key(client: TestClient, setup: tuple[FlightRoute, Run]) -> None:
    _, run = setup
    url = f"/api/agent/v1/runs/{run.id}/context"

    assert client.get(url).status_code == 401
    assert client.get(url, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get(url, headers={"Authorization": "test-agent-key"}).status_code == 401
    assert client.get(url, headers=AGENT).status_code == 200


def test_other_devices_are_refused_even_with_the_key(
    remote_client: TestClient, setup: tuple[FlightRoute, Run]
) -> None:
    _, run = setup
    response = remote_client.get(f"/api/agent/v1/runs/{run.id}/context", headers=AGENT)

    assert response.status_code == 403
    assert "only accepts requests from this computer" in response.json()["detail"]


def test_api_is_off_without_a_configured_key(client: TestClient, use_settings, setup) -> None:
    _, run = setup
    use_settings(agent_ingest_api_key=None)

    response = client.get(f"/api/agent/v1/runs/{run.id}/context", headers=AGENT)

    assert response.status_code == 503


def test_agents_do_not_need_the_app_header(client: TestClient, setup: tuple[FlightRoute, Run]) -> None:
    route, run = setup
    client.headers.pop("X-Trip-Planner")

    assert len(submit(client, run, fare(route))["accepted"]) == 1


@pytest.mark.parametrize("state", ["queued", "succeeded", "cancelled"])
def test_only_running_runs_accept_data(
    client: TestClient, db_session: Session, setup: tuple[FlightRoute, Run], state: str
) -> None:
    route, run = setup
    run.status = state
    db_session.flush()

    response = client.post(
        f"/api/agent/v1/runs/{run.id}/flight-quotes", json={"quotes": [fare(route)]}, headers=AGENT
    )

    assert response.status_code == 409


# --- Task context -------------------------------------------------------------------------------


def test_context_lists_routes_and_keeps_travelers_private(
    client: TestClient, db_session: Session, setup: tuple[FlightRoute, Run]
) -> None:
    route, run = setup
    submit(client, run, fare(route, price_total="1500.00"))

    response = client.get(f"/api/agent/v1/runs/{run.id}/context", headers=AGENT)

    body = response.json()
    [ctx_route] = body["routes"]
    assert ctx_route["id"] == route.id
    assert ctx_route["nights"] == [7, 8] and ctx_route["passengers"] == 2
    assert ctx_route["cheapest_known"]["price_total"] == "1500.00"
    assert body["trip"]["travelers"] == 1
    assert "Alex" not in response.text
    assert "airbnb.com" in body["blocked_domains"]


def test_context_is_limited_to_the_chosen_routes(
    client: TestClient, db_session: Session, setup: tuple[FlightRoute, Run]
) -> None:
    _, run = setup
    other = add_route(db_session, db_session.get(Trip, run.trip_id), origin_codes=["SFO"])
    run.params = {"route_ids": [other.id]}
    db_session.flush()

    body = client.get(f"/api/agent/v1/runs/{run.id}/context", headers=AGENT).json()

    assert [r["id"] for r in body["routes"]] == [other.id]


def test_airport_lookup(client: TestClient, db_session: Session) -> None:
    add_airport(db_session, "NRT", "Tokyo", "Narita International")

    response = client.get("/api/agent/v1/airports", params={"q": "tokyo"}, headers=AGENT)

    assert [a["iata"] for a in response.json()] == ["NRT"]


# --- Flight quotes ----------------------------------------------------------------------------


def test_valid_fares_are_saved_as_indicative_agent_prices(
    client: TestClient, db_session: Session, setup: tuple[FlightRoute, Run]
) -> None:
    route, run = setup

    result = submit(client, run, fare(route))

    assert result["rejected"] == [] and result["duplicates"] == []
    quote = db_session.get(FlightQuote, result["accepted"][0]["id"])
    assert (quote.source, quote.confidence, quote.run_id) == ("agent", "indicative", run.id)
    assert quote.price_home == Decimal("1284.00")
    assert quote.source_domain == "www.kayak.com"


def test_per_person_prices_are_scaled_to_the_party(
    client: TestClient, db_session: Session, setup: tuple[FlightRoute, Run]
) -> None:
    route, run = setup

    [accepted] = submit(client, run, fare(route, price_total="642", passengers=1))["accepted"]

    quote = db_session.get(FlightQuote, accepted["id"])
    assert (quote.price_total, quote.passengers) == (Decimal("1284.00"), 2)
    assert accepted["flags"] == ["per_person_price_scaled"]


def test_foreign_currency_is_converted(
    client: TestClient, db_session: Session, setup: tuple[FlightRoute, Run]
) -> None:
    route, run = setup

    [accepted] = submit(client, run, fare(route, price_total="190000", currency="jpy"))["accepted"]

    quote = db_session.get(FlightQuote, accepted["id"])
    assert quote.currency == "JPY"
    assert quote.price_home == Decimal("1266.67")


def test_the_same_fare_twice_is_a_duplicate(client: TestClient, setup: tuple[FlightRoute, Run]) -> None:
    route, run = setup

    result = submit(client, run, fare(route), fare(route))

    assert len(result["accepted"]) == 1 and result["duplicates"] == [1]


REJECTIONS = [
    ({"origin": "SFO"}, "origin"),
    ({"destination": "HND"}, "destination"),
    ({"origin": "LAXX"}, "origin"),
    ({"depart_date": "2026-11-09", "return_date": "2026-11-16"}, "depart_date"),
    ({"return_date": "2026-11-20"}, "return_date"),
    ({"return_date": "<drop>"}, "return_date"),
    ({"return_date": "2026-11-04"}, "return_date"),
    ({"passengers": 3}, "passengers"),
    ({"price_total": "20.00"}, "price_total"),
    ({"price_total": "90000"}, "price_total"),
    ({"price_total": "-5"}, "price_total"),
    ({"currency": "XYZ"}, "currency"),
    ({"source_url": "<drop>"}, "source_url"),
    ({"source_url": "http://192.168.1.10/fares"}, "source_url"),
    ({"source_url": "http://localhost:8000/fares"}, "source_url"),
    ({"source_url": "ftp://fares.example.com/lax-nrt"}, "source_url"),
    ({"source_url": "https://www.airbnb.co.uk/rooms/42"}, "source_url"),
    ({"observed_at": "2026-01-01T00:00:00Z"}, "observed_at"),
    ({"cabin": "business"}, "cabin"),
]


@pytest.mark.parametrize(("changes", "field"), REJECTIONS)
def test_bad_fares_are_rejected_with_reasons(
    client: TestClient, db_session: Session, setup: tuple[FlightRoute, Run], changes: dict, field: str
) -> None:
    route, run = setup

    result = submit(client, run, fare(route, **changes))

    assert result["accepted"] == []
    [rejected] = result["rejected"]
    assert field in [e["field"] for e in rejected["errors"]], rejected


def test_one_bad_fare_does_not_block_the_rest(
    client: TestClient, db_session: Session, setup: tuple[FlightRoute, Run]
) -> None:
    route, run = setup

    result = submit(
        client, run, fare(route), fare(route, origin="SFO"), fare(route, return_date="2026-11-13")
    )

    assert [a["index"] for a in result["accepted"]] == [0, 2]
    assert [r["index"] for r in result["rejected"]] == [1]
    db_session.refresh(run)
    assert (run.accepted_count, run.rejected_count) == (2, 1)
    [logged] = db_session.scalars(select(IngestRejection).where(IngestRejection.run_id == run.id)).all()
    assert logged.entity == "flight_quote" and logged.item["origin"] == "SFO"
    assert logged.errors[0]["field"] == "origin"


def test_routes_from_other_trips_are_rejected(
    client: TestClient, db_session: Session, setup: tuple[FlightRoute, Run]
) -> None:
    _, run = setup
    elsewhere = add_route(db_session, add_trip(db_session, "Iceland"))

    [rejected] = submit(client, run, fare(elsewhere))["rejected"]

    assert rejected["errors"][0]["field"] == "route_id"


def test_past_departures_are_rejected(
    client: TestClient, db_session: Session, setup: tuple[FlightRoute, Run]
) -> None:
    route, run = setup
    route.depart_from, route.depart_to = date(2020, 1, 1), date(2020, 1, 5)
    db_session.flush()

    [rejected] = submit(client, run, fare(route, depart_date="2020-01-02", return_date="2020-01-09"))[
        "rejected"
    ]

    assert {"field": "depart_date", "msg": "is in the past"} in rejected["errors"]


def test_batches_are_limited_to_50(client: TestClient, setup: tuple[FlightRoute, Run]) -> None:
    route, run = setup
    response = client.post(
        f"/api/agent/v1/runs/{run.id}/flight-quotes", json={"quotes": [fare(route)] * 51}, headers=AGENT
    )

    assert response.status_code == 422


# --- Notes and finishing ------------------------------------------------------------------------


def test_notes_are_saved_with_their_links(
    client: TestClient, db_session: Session, setup: tuple[FlightRoute, Run]
) -> None:
    _, run = setup
    note = {
        "title": "ZIPAIR sale ends Oct 3",
        "body": "LAX–NRT from $299 one way.",
        "urls": ["https://zipair.net/en/sale"],
    }

    response = client.post(f"/api/agent/v1/runs/{run.id}/notes", json=note, headers=AGENT)

    assert response.status_code == 201
    saved = db_session.get(AgentNote, response.json()["id"])
    assert saved.urls == ["https://zipair.net/en/sale"] and saved.trip_id == run.trip_id


def test_notes_with_unusable_links_are_rejected(
    client: TestClient, db_session: Session, setup: tuple[FlightRoute, Run]
) -> None:
    _, run = setup
    note = {"title": "Stay", "body": "A flat.", "urls": ["https://www.airbnb.com/rooms/1"]}

    response = client.post(f"/api/agent/v1/runs/{run.id}/notes", json=note, headers=AGENT)

    assert response.status_code == 422
    db_session.refresh(run)
    assert run.rejected_count == 1
    assert db_session.scalar(select(AgentNote.id).where(AgentNote.run_id == run.id)) is None


def test_finish_keeps_the_agents_report_but_not_the_status(
    client: TestClient, db_session: Session, setup: tuple[FlightRoute, Run]
) -> None:
    _, run = setup
    report = {"status": "ok", "summary": "Checked 4 sites.", "sources_checked": ["kayak.com"], "issues": []}

    response = client.post(f"/api/agent/v1/runs/{run.id}/finish", json=report, headers=AGENT)

    assert response.status_code == 200
    db_session.refresh(run)
    assert run.report == report and run.summary == "Checked 4 sites."
    assert run.status == "running"  # the runner decides when Claude exits


# --- Link rules -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("host", "blocked"),
    [
        ("airbnb.com", "airbnb.com"),
        ("www.airbnb.co.uk", "airbnb.com"),
        ("fr.airbnb.ca", "airbnb.com"),
        ("www.vrbo.com", "vrbo.com"),
        ("secure.booking.com", "booking.com"),
        ("booking.flyfrontier.com", None),
        ("booking.aa.com", None),
        ("www.kayak.com", None),
    ],
)
def test_blocked_domains(host: str, blocked: str | None) -> None:
    assert blocked_domain(host) == blocked


@pytest.mark.parametrize(
    "url",
    [
        "http://10.0.0.5/x",
        "http://[::1]/x",
        "http://printer.local/x",
        "http://intranet/x",
        "javascript:alert(1)",
    ],
)
def test_private_or_odd_links_are_not_sources(url: str) -> None:
    assert source_problem(url) is not None


def test_public_links_are_sources() -> None:
    assert source_problem("https://www.united.com/en/us/fsr/choose-flights?f=LAX&t=NRT") is None
