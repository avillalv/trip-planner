"""Managing agent routines from the app, and reading what their runs produced."""

from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tests.factories import add_route, add_run, add_trip
from tripplanner.models import AgentNote, FlightQuote, FlightRoute, IngestRejection, Routine, Run, Trip
from tripplanner.services.routines import ensure_flight_routine


@pytest.fixture
def trip(db_session: Session) -> Trip:
    trip = add_trip(db_session)
    add_route(db_session, trip)
    return trip


def routine_payload(trip: Trip, **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "trip_id": trip.id,
        "name": "Fare scout",
        "kind": "flight_agent",
        "schedule_cron": "0 8,20 * * *",
        "config": {"instructions": "Look at budget airlines.", "max_turns": 30},
    }
    payload.update(overrides)
    return payload


def test_create_an_agent_routine(client: TestClient, trip: Trip) -> None:
    response = client.post("/api/v1/routines", json=routine_payload(trip))

    assert response.status_code == 201
    body = response.json()
    assert body["kind"] == "flight_agent" and body["enabled"]
    assert body["config"]["instructions"] == "Look at budget airlines."
    assert body["config"]["max_turns"] == 30
    assert body["next_run_at"] is not None and body["last_run"] is None


def test_flight_agents_need_a_route_first(client: TestClient, db_session: Session) -> None:
    empty = add_trip(db_session, "Iceland")

    response = client.post("/api/v1/routines", json=routine_payload(empty))

    assert response.status_code == 422
    assert "Add a flight route" in response.json()["detail"]


def test_research_routines_do_not_need_routes(client: TestClient, db_session: Session) -> None:
    empty = add_trip(db_session, "Iceland")
    payload = routine_payload(empty, kind="research_agent", config={"topic": "Northern lights forecasts"})

    response = client.post("/api/v1/routines", json=payload)

    assert response.status_code == 201
    assert response.json()["config"]["topic"] == "Northern lights forecasts"


@pytest.mark.parametrize(
    ("changes", "status"),
    [
        ({"schedule_cron": "every day at 8"}, 422),
        ({"kind": "flight_api"}, 422),
        ({"config": {"max_turns": 500}}, 422),
        ({"config": {"route_ids": [999999]}}, 422),
    ],
)
def test_invalid_routines_are_refused(client: TestClient, trip: Trip, changes: dict, status: int) -> None:
    assert client.post("/api/v1/routines", json=routine_payload(trip, **changes)).status_code == status


def test_update_schedule_and_settings(client: TestClient, trip: Trip) -> None:
    created = client.post("/api/v1/routines", json=routine_payload(trip)).json()

    response = client.patch(
        f"/api/v1/routines/{created['id']}",
        json={"schedule_cron": "0 9 * * *", "enabled": False, "config": {"instructions": "Nonstop only."}},
    )

    body = response.json()
    assert (body["schedule_cron"], body["enabled"]) == ("0 9 * * *", False)
    assert body["config"]["instructions"] == "Nonstop only." and body["config"]["max_turns"] is None
    assert body["next_run_at"] is None  # off


def test_run_now_queues_one_manual_run(client: TestClient, db_session: Session, trip: Trip) -> None:
    created = client.post("/api/v1/routines", json=routine_payload(trip)).json()

    first = client.post(f"/api/v1/routines/{created['id']}/run")
    again = client.post(f"/api/v1/routines/{created['id']}/run")

    assert first.status_code == 202
    assert first.json()["id"] == again.json()["id"]
    assert (first.json()["trigger"], first.json()["status"]) == ("manual", "queued")


def test_deleting_a_routine_keeps_its_history(client: TestClient, db_session: Session, trip: Trip) -> None:
    created = client.post("/api/v1/routines", json=routine_payload(trip)).json()
    done = add_run(db_session, trip, routine_id=created["id"], status="succeeded")
    waiting = client.post(f"/api/v1/routines/{created['id']}/run").json()

    assert client.delete(f"/api/v1/routines/{created['id']}").status_code == 204

    db_session.expire_all()
    assert db_session.get(Routine, created["id"]) is None
    assert db_session.get(Run, done.id).status == "succeeded"
    assert db_session.scalar(select(Run.status).where(Run.id == waiting["id"])) == "cancelled"


def test_price_check_routines_can_only_be_turned_off(
    client: TestClient, db_session: Session, trip: Trip
) -> None:
    routine = ensure_flight_routine(db_session, trip)

    response = client.delete(f"/api/v1/routines/{routine.id}")

    assert response.status_code == 409


def test_list_routines_by_trip(client: TestClient, db_session: Session, trip: Trip) -> None:
    ensure_flight_routine(db_session, trip)
    client.post("/api/v1/routines", json=routine_payload(trip))
    other = add_trip(db_session, "Iceland")
    client.post("/api/v1/routines", json=routine_payload(other, kind="research_agent"))

    kinds = [r["kind"] for r in client.get("/api/v1/routines", params={"trip_id": trip.id}).json()]

    assert kinds == ["flight_api", "flight_agent"]
    assert len(client.get("/api/v1/routines").json()) == 3


def test_run_detail_and_outputs(client: TestClient, db_session: Session, trip: Trip) -> None:
    route_id = db_session.scalar(select(FlightRoute.id).where(FlightRoute.trip_id == trip.id))
    run = add_run(db_session, trip, status="succeeded", prompt="Find fares", argv_redacted=["claude", "-p"])
    db_session.add_all(
        [
            FlightQuote(
                route_id=route_id,
                trip_id=trip.id,
                run_id=run.id,
                source="agent",
                confidence="indicative",
                origin="LAX",
                destination="NRT",
                depart_date=date(2026, 11, 5),
                return_date=date(2026, 11, 12),
                price_total=1284,
                currency="USD",
                price_home=1284,
                home_currency="USD",
                passengers=2,
                airlines=["ZIPAIR"],
                source_url="https://zipair.net/en",
                observed_at=run.started_at,
                dedupe_key="k1",
            ),
            AgentNote(trip_id=trip.id, run_id=run.id, title="Sale", body="Ends Oct 3.", urls=[]),
            IngestRejection(
                run_id=run.id,
                entity="flight_quote",
                item={"origin": "SFO"},
                errors=[{"field": "origin", "msg": "must be one of LAX"}],
            ),
        ]
    )
    db_session.flush()

    detail = client.get(f"/api/v1/runs/{run.id}").json()
    outputs = client.get(f"/api/v1/runs/{run.id}/outputs").json()

    assert detail["prompt"] == "Find fares" and detail["argv_redacted"] == ["claude", "-p"]
    assert [q["price_total"] for q in outputs["quotes"]] == ["1284.00"]
    assert [n["title"] for n in outputs["notes"]] == ["Sale"]
    assert outputs["rejections"][0]["errors"] == [{"field": "origin", "msg": "must be one of LAX"}]


def test_runs_filter_by_status(client: TestClient, db_session: Session, trip: Trip) -> None:
    add_run(db_session, trip, status="failed")
    add_run(db_session, trip, status="succeeded")

    runs = client.get("/api/v1/runs", params={"trip_id": trip.id, "status": "failed"}).json()

    assert [r["status"] for r in runs] == ["failed"]


def test_trip_notes_can_be_read_and_dismissed(client: TestClient, db_session: Session, trip: Trip) -> None:
    run = add_run(db_session, trip, kind="research_agent")
    note = AgentNote(trip_id=trip.id, run_id=run.id, title="Festival", body="Nov 7-9.", urls=["https://x.jp"])
    db_session.add(note)
    db_session.flush()

    listed = client.get(f"/api/v1/trips/{trip.id}/notes").json()
    removed = client.delete(f"/api/v1/notes/{note.id}")

    assert [n["title"] for n in listed] == ["Festival"]
    assert removed.status_code == 204
    assert client.get(f"/api/v1/trips/{trip.id}/notes").json() == []
