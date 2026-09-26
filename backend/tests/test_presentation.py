"""The presentation deck's one payload: what's shown, what's left out, and in what order."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.factories import add_person, add_rates, add_route, add_trip
from tripplanner.models import LodgingOption, LodgingVote, Trip, TripDestination
from tripplanner.services import fx, presentation
from tripplanner.services.quotes import NewQuote, add_quote

NOW = datetime(2026, 9, 26, 12, tzinfo=UTC)


@pytest.fixture
def trip(db_session: Session) -> Trip:
    trip = add_trip(db_session)
    trip.start_date, trip.end_date = date(2026, 11, 5), date(2026, 11, 8)
    trip.destinations = [
        TripDestination(
            position=0,
            name="Kyoto",
            country="Japan",
            country_code="JP",
            lat=35.01,
            lon=135.77,
            timezone="Asia/Tokyo",
            info_status="skipped",
        )
    ]
    add_rates(db_session, USD="1.10", JPY="165")
    db_session.flush()
    return trip


def test_a_new_trip_has_just_its_basics(client: TestClient, trip: Trip) -> None:
    deck = client.get(f"/api/v1/trips/{trip.id}/presentation").json()

    assert deck["trip"]["name"] == "Japan"
    assert (deck["routes"], deck["lodging"], deck["days"], deck["idea_count"]) == ([], [], [], 0)
    [kyoto] = deck["destinations"]
    assert kyoto["currency"] == "JPY"
    assert Decimal(kyoto["rate"]).quantize(Decimal("0.01")) == Decimal("150.00")


def test_an_unknown_trip_is_not_found(client: TestClient) -> None:
    assert client.get("/api/v1/trips/987654/presentation").status_code == 404


def test_local_currencies() -> None:
    assert (fx.local_currency("jp"), fx.local_currency("BG"), fx.local_currency("EC")) == (
        "JPY",
        "EUR",
        "USD",
    )
    assert fx.local_currency(None) is None
    assert fx.local_currency("ZZ") is None


def fare(price: int, observed_at: datetime, depart: date = date(2026, 11, 5), **overrides) -> NewQuote:
    values = {
        "source": "serpapi",
        "confidence": "live",
        "origin": "LAX",
        "destination": "NRT",
        "depart_date": depart,
        "return_date": depart + timedelta(days=7),
        "price_total": Decimal(price),
        "currency": "USD",
        "passengers": 2,
        "observed_at": observed_at,
        "airlines": ["ANA"],
    }
    values.update(overrides)
    return NewQuote(**values)


def test_fares_show_the_cheapest_trusted_options_and_their_daily_low(db_session: Session, trip: Trip) -> None:
    route = add_route(db_session, trip)
    add_route(db_session, trip, destination_codes=["KIX"])  # no fares yet, so no slide
    add_quote(db_session, route, fare(1400, NOW - timedelta(days=2)), "USD")
    add_quote(db_session, route, fare(1300, NOW - timedelta(days=1)), "USD")  # same flight, cheaper now
    cached = fare(1320, NOW - timedelta(days=1), source="travelpayouts", confidence="cached")
    add_quote(db_session, route, cached, "USD")  # the same flight again, from another source
    add_quote(db_session, route, fare(1250, NOW, date(2026, 11, 6), airlines=["JAL"]), "USD")
    add_quote(db_session, route, fare(1350, NOW, airlines=["United"]), "USD")
    add_quote(db_session, route, fare(1500, NOW, airlines=["ZIPAIR"]), "USD")
    too_good = add_quote(db_session, route, fare(400, NOW, airlines=["Mystery Air"]), "USD")
    assert too_good is not None
    too_good.suspect = True

    [flights] = presentation.build(db_session, trip, now=NOW).routes

    assert [(q.price_total, q.airlines) for q in flights.options] == [
        (Decimal("1250.00"), ["JAL"]),
        (Decimal("1300.00"), ["ANA"]),
        (Decimal("1350.00"), ["United"]),
    ]
    assert [(p.day, p.price) for p in flights.trend] == [
        (date(2026, 9, 24), Decimal("1400.00")),
        (date(2026, 9, 25), Decimal("1300.00")),
        (date(2026, 9, 26), Decimal("1250.00")),
    ]


def stay(db: Session, trip: Trip, title: str, **fields) -> LodgingOption:
    option = LodgingOption(trip_id=trip.id, title=title, added_via="manual", **fields)
    db.add(option)
    db.flush()
    return option


def test_lodging_shows_the_shortlist_best_first(db_session: Session, trip: Trip) -> None:
    stay(db_session, trip, "Hostel", status="rejected", favorite=True)
    stay(db_session, trip, "Cheap guesthouse", status="candidate", price_home_total=Decimal(200))
    starred = stay(db_session, trip, "Starred machiya", status="candidate", favorite=True)
    stay(db_session, trip, "Shortlisted ryokan", status="shortlisted")
    stay(db_session, trip, "Booked hotel", status="booked")
    db_session.add(LodgingVote(lodging_id=starred.id, person_id=add_person(db_session).id))

    titles = [o.title for o in presentation.build(db_session, trip, now=NOW).lodging]

    assert titles == ["Booked hotel", "Shortlisted ryokan", "Starred machiya"]


def test_without_a_shortlist_every_option_still_considered_shows(db_session: Session, trip: Trip) -> None:
    stay(db_session, trip, "Pricier", status="candidate", price_home_total=Decimal(600))
    stay(db_session, trip, "Cheaper", status="candidate", price_home_total=Decimal(300))
    stay(db_session, trip, "Ruled out", status="rejected")

    titles = [o.title for o in presentation.build(db_session, trip, now=NOW).lodging]

    assert titles == ["Cheaper", "Pricier"]


def test_days_with_nothing_on_them_are_left_out(client: TestClient, trip: Trip) -> None:
    for fields in (
        {"title": "Nishiki Market", "day": "2026-11-05"},
        {"title": "Kinkaku-ji", "day": "2026-11-05", "start_time": "13:00", "end_time": "14:30"},
        {"title": "Fushimi Inari", "day": "2026-11-05", "start_time": "07:00", "end_time": "09:00"},
        {"title": "Ghibli Museum"},
    ):
        assert client.post(f"/api/v1/trips/{trip.id}/activities", json=fields).status_code == 201
    client.put(f"/api/v1/trips/{trip.id}/days/2026-11-06", json={"title": "Rest day"})

    deck = client.get(f"/api/v1/trips/{trip.id}/presentation").json()

    assert [(d["day"], d["title"], d["destination_name"]) for d in deck["days"]] == [
        ("2026-11-05", "", "Kyoto"),
        ("2026-11-06", "Rest day", "Kyoto"),
    ]
    assert [a["title"] for a in deck["days"][0]["activities"]] == [
        "Fushimi Inari",
        "Kinkaku-ji",
        "Nishiki Market",
    ]
    assert deck["idea_count"] == 1
