"""Trip CRUD. Destinations are replaced as a list; travelers are referenced by person id."""

from sqlalchemy import case, select
from sqlalchemy.orm import Session, selectinload

from tripplanner.models import FlightRoute, Person, Trip, TripDestination
from tripplanner.schemas.people import PersonOut
from tripplanner.schemas.trips import DestinationIn, DestinationOut, TripCover, TripIn, TripOut
from tripplanner.services.flight_choice import check_dates, flight_dates

# Fields copied straight from the request onto a destination.
_LOCATION_FIELDS = ("name", "region", "country", "country_code", "kind", "lat", "lon", "timezone", "bbox")


class TripNotFound(LookupError):
    pass


class InvalidReference(ValueError):
    """The request mentions a traveler or destination that doesn't exist."""


def _with_relations():
    return select(Trip).options(
        selectinload(Trip.destinations),
        selectinload(Trip.travelers),
        selectinload(Trip.routes).selectinload(FlightRoute.chosen_quote),
    )


def list_trips(db: Session) -> list[Trip]:
    archived_last = case((Trip.status == "archived", 1), else_=0)
    stmt = _with_relations().order_by(archived_last, Trip.start_date.asc().nulls_last(), Trip.id)
    return list(db.scalars(stmt))


def get_trip(db: Session, trip_id: int) -> Trip:
    trip = db.scalar(_with_relations().where(Trip.id == trip_id))
    if trip is None:
        raise TripNotFound(trip_id)
    return trip


def _reset_info(destination: TripDestination) -> None:
    destination.info_status = "pending"
    destination.summary = destination.wiki_url = destination.image_url = destination.image_file = None
    destination.info_updated_at = None


def _apply_destinations(trip: Trip, items: list[DestinationIn]) -> list[TripDestination]:
    """Update, add, and remove destinations; returns those whose info must be (re)fetched."""
    existing = {d.id: d for d in trip.destinations}
    ordered: list[TripDestination] = []
    needs_info: list[TripDestination] = []
    for position, item in enumerate(items):
        if item.id is not None:
            destination = existing.get(item.id)
            if destination is None:
                raise InvalidReference(f"Destination {item.id} isn't part of this trip.")
            moved = (destination.name, destination.lat, destination.lon) != (item.name, item.lat, item.lon)
        else:
            destination = TripDestination()
            moved = True
        for field in _LOCATION_FIELDS:
            setattr(destination, field, getattr(item, field))
        destination.geoapify_place_id = item.geoapify_place_id
        destination.position = position
        if moved:
            _reset_info(destination)
        if destination.info_status != "ready":
            needs_info.append(destination)
        ordered.append(destination)
    trip.destinations = ordered
    return needs_info


def _apply(db: Session, trip: Trip, data: TripIn) -> list[TripDestination]:
    requested = list(dict.fromkeys(data.traveler_ids))
    people = {p.id: p for p in db.scalars(select(Person).where(Person.id.in_(requested)))}
    missing = [pid for pid in requested if pid not in people]
    if missing:
        raise InvalidReference(f"Unknown traveler id(s): {', '.join(map(str, missing))}")

    trip.name = data.name
    trip.start_date = data.start_date
    trip.end_date = data.end_date
    trip.status = data.status
    trip.home_currency = data.home_currency
    trip.notes = data.notes
    trip.travelers = [people[pid] for pid in sorted(requested)]
    return _apply_destinations(trip, data.destinations)


def create_trip(db: Session, data: TripIn) -> tuple[Trip, list[int]]:
    trip = Trip(destinations=[], travelers=[])
    needs_info = _apply(db, trip, data)
    db.add(trip)
    db.commit()
    return get_trip(db, trip.id), [d.id for d in needs_info]


def update_trip(db: Session, trip_id: int, data: TripIn) -> tuple[Trip, list[int]]:
    trip = get_trip(db, trip_id)
    check_dates(trip, data.start_date, data.end_date)
    needs_info = _apply(db, trip, data)
    db.commit()
    db.expire_all()
    return get_trip(db, trip_id), [d.id for d in needs_info]


def delete_trip(db: Session, trip_id: int) -> None:
    trip = get_trip(db, trip_id)
    db.delete(trip)
    db.commit()


def to_out(trip: Trip) -> TripOut:
    cover_source = next((d for d in trip.destinations if d.image_url), None)
    cover = (
        TripCover(
            image_url=cover_source.image_url,
            image_file=cover_source.image_file,
            wiki_url=cover_source.wiki_url,
            destination_name=cover_source.name,
        )
        if cover_source and cover_source.image_url
        else None
    )
    return TripOut(
        id=trip.id,
        name=trip.name,
        start_date=trip.start_date,
        end_date=trip.end_date,
        status=trip.status,
        home_currency=trip.home_currency,
        notes=trip.notes,
        destinations=[DestinationOut.model_validate(d) for d in trip.destinations],
        travelers=[PersonOut.model_validate(p) for p in trip.travelers],
        cover=cover,
        flight_dates=flight_dates(trip.routes),
        created_at=trip.created_at,
        updated_at=trip.updated_at,
    )
