"""Fixtures for the browser smoke test (`npm run test:e2e`), run from the backend folder:

    python -m tests.e2e_seed reset   # empty TEST database, migrated, with a few airports
    python -m tests.e2e_seed fares   # prices for the newest route, as if checked over a week

Only TEST_DATABASE_URL is ever touched; the app's own database is never opened.
"""

import sys
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import create_engine, select, text

from tripplanner.config import get_settings, override_settings

AIRPORTS = [
    ("LAX", "KLAX", "Los Angeles International Airport", "Los Angeles", "US", 33.9425, -118.408),
    ("HND", "RJTT", "Tokyo Haneda International Airport", "Tokyo", "JP", 35.5523, 139.7797),
    ("NRT", "RJAA", "Narita International Airport", "Tokyo", "JP", 35.7647, 140.3864),
]

# (days ago, total price, airline, stops)
FARES = [
    (6, 1480, "ANA", 0),
    (4, 1390, "ANA", 0),
    (2, 1310, "ANA", 0),
    (0, 1248, "ANA", 0),
    (0, 1302, "Japan Airlines", 0),
]


def _use_test_database() -> str:
    settings = get_settings()
    url = settings.test_database_url
    if not url or url == settings.database_url:
        sys.exit("Set TEST_DATABASE_URL in .env to a database other than DATABASE_URL.")
    override_settings(settings.model_copy(update={"database_url": url}))
    return url


def reset() -> None:
    url = _use_test_database()
    from tripplanner.db import new_session
    from tripplanner.migrate import upgrade
    from tripplanner.models import Airport

    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    engine.dispose()
    upgrade(url)
    with new_session() as db:
        for iata, icao, name, city, country, lat, lon in AIRPORTS:
            db.add(
                Airport(
                    iata=iata,
                    icao=icao,
                    name=name,
                    city=city,
                    country_code=country,
                    lat=lat,
                    lon=lon,
                    kind="large_airport",
                )
            )
        db.commit()
    print("Test database reset.")


def fares() -> None:
    _use_test_database()
    from tripplanner.db import new_session
    from tripplanner.models import FlightRoute, Trip
    from tripplanner.services.quotes import NewQuote, add_quote

    now = datetime.now(UTC)
    with new_session() as db:
        route = db.scalars(select(FlightRoute).order_by(FlightRoute.id.desc())).first()
        if route is None:
            sys.exit("There's no route to add fares to.")
        trip = db.get(Trip, route.trip_id)
        assert trip is not None
        nights = route.min_nights or 7
        for days_ago, price, airline, stops in FARES:
            quote = NewQuote(
                source="serpapi",
                confidence="live",
                origin=route.origin_codes[0],
                destination=route.destination_codes[0],
                depart_date=route.depart_from,
                return_date=route.depart_from + timedelta(days=nights),
                price_total=Decimal(price),
                currency=trip.home_currency,
                passengers=route.adults + route.children,
                observed_at=now - timedelta(days=days_ago),
                airlines=[airline],
                stops_out=stops,
                stops_back=stops,
            )
            add_quote(db, route, quote, trip.home_currency)
        db.commit()
    print(f"Added {len(FARES)} fares to route {route.id}.")


if __name__ == "__main__":
    commands = {"reset": reset, "fares": fares}
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        sys.exit("Usage: python -m tests.e2e_seed reset|fares")
    commands[sys.argv[1]]()
