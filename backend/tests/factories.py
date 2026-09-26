"""Small builders for test data and request payloads."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from tripplanner.models import Airport, FlightRoute, FxRate, Person, Run, Trip


def add_airport(
    db: Session, iata: str, city: str, name: str | None = None, kind: str = "large_airport"
) -> Airport:
    airport = Airport(
        iata=iata, name=name or f"{city} International", city=city, country_code="US", lat=0, lon=0, kind=kind
    )
    db.add(airport)
    db.flush()
    return airport


def add_person(db: Session, name: str = "Alex", color: str = "#c24472") -> Person:
    person = Person(name=name, color=color, home_airports=[])
    db.add(person)
    db.flush()
    return person


def destination(name: str = "Kyoto", **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": name,
        "region": "Kyoto Prefecture",
        "country": "Japan",
        "country_code": "jp",
        "kind": "city",
        "lat": 35.01,
        "lon": 135.77,
        "timezone": "Asia/Tokyo",
    }
    payload.update(overrides)
    return payload


def trip_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": "Japan in autumn",
        "start_date": "2026-11-05",
        "end_date": "2026-11-15",
        "status": "planning",
        "home_currency": "usd",
        "notes": "",
        "destinations": [destination()],
        "traveler_ids": [],
    }
    payload.update(overrides)
    return payload


def add_trip(db: Session, name: str = "Japan", currency: str = "USD") -> Trip:
    trip = Trip(name=name, home_currency=currency, destinations=[], travelers=[])
    db.add(trip)
    db.flush()
    return trip


def add_route(db: Session, trip: Trip, **overrides: Any) -> FlightRoute:
    values: dict[str, Any] = {
        "origin_codes": ["LAX"],
        "destination_codes": ["NRT"],
        "trip_type": "round_trip",
        "depart_from": date(2026, 11, 5),
        "depart_to": date(2026, 11, 7),
        "min_nights": 7,
        "max_nights": 8,
        "adults": 2,
        "children": 0,
        "cabin": "economy",
        "max_stops": None,
        "sources": ["serpapi", "travelpayouts"],
        "active": True,
    }
    values.update(overrides)
    route = FlightRoute(trip_id=trip.id, **values)
    db.add(route)
    db.flush()
    return route


def route_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "origin_codes": ["lax"],
        "destination_codes": ["NRT"],
        "trip_type": "round_trip",
        "depart_from": "2026-11-05",
        "depart_to": "2026-11-07",
        "min_nights": 7,
        "max_nights": 8,
        "adults": 2,
    }
    payload.update(overrides)
    return payload


def add_run(db: Session, trip: Trip, kind: str = "flight_agent", **overrides: Any) -> Run:
    values: dict[str, Any] = {
        "trip_id": trip.id,
        "kind": kind,
        "trigger": "manual",
        "status": "running",
        "params": {},
        "started_at": datetime.now(UTC) - timedelta(minutes=1),
    }
    values.update(overrides)
    run = Run(**values)
    db.add(run)
    db.flush()
    return run


def add_rates(db: Session, **per_eur: str) -> None:
    """Exchange rates as units per 1 EUR, e.g. add_rates(db, USD="1.10", JPY="165")."""
    today = date.today()
    for code, rate in {"EUR": "1", **per_eur}.items():
        db.add(FxRate(currency=code, per_eur=Decimal(rate), rate_date=today, fetched_at=datetime.now(UTC)))
    db.flush()
