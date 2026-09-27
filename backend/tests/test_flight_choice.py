"""Choosing the trip's flight: its dates become the trip's dates, and stay that way."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.factories import add_route, add_trip
from tripplanner.models import FlightQuote, FlightRoute, Trip
from tripplanner.services import presentation
from tripplanner.services.quotes import NewQuote, add_quote
from tripplanner.services.search_planner import PlannerInput, pick_live_searches

NOW = datetime.now(UTC)
TODAY = NOW.date()


def day(offset: int) -> date:
    return TODAY + timedelta(days=offset)


@pytest.fixture
def trip(db_session: Session) -> Trip:
    trip = add_trip(db_session)
    trip.start_date, trip.end_date = day(40), day(49)
    db_session.flush()
    return trip


def fare(
    db: Session,
    route: FlightRoute,
    depart: date,
    ret: date | None,
    price: int = 1400,
    airline: str = "American",
    seen: datetime = NOW,
) -> FlightQuote:
    quote = add_quote(
        db,
        route,
        NewQuote(
            source="serpapi",
            confidence="live",
            origin=route.origin_codes[0],
            destination=route.destination_codes[0],
            depart_date=depart,
            return_date=ret,
            price_total=Decimal(price),
            currency="USD",
            passengers=route.adults,
            observed_at=seen,
            airlines=[airline],
            stops_out=0,
            stops_back=0 if ret else None,
        ),
        "USD",
    )
    assert quote is not None
    return quote


def round_trip(db: Session, trip: Trip) -> FlightRoute:
    return add_route(
        db,
        trip,
        origin_codes=["CLT"],
        destination_codes=["SJO"],
        depart_from=day(38),
        depart_to=day(46),
        min_nights=None,
        max_nights=None,
        return_from=day(43),
        return_to=day(55),
    )


def one_way(db: Session, trip: Trip, origin: str, destination: str, start: int) -> FlightRoute:
    return add_route(
        db,
        trip,
        origin_codes=[origin],
        destination_codes=[destination],
        trip_type="one_way",
        depart_from=day(start),
        depart_to=day(start + 6),
        min_nights=None,
        max_nights=None,
    )


def choose(client: TestClient, route: FlightRoute, quote: FlightQuote) -> dict:
    response = client.put(f"/api/v1/routes/{route.id}/choice", json={"quote_id": quote.id})
    assert response.status_code == 200, response.text
    return response.json()


def edit_dates(client: TestClient, trip: dict, start: date, end: date):
    body = {
        "name": trip["name"],
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "status": trip["status"],
        "home_currency": trip["home_currency"],
        "notes": trip["notes"],
        "destinations": [],
        "traveler_ids": [],
    }
    return client.put(f"/api/v1/trips/{trip['id']}", json=body)


def test_a_chosen_round_trip_sets_the_trips_dates(
    client: TestClient, db_session: Session, trip: Trip
) -> None:
    route = round_trip(db_session, trip)
    flight = fare(db_session, route, day(42), day(54), airline="Air Canada")

    updated = choose(client, route, flight)

    assert (updated["start_date"], updated["end_date"]) == (day(42).isoformat(), day(54).isoformat())
    assert updated["flight_dates"]["start"] == day(42).isoformat()
    assert updated["flight_dates"]["end"] == day(54).isoformat()
    [chosen] = updated["flight_dates"]["flights"]
    assert (chosen["origin"], chosen["destination"], chosen["airlines"]) == ("CLT", "SJO", ["Air Canada"])


def test_the_dates_stay_with_the_flight_until_the_choice_is_cleared(
    client: TestClient, db_session: Session, trip: Trip
) -> None:
    route = round_trip(db_session, trip)
    updated = choose(client, route, fare(db_session, route, day(42), day(54)))

    refused = edit_dates(client, updated, day(41), day(54))
    assert refused.status_code == 422
    assert "come from the flight you chose" in refused.json()["detail"]
    # The rest of the trip can still change, with the flight's dates as they are.
    renamed = edit_dates(client, {**updated, "name": "Pura vida"}, day(42), day(54))
    assert renamed.status_code == 200 and renamed.json()["name"] == "Pura vida"

    cleared = client.delete(f"/api/v1/routes/{route.id}/choice").json()
    assert cleared["flight_dates"] is None
    assert (cleared["start_date"], cleared["end_date"]) == (day(42).isoformat(), day(54).isoformat())
    assert edit_dates(client, cleared, day(41), day(50)).status_code == 200


def test_two_one_way_flights_set_the_start_and_the_end(
    client: TestClient, db_session: Session, trip: Trip
) -> None:
    out = one_way(db_session, trip, "CLT", "SJO", 38)
    home = one_way(db_session, trip, "LIR", "CLT", 45)

    after_out = choose(client, out, fare(db_session, out, day(39), None))
    assert (after_out["start_date"], after_out["end_date"]) == (day(39).isoformat(), day(49).isoformat())
    assert after_out["flight_dates"]["end"] is None  # the end is still yours to set

    after_home = choose(client, home, fare(db_session, home, day(48), None))
    assert (after_home["start_date"], after_home["end_date"]) == (day(39).isoformat(), day(48).isoformat())
    assert after_home["flight_dates"]["end"] == day(48).isoformat()


def test_only_this_routes_upcoming_fares_can_be_chosen(
    client: TestClient, db_session: Session, trip: Trip
) -> None:
    route = round_trip(db_session, trip)
    other = round_trip(db_session, trip)
    theirs = fare(db_session, other, day(42), day(54))
    gone = fare(db_session, route, day(-2), day(5))

    wrong_route = client.put(f"/api/v1/routes/{route.id}/choice", json={"quote_id": theirs.id})
    departed = client.put(f"/api/v1/routes/{route.id}/choice", json={"quote_id": gone.id})

    assert wrong_route.status_code == 422
    assert departed.status_code == 422 and "already left" in departed.json()["detail"]


def test_the_route_shows_the_chosen_flight_and_its_latest_price(
    client: TestClient, db_session: Session, trip: Trip
) -> None:
    route = round_trip(db_session, trip)
    chosen = fare(db_session, route, day(42), day(54), price=1446, seen=NOW - timedelta(days=2))
    choose(client, route, chosen)
    fare(db_session, route, day(42), day(54), price=1390)  # the same flight, cheaper now

    [summary] = client.get(f"/api/v1/trips/{trip.id}/flights/summary").json()

    assert Decimal(summary["chosen"]["price_total"]) == Decimal(1446)
    assert Decimal(summary["chosen_latest"]["price_total"]) == Decimal(1390)


def test_deleting_the_route_keeps_the_dates_but_frees_them(
    client: TestClient, db_session: Session, trip: Trip
) -> None:
    route = round_trip(db_session, trip)
    choose(client, route, fare(db_session, route, day(42), day(54)))

    assert client.delete(f"/api/v1/routes/{route.id}").status_code == 204
    after = client.get(f"/api/v1/trips/{trip.id}").json()

    assert after["flight_dates"] is None
    assert (after["start_date"], after["end_date"]) == (day(42).isoformat(), day(54).isoformat())


def test_the_chosen_flight_is_checked_first_even_outside_the_window() -> None:
    window = [(day(40), day(47)), (day(41), day(48))]
    chosen = (day(30), day(37))
    plan = PlannerInput(
        pairs=window, cached_prices={}, last_live_check={}, best_live_pair=None, chosen_pair=chosen
    )

    picks = pick_live_searches(plan, 2, NOW)
    assert picks[0] == chosen and len(picks) == 2  # then the window, as before
    recent = PlannerInput(
        pairs=window,
        cached_prices={},
        last_live_check={chosen: NOW - timedelta(hours=1)},
        best_live_pair=None,
        chosen_pair=chosen,
    )
    assert chosen not in pick_live_searches(recent, 2, NOW)


def test_the_deck_leads_with_the_chosen_flight(client: TestClient, db_session: Session, trip: Trip) -> None:
    route = round_trip(db_session, trip)
    chosen = fare(db_session, route, day(42), day(54), price=1500, airline="Air Canada")
    fare(db_session, route, day(43), day(52), price=1300, airline="American")
    choose(client, route, chosen)

    [flights] = presentation.build(db_session, db_session.get(Trip, trip.id), now=NOW).routes

    assert flights.chosen is not None and flights.chosen.airlines == ["Air Canada"]
    assert [q.airlines for q in flights.options] == [["American"]]
