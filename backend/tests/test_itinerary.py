"""Days and activities, including conflicting edits from two devices."""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.factories import add_trip
from tripplanner.models import Trip, TripDestination


@pytest.fixture
def trip(db_session: Session) -> Trip:
    trip = add_trip(db_session)
    trip.start_date, trip.end_date = date(2026, 11, 5), date(2026, 11, 8)
    trip.destinations = [
        TripDestination(
            position=0, name="Tokyo", lat=35.68, lon=139.69, timezone="Asia/Tokyo", info_status="skipped"
        ),
        TripDestination(
            position=1, name="Kyoto", lat=35.01, lon=135.77, timezone="Asia/Tokyo", info_status="skipped"
        ),
    ]
    db_session.flush()
    return trip


def add(client: TestClient, trip: Trip, **fields) -> dict:
    response = client.post(f"/api/v1/trips/{trip.id}/activities", json={"title": "Senso-ji", **fields})
    assert response.status_code == 201, response.text
    return response.json()


def test_days_follow_the_trip_dates(client: TestClient, trip: Trip) -> None:
    days = client.get(f"/api/v1/trips/{trip.id}/days").json()

    assert [d["day"] for d in days] == ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]
    assert days[0]["destination_name"] == "Tokyo" and days[0]["timezone"] == "Asia/Tokyo"
    assert days[0]["activity_count"] == 0 and days[0]["first"] is None


def test_days_summarize_their_activities(client: TestClient, trip: Trip) -> None:
    add(
        client,
        trip,
        title="Tsukiji breakfast",
        day="2026-11-05",
        start_time="07:30",
        end_time="08:30",
        category="food",
    )
    add(client, trip, title="teamLab", day="2026-11-05", start_time="19:00", end_time="21:00")
    add(client, trip, title="Buy a Suica card", day="2026-11-05")
    add(client, trip, title="Maybe: sumo practice")

    day = client.get(f"/api/v1/trips/{trip.id}/days").json()[0]

    assert day["activity_count"] == 3
    assert day["first"] == {"title": "Tsukiji breakfast", "start_time": "07:30:00"}
    assert day["last"] == {"title": "teamLab", "start_time": "19:00:00"}


def test_a_day_can_move_to_another_city(client: TestClient, trip: Trip) -> None:
    kyoto = trip.destinations[1]

    response = client.put(
        f"/api/v1/trips/{trip.id}/days/2026-11-07", json={"title": "Temples", "destination_id": kyoto.id}
    )

    assert response.json()["destination_name"] == "Kyoto" and response.json()["title"] == "Temples"
    days = client.get(f"/api/v1/trips/{trip.id}/days").json()
    assert [d["destination_name"] for d in days] == ["Tokyo", "Tokyo", "Kyoto", "Tokyo"]


def test_a_day_cannot_use_another_trips_destination(
    client: TestClient, db_session: Session, trip: Trip
) -> None:
    other = add_trip(db_session, "Iceland")
    other.destinations = [
        TripDestination(position=0, name="Reykjavik", lat=64.1, lon=-21.9, info_status="skipped")
    ]
    db_session.flush()

    response = client.put(
        f"/api/v1/trips/{trip.id}/days/2026-11-06", json={"destination_id": other.destinations[0].id}
    )

    assert response.status_code == 422


def test_days_outside_the_trip_still_show_their_activities(client: TestClient, trip: Trip) -> None:
    add(client, trip, day="2026-11-12", start_time="10:00")

    days = client.get(f"/api/v1/trips/{trip.id}/days").json()

    assert days[-1]["day"] == "2026-11-12" and days[-1]["in_trip"] is False


def test_ideas_and_scheduled_activities(client: TestClient, trip: Trip) -> None:
    idea = add(client, trip, title="Ghibli Museum", category="museum")
    planned = add(client, trip, title="Meiji Shrine", day="2026-11-06", start_time="09:00", end_time="10:30")

    assert idea["status"] == "idea" and planned["status"] == "planned"
    ideas = client.get(f"/api/v1/trips/{trip.id}/activities", params={"ideas": True}).json()
    on_day = client.get(f"/api/v1/trips/{trip.id}/activities", params={"day": "2026-11-06"}).json()
    assert [a["title"] for a in ideas] == ["Ghibli Museum"]
    assert [a["title"] for a in on_day] == ["Meiji Shrine"]


@pytest.mark.parametrize(
    "fields",
    [
        {"start_time": "10:00"},
        {"day": "2026-11-06", "end_time": "11:00"},
        {"day": "2026-11-06", "start_time": "10:00", "end_time": "10:00"},
        {"url": "ftp://example.com"},
        {"lat": 35.0},
        {"category": "karaoke"},
    ],
)
def test_invalid_activities_are_refused(client: TestClient, trip: Trip, fields: dict) -> None:
    response = client.post(f"/api/v1/trips/{trip.id}/activities", json={"title": "Thing", **fields})

    assert response.status_code == 422


def test_evenings_can_run_past_midnight(client: TestClient, trip: Trip) -> None:
    late = add(client, trip, title="Golden Gai", day="2026-11-06", start_time="22:00", end_time="01:30")

    assert (late["start_time"], late["end_time"]) == ("22:00:00", "01:30:00")


def test_moving_an_activity_between_days_and_ideas(client: TestClient, trip: Trip) -> None:
    activity = add(client, trip, title="Shibuya Sky", day="2026-11-05", start_time="17:00", end_time="18:00")

    moved = client.patch(
        f"/api/v1/activities/{activity['id']}", json={"version": activity["version"], "day": "2026-11-07"}
    ).json()
    assert (moved["day"], moved["start_time"], moved["version"]) == ("2026-11-07", "17:00:00", 2)

    unplanned = client.patch(f"/api/v1/activities/{moved['id']}", json={"version": 2, "day": None}).json()
    assert (unplanned["day"], unplanned["start_time"], unplanned["status"]) == (None, None, "idea")

    replanned = client.patch(
        f"/api/v1/activities/{moved['id']}", json={"version": 3, "day": "2026-11-08"}
    ).json()
    assert replanned["status"] == "planned"


def test_an_edit_from_an_older_version_is_a_conflict(client: TestClient, trip: Trip) -> None:
    activity = add(client, trip, day="2026-11-05", start_time="10:00", end_time="12:00")
    url = f"/api/v1/activities/{activity['id']}"

    phone = client.patch(url, json={"version": 1, "start_time": "14:00", "end_time": "16:00"})
    laptop = client.patch(url, json={"version": 1, "title": "Senso-ji at night"})

    assert phone.status_code == 200
    assert laptop.status_code == 409
    assert "changed on another device" in laptop.json()["detail"]
    latest = client.get(f"/api/v1/trips/{trip.id}/activities").json()[0]
    assert (latest["title"], latest["start_time"], latest["version"]) == ("Senso-ji", "14:00:00", 2)


def test_required_fields_cannot_be_cleared(client: TestClient, trip: Trip) -> None:
    activity = add(client, trip)

    response = client.patch(f"/api/v1/activities/{activity['id']}", json={"version": 1, "title": None})

    assert response.status_code == 422


def test_delete_needs_the_current_version(client: TestClient, trip: Trip) -> None:
    activity = add(client, trip)
    url = f"/api/v1/activities/{activity['id']}"
    client.patch(url, json={"version": 1, "notes": "Go early"})

    assert client.delete(url, params={"version": 1}).status_code == 409
    assert client.delete(url, params={"version": 2}).status_code == 204
    assert client.patch(url, json={"version": 2, "notes": "x"}).status_code == 404


def test_activities_remember_the_place_they_came_from(client: TestClient, trip: Trip) -> None:
    place = {"provider": "geoapify", "id": "51abc", "data": {"opening_hours": "9:00-17:00"}}

    activity = add(client, trip, title="Kyoto National Museum", lat=34.99, lon=135.77, place=place)

    assert (activity["place_provider"], activity["place_id"]) == ("geoapify", "51abc")
    assert activity["place_data"] == {"opening_hours": "9:00-17:00"}
