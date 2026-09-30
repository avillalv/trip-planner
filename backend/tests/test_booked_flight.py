"""Recording a booked flight: its fare, legs, itinerary entries, and the trip dates that follow."""

from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tests.factories import add_airport, add_route, add_trip
from tripplanner.models import Activity, FlightQuote, FlightRoute, Trip
from tripplanner.schemas.flights import BookedFlightIn
from tripplanner.services import booked_flight, presentation, quotes

NOW = datetime.now(UTC)
TODAY = NOW.date()

# The Copa flights the travelers booked: overnight in Panama City on the way out.
COPA_LEGS = [
    ("out", "CM 467", "RDU", "PTY", "2026-11-25T15:17", "2026-11-25T19:46"),
    ("out", "CM 342", "PTY", "SJO", "2026-11-26T13:28", "2026-11-26T13:51"),
    ("back", "CM 465", "SJO", "PTY", "2026-12-06T05:35", "2026-12-06T08:03"),
    ("back", "CM 466", "PTY", "RDU", "2026-12-06T08:57", "2026-12-06T13:21"),
]


def leg(direction: str, number: str, origin: str, destination: str, depart: str, arrive: str) -> dict:
    return {
        "direction": direction,
        "flight_number": number,
        "origin": origin,
        "destination": destination,
        "depart_at": depart,
        "arrive_at": arrive,
    }


def payload(legs=COPA_LEGS, **overrides: object) -> dict:
    body = {
        "airline": "Copa Airlines",
        "price_per_person": "374.89",
        "currency": "USD",
        "passengers": 2,
        "segments": [leg(*args) for args in legs],
    }
    body.update(overrides)
    return body


def copa_from(start: date) -> list[tuple[str, ...]]:
    """The same four flights, moved so the trip starts on `start`."""
    delta = start - date(2026, 11, 25)

    def moved(text: str) -> str:
        return (datetime.fromisoformat(text) + delta).strftime("%Y-%m-%dT%H:%M")

    return [(d, n, o, t, moved(dep), moved(arr)) for d, n, o, t, dep, arr in COPA_LEGS]


@pytest.fixture
def route(db_session: Session) -> FlightRoute:
    """A route from Raleigh to San José. Panama City, where the flights connect, isn't part of it."""
    add_airport(db_session, "RDU", "Raleigh", "Raleigh-Durham International Airport")
    add_airport(db_session, "PTY", "Panama City", "Tocumen International Airport")
    add_airport(db_session, "SJO", "San José", "Juan Santamaría International Airport")
    trip = add_trip(db_session, "Costa Rica")
    trip.start_date, trip.end_date = TODAY + timedelta(days=50), TODAY + timedelta(days=58)
    route = add_route(db_session, trip, origin_codes=["RDU"], destination_codes=["SJO"], adults=2)
    db_session.commit()
    return route


def post(client: TestClient, route: FlightRoute, body: dict):
    return client.post(f"/api/v1/routes/{route.id}/booked-flight", json=body)


def booked_quotes(db: Session, route: FlightRoute) -> list[FlightQuote]:
    return list(db.scalars(select(FlightQuote).where(FlightQuote.route_id == route.id)))


def leg_activities(db: Session, trip_id: int) -> list[Activity]:
    return list(
        db.scalars(
            select(Activity)
            .where(Activity.trip_id == trip_id, Activity.flight_quote_id.is_not(None))
            .order_by(Activity.day, Activity.start_time)
        )
    )


def put_dates(client: TestClient, trip_id: int, start: date, end: date):
    body = {
        "name": "Costa Rica",
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "status": "planning",
        "home_currency": "USD",
        "notes": "",
        "destinations": [],
        "traveler_ids": [],
    }
    return client.put(f"/api/v1/trips/{trip_id}", json=body)


def test_the_copa_flights_become_the_trips_flight(
    client: TestClient, db_session: Session, route: FlightRoute
) -> None:
    body = BookedFlightIn.model_validate(payload())

    trip = booked_flight.record(db_session, route, body, today=date(2026, 9, 29))

    # Dates: out on the first flight's day, back on the first return flight's day, and locked there.
    assert (trip.start_date, trip.end_date) == (date(2026, 11, 25), date(2026, 12, 6))
    locked = put_dates(client, trip.id, date(2026, 11, 20), date(2026, 12, 6))
    assert locked.status_code == 422 and "come from the flight you chose" in locked.text

    # The fare: hidden from the options, but the route's chosen flight; price checks stop.
    [quote] = booked_quotes(db_session, route)
    assert (quote.source, quote.confidence, quote.hidden, quote.suspect) == (
        "manual",
        "indicative",
        True,
        False,
    )
    assert route.chosen_quote_id == quote.id and route.active is False
    assert (quote.origin, quote.destination, quote.airlines) == ("RDU", "SJO", ["Copa Airlines"])
    assert (quote.depart_date, quote.return_date, quote.depart_at_local) == (
        date(2026, 11, 25),
        date(2026, 12, 6),
        "2026-11-25 15:17",
    )
    assert (quote.price_total, quote.passengers, quote.price_home) == (
        Decimal("749.78"),
        2,
        Decimal("749.78"),
    )
    assert (quote.stops_out, quote.stops_back) == (1, 1)
    assert quote.flight_numbers == ["CM 467", "CM 342", "CM 465", "CM 466"]
    assert quote.segments[1] == leg(*COPA_LEGS[1])
    assert route.origin_codes == ["RDU"] and route.destination_codes == ["SJO"]
    assert quotes.best_options(db_session, trip.id, now=datetime(2026, 9, 30, tzinfo=UTC)) == []

    # Itinerary: one booked travel entry per leg, on the day it leaves.
    legs = leg_activities(db_session, trip.id)
    assert [(a.day, a.start_time, a.end_time, a.title) for a in legs] == [
        (date(2026, 11, 25), time(15, 17), time(19, 46), "CM 467 · RDU → PTY"),
        (date(2026, 11, 26), time(13, 28), time(13, 51), "CM 342 · PTY → SJO"),
        (date(2026, 12, 6), time(5, 35), time(8, 3), "CM 465 · SJO → PTY"),
        (date(2026, 12, 6), time(8, 57), time(13, 21), "CM 466 · PTY → RDU"),
    ]
    assert {(a.category, a.status, a.flight_quote_id) for a in legs} == {("travel", "booked", quote.id)}
    assert legs[0].location_name == "Raleigh-Durham International Airport"
    assert legs[1].notes == "Copa Airlines. Arrives 1:51 PM local time at SJO."
    assert legs[2].notes == "Copa Airlines. Arrives 8:03 AM local time at PTY."

    # The trip page and deck show it, though the fare is hidden.
    [summary] = client.get(f"/api/v1/trips/{trip.id}/flights/summary").json()
    assert summary["cheapest"] is None and summary["chosen"]["id"] == quote.id
    assert [s["flight_number"] for s in summary["chosen"]["segments"]] == [
        "CM 467",
        "CM 342",
        "CM 465",
        "CM 466",
    ]
    assert summary["chosen"]["layovers"] == []
    [deck] = presentation.build(db_session, db_session.get(Trip, trip.id)).routes
    assert deck.chosen is not None and deck.chosen.id == quote.id


def test_recording_through_the_api_returns_the_trip_and_replaces_an_earlier_booking(
    client: TestClient, db_session: Session, route: FlightRoute
) -> None:
    first = post(client, route, payload(copa_from(TODAY + timedelta(days=40))))
    assert first.status_code == 200, first.text
    assert first.json()["start_date"] == (TODAY + timedelta(days=40)).isoformat()
    [old] = booked_quotes(db_session, route)
    old_id = old.id

    again = post(client, route, payload(copa_from(TODAY + timedelta(days=41)), price_per_person="400"))

    assert again.status_code == 200, again.text
    body = again.json()
    assert (body["start_date"], body["end_date"]) == (
        (TODAY + timedelta(days=41)).isoformat(),
        (TODAY + timedelta(days=52)).isoformat(),
    )
    assert body["flight_dates"]["flights"][0]["airlines"] == ["Copa Airlines"]
    [quote] = booked_quotes(db_session, route)  # the old fare is gone
    assert quote.id != old_id and quote.price_total == 800
    assert {a.flight_quote_id for a in leg_activities(db_session, route.trip_id)} == {quote.id}
    assert len(leg_activities(db_session, route.trip_id)) == 4  # and so are its old legs


def test_a_one_way_flight_sets_only_the_start(
    client: TestClient, db_session: Session, route: FlightRoute
) -> None:
    day = TODAY + timedelta(days=40)
    response = post(client, route, payload([("out", "CM 467", "RDU", "PTY", f"{day}T15:17", f"{day}T19:46")]))

    assert response.status_code == 200, response.text
    [quote] = booked_quotes(db_session, route)
    assert (quote.return_date, quote.stops_out, quote.stops_back) == (None, 0, None)
    assert response.json()["start_date"] == day.isoformat()


def test_a_leg_arriving_the_next_day_is_noted_and_runs_past_midnight(
    client: TestClient, db_session: Session, route: FlightRoute
) -> None:
    day = TODAY + timedelta(days=40)
    red_eye = ("out", "AA 1", "RDU", "SJO", f"{day}T23:10", f"{day + timedelta(days=1)}T02:05")

    assert post(client, route, payload([red_eye])).status_code == 200

    [activity] = leg_activities(db_session, route.trip_id)
    assert (activity.start_time, activity.end_time) == (time(23, 10), time(2, 5))
    arrives = day + timedelta(days=1)
    assert activity.notes == f"Copa Airlines. Arrives {arrives:%b} {arrives.day}, 2:05 AM local time at SJO."


def test_an_unknown_airport_or_route_is_refused(
    client: TestClient, db_session: Session, route: FlightRoute
) -> None:
    day = TODAY + timedelta(days=40)
    unknown = payload([("out", "CM 467", "RDU", "ZZZ", f"{day}T15:17", f"{day}T19:46")])

    response = post(client, route, unknown)

    assert response.status_code == 422 and "Unknown airport code(s): ZZZ" in response.text
    assert booked_quotes(db_session, route) == []
    assert client.post("/api/v1/routes/999999/booked-flight", json=payload()).status_code == 404


def test_a_flight_that_already_left_is_refused_and_the_earlier_booking_stays(
    client: TestClient, db_session: Session, route: FlightRoute
) -> None:
    assert post(client, route, payload(copa_from(TODAY + timedelta(days=40)))).status_code == 200
    [kept] = booked_quotes(db_session, route)

    response = post(client, route, payload(copa_from(TODAY - timedelta(days=5))))

    assert response.status_code == 422 and "already left" in response.text
    assert [q.id for q in booked_quotes(db_session, route)] == [kept.id]
    assert len(leg_activities(db_session, route.trip_id)) == 4
    assert (
        db_session.scalar(select(func.count()).select_from(FlightQuote).where(FlightQuote.source == "manual"))
        == 1
    )


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ({"segments": [leg(*COPA_LEGS[2])]}, "at least one outbound"),
        ({"segments": [leg(*COPA_LEGS[1]), leg(*COPA_LEGS[0])]}, "in the order you fly them"),
        (
            {
                "segments": [
                    leg(*COPA_LEGS[0]),
                    leg("back", "CM 1", "SJO", "RDU", "2026-11-24T08:00", "2026-11-24T12:00"),
                ]
            },
            "on or after the last outbound",
        ),
        ({"segments": []}, "at least 1 item"),
        ({"price_per_person": "0"}, "greater than 0"),
        ({"passengers": 0}, "greater than or equal to 1"),
        (
            {"segments": [leg("out", "C", "RDU", "PTY", "2026-11-25T15:17", "2026-11-25T19:46")]},
            "flight_number",
        ),
        (
            {"segments": [leg("out", "CM 467", "RDU", "PTY", "2026-11-25T15:17Z", "2026-11-25T19:46")]},
            "timezone",
        ),
    ],
)
def test_booked_flight_rules(body: dict, message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        BookedFlightIn.model_validate(payload() | body)
