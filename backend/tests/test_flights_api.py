from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.factories import add_airport, route_payload, trip_payload


def make_trip(client: TestClient, db_session: Session) -> dict:
    add_airport(db_session, "LAX", "Los Angeles")
    add_airport(db_session, "NRT", "Tokyo")
    add_airport(db_session, "HND", "Tokyo")
    return client.post("/api/v1/trips", json=trip_payload()).json()


def test_creating_a_route_schedules_checks_and_queues_one_now(
    client: TestClient, db_session: Session
) -> None:
    trip = make_trip(client, db_session)

    response = client.post(f"/api/v1/trips/{trip['id']}/routes", json=route_payload())

    assert response.status_code == 201
    route = response.json()
    assert route["origin_codes"] == ["LAX"]
    assert route["sources"] == ["serpapi", "travelpayouts"]
    [routine] = client.get(f"/api/v1/trips/{trip['id']}/routines").json()
    assert (routine["kind"], routine["schedule_cron"], routine["enabled"]) == (
        "flight_api",
        "0 8,20 * * *",
        True,
    )
    assert routine["next_run_at"] is not None
    [run] = client.get("/api/v1/runs", params={"trip_id": trip["id"]}).json()
    assert (run["status"], run["trigger"], run["params"]) == (
        "queued",
        "manual",
        {"route_ids": [route["id"]]},
    )


def test_route_rules(client: TestClient, db_session: Session) -> None:
    trip = make_trip(client, db_session)
    url = f"/api/v1/trips/{trip['id']}/routes"

    def error(**overrides: object) -> str:
        response = client.post(url, json=route_payload(**overrides))
        assert response.status_code == 422, response.text
        return response.text

    assert "either a return window or a trip length" in error(
        return_from="2026-11-12", return_to="2026-11-14"
    )
    assert "One-way routes" in error(trip_type="one_way")
    assert "both an origin and a destination" in error(destination_codes=["LAX"])
    assert "maximum nights must be at least" in error(min_nights=9, max_nights=7)
    assert "60 days or less" in error(depart_to="2027-02-01")
    assert "Unknown airport code(s): ZZZ" in error(destination_codes=["ZZZ"])


def test_refresh_reuses_a_queued_run(client: TestClient, db_session: Session) -> None:
    trip = make_trip(client, db_session)

    first = client.post(f"/api/v1/trips/{trip['id']}/flights/refresh", json={})
    second = client.post(f"/api/v1/trips/{trip['id']}/flights/refresh", json={})

    assert first.status_code == 202
    assert first.json()["id"] == second.json()["id"]


def test_routine_can_be_paused_and_rescheduled(client: TestClient, db_session: Session) -> None:
    trip = make_trip(client, db_session)
    client.post(f"/api/v1/trips/{trip['id']}/routes", json=route_payload())
    [routine] = client.get(f"/api/v1/trips/{trip['id']}/routines").json()

    paused = client.patch(f"/api/v1/routines/{routine['id']}", json={"enabled": False}).json()
    bad = client.patch(f"/api/v1/routines/{routine['id']}", json={"schedule_cron": "whenever works"})
    moved = client.patch(f"/api/v1/routines/{routine['id']}", json={"schedule_cron": "30 7 * * *"}).json()

    assert paused["enabled"] is False and paused["next_run_at"] is None
    assert bad.status_code == 422
    assert moved["schedule_cron"] == "30 7 * * *"


def test_cancelling_a_queued_run(client: TestClient, db_session: Session) -> None:
    trip = make_trip(client, db_session)
    run = client.post(f"/api/v1/trips/{trip['id']}/flights/refresh", json={}).json()

    cancelled = client.post(f"/api/v1/runs/{run['id']}/cancel").json()

    assert cancelled["status"] == "cancelled"
    assert client.get(f"/api/v1/runs/{run['id']}/events").json() == []


def test_usage_endpoint(client: TestClient) -> None:
    usage = client.get("/api/v1/usage/serpapi").json()

    assert usage["monthly_cap"] == 240
    assert usage["used_this_month"] == 0
