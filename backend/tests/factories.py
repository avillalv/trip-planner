"""Small builders for test data and request payloads."""

from typing import Any

from sqlalchemy.orm import Session

from tripplanner.models import Airport, Person


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
