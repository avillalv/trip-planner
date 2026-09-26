"""Flight route CRUD."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from tripplanner.models import Airport, FlightRoute, Trip
from tripplanner.schemas.flights import RouteIn
from tripplanner.services.routines import ensure_flight_routine


class RouteNotFound(LookupError):
    pass


class UnknownAirport(ValueError):
    pass


def _check_airports(db: Session, codes: list[str]) -> None:
    known = set(db.scalars(select(Airport.iata).where(Airport.iata.in_(codes))))
    unknown = [c for c in codes if c not in known]
    if unknown:
        raise UnknownAirport(f"Unknown airport code(s): {', '.join(unknown)}")


def list_routes(db: Session, trip_id: int) -> list[FlightRoute]:
    return list(
        db.scalars(select(FlightRoute).where(FlightRoute.trip_id == trip_id).order_by(FlightRoute.id))
    )


def get_route(db: Session, route_id: int) -> FlightRoute:
    route = db.get(FlightRoute, route_id)
    if route is None:
        raise RouteNotFound(route_id)
    return route


def _apply(route: FlightRoute, data: RouteIn) -> None:
    for field, value in data.model_dump().items():
        setattr(route, field, value)


def create_route(db: Session, trip: Trip, data: RouteIn) -> FlightRoute:
    _check_airports(db, data.origin_codes + data.destination_codes)
    route = FlightRoute(trip_id=trip.id)
    _apply(route, data)
    db.add(route)
    ensure_flight_routine(db, trip)
    db.commit()
    return route


def update_route(db: Session, route_id: int, data: RouteIn) -> FlightRoute:
    route = get_route(db, route_id)
    _check_airports(db, data.origin_codes + data.destination_codes)
    _apply(route, data)
    db.commit()
    return route


def delete_route(db: Session, route_id: int) -> None:
    db.delete(get_route(db, route_id))
    db.commit()
