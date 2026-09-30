from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from tests.factories import add_route, add_trip
from tripplanner.models import FxRate
from tripplanner.schemas.flights import Layover, QuoteOut
from tripplanner.services import fx
from tripplanner.services.quotes import NewQuote, add_quote, best_options, date_grid, latest_same_flight

NOW = datetime(2026, 9, 26, 12, tzinfo=UTC)


def quote(
    price: int, depart: date = date(2026, 11, 5), ret: date | None = date(2026, 11, 12), **overrides
) -> NewQuote:
    values = {
        "source": "serpapi",
        "confidence": "live",
        "origin": "LAX",
        "destination": "NRT",
        "depart_date": depart,
        "return_date": ret,
        "price_total": Decimal(price),
        "currency": "USD",
        "passengers": 2,
        "observed_at": NOW,
        "airlines": ["ANA"],
    }
    values.update(overrides)
    return NewQuote(**values)


def test_same_fare_within_12_hours_is_stored_once(db_session: Session) -> None:
    route = add_route(db_session, add_trip(db_session))

    first = add_quote(db_session, route, quote(1200), "USD")
    again = add_quote(db_session, route, quote(1200, observed_at=NOW + timedelta(hours=6)), "USD")
    later = add_quote(db_session, route, quote(1200, observed_at=NOW + timedelta(hours=13)), "USD")

    assert first is not None and again is None and later is not None


def test_prices_are_converted_to_the_trip_currency(db_session: Session) -> None:
    db_session.add_all(
        [
            FxRate(currency="USD", per_eur=Decimal("1.10"), rate_date=date(2026, 9, 26), fetched_at=NOW),
            FxRate(currency="JPY", per_eur=Decimal("165"), rate_date=date(2026, 9, 26), fetched_at=NOW),
        ]
    )
    route = add_route(db_session, add_trip(db_session))

    stored = add_quote(db_session, route, quote(150_000, currency="JPY"), "USD")

    assert stored is not None
    assert stored.price_home == Decimal("1000.00")
    assert fx.convert(db_session, Decimal(10), "XXX", "USD") is None


def test_wildly_off_prices_are_flagged_suspect(db_session: Session) -> None:
    route = add_route(db_session, add_trip(db_session))
    for i, price in enumerate([1000, 1040, 980, 1100, 1020]):
        add_quote(db_session, route, quote(price, depart=date(2026, 11, 5 + i % 3)), "USD")

    too_cheap = add_quote(db_session, route, quote(90, airlines=["Too Good"]), "USD")
    normal = add_quote(db_session, route, quote(1060, airlines=["JAL"]), "USD")

    assert too_cheap is not None and too_cheap.suspect
    assert normal is not None and not normal.suspect


def test_best_options_keep_only_the_latest_price_per_itinerary(db_session: Session) -> None:
    trip = add_trip(db_session)
    route = add_route(db_session, trip)
    add_quote(db_session, route, quote(1500, observed_at=NOW - timedelta(days=1)), "USD")
    add_quote(db_session, route, quote(1300), "USD")  # same itinerary, newer
    add_quote(db_session, route, quote(900, airlines=["ZIPAIR"]), "USD")
    add_quote(
        db_session, route, quote(700, depart=date(2026, 9, 1), ret=date(2026, 9, 8)), "USD"
    )  # already departed
    old = add_quote(
        db_session, route, quote(500, airlines=["Old"], observed_at=NOW - timedelta(days=9)), "USD"
    )
    hidden = add_quote(db_session, route, quote(400, airlines=["Hidden"]), "USD")
    hidden.hidden = True
    db_session.flush()

    options = best_options(db_session, trip.id, now=NOW)

    assert [(o.airlines, o.price_total) for o in options] == [(["ZIPAIR"], 900), (["ANA"], 1300)]
    assert old not in options


def test_date_grid_takes_the_cheapest_per_date_pair(db_session: Session) -> None:
    route = add_route(db_session, add_trip(db_session))
    add_quote(db_session, route, quote(1300), "USD")
    cheap = add_quote(
        db_session, route, quote(1100, source="travelpayouts", confidence="cached", airlines=["MU"]), "USD"
    )
    later = add_quote(db_session, route, quote(1250, depart=date(2026, 11, 6), ret=date(2026, 11, 13)), "USD")
    assert cheap is not None and later is not None

    cells = date_grid(db_session, route.id, now=NOW)

    # Each cell names the fare it came from, so it can be chosen as the trip's flight.
    assert [(c[0], c[1], c[3], c[4]) for c in cells] == [
        (cheap.id, date(2026, 11, 5), Decimal(1100), "travelpayouts"),
        (later.id, date(2026, 11, 6), Decimal(1250), "serpapi"),
    ]


COPA = {"airlines": ["Copa Airlines"], "depart_at_local": "2026-11-25 15:17"}


def test_connections_with_the_same_first_flight_stay_separate(db_session: Session) -> None:
    trip = add_trip(db_session)
    route = add_route(db_session, trip)
    overnight = add_quote(db_session, route, quote(1500, flight_numbers=["CM 467", "CM 342"], **COPA), "USD")
    same_evening = add_quote(
        db_session, route, quote(1500, flight_numbers=["CM 467", "CM 162"], **COPA), "USD"
    )
    assert overnight is not None and same_evening is not None  # the same price isn't a duplicate

    options = best_options(db_session, trip.id, now=NOW)

    assert sorted(o.flight_numbers for o in options) == [["CM 467", "CM 162"], ["CM 467", "CM 342"]]


def test_the_latest_price_is_for_the_same_connection(db_session: Session) -> None:
    route = add_route(db_session, add_trip(db_session))
    overnight = ["CM 467", "CM 342"]
    chosen = add_quote(
        db_session,
        route,
        quote(1500, flight_numbers=overnight, observed_at=NOW - timedelta(days=1), **COPA),
        "USD",
    )
    add_quote(db_session, route, quote(1000, flight_numbers=["CM 467", "CM 162"], **COPA), "USD")
    newer = add_quote(db_session, route, quote(1450, flight_numbers=overnight, **COPA), "USD")
    unknown = add_quote(db_session, route, quote(900, airlines=["Other"]), "USD")  # no flight numbers
    assert chosen is not None and newer is not None and unknown is not None

    assert latest_same_flight(db_session, chosen) == newer
    assert latest_same_flight(db_session, unknown) == unknown


def test_layovers_come_from_the_google_itinerary(db_session: Session) -> None:
    route = add_route(db_session, add_trip(db_session))
    raw = {
        "layovers": [
            {"id": "PTY", "name": "Tocumen International Airport", "duration": 1062, "overnight": True},
            {"id": "MIA", "name": "Miami International Airport", "duration": 95},
            {"name": "No code", "duration": 50},
        ]
    }
    google = add_quote(db_session, route, quote(1500, raw=raw), "USD")
    manual = add_quote(db_session, route, quote(1400, airlines=["Other"], raw={"booked": True}), "USD")
    assert google is not None and manual is not None

    out = QuoteOut.model_validate(google)

    assert out.layovers == [
        Layover(airport="PTY", minutes=1062, overnight=True),
        Layover(airport="MIA", minutes=95, overnight=False),
    ]
    assert "raw" not in out.model_dump() and out.model_dump()["layovers"][0]["airport"] == "PTY"
    assert QuoteOut.model_validate(manual).layovers == []
