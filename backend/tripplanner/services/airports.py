import math

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from tripplanner.models import Airport

EARTH_RADIUS_KM = 6371.0


def search_airports(db: Session, query: str, limit: int = 10) -> list[Airport]:
    """Exact code first, then big airports, matching the code, city, or airport name."""
    q = query.strip()
    if not q:
        return []
    code = q.upper()
    exact = case((Airport.iata == code, 0), else_=1)
    size = case((Airport.kind == "large_airport", 0), (Airport.kind == "medium_airport", 1), else_=2)
    stmt = (
        select(Airport)
        .where(
            or_(
                Airport.iata == code,
                func.lower(Airport.city).startswith(q.lower()),
                Airport.name.ilike(f"%{q}%"),
            )
        )
        .order_by(exact, size, Airport.name)
        .limit(limit)
    )
    return list(db.scalars(stmt))


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance (haversine)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def nearby_airports(
    db: Session, lat: float, lon: float, radius_km: float = 150, limit: int = 4
) -> list[tuple[Airport, float]]:
    """Airports with scheduled service near a point: large ones first, then by distance."""
    # A bounding box keeps the candidate set small before the exact distance check.
    dlat = radius_km / 111.0
    dlon = radius_km / max(1.0, 111.0 * math.cos(math.radians(lat)))
    candidates = db.scalars(
        select(Airport).where(
            Airport.lat.between(lat - dlat, lat + dlat),
            Airport.lon.between(lon - dlon, lon + dlon),
            Airport.kind.in_(["large_airport", "medium_airport"]),
        )
    )
    rank = {"large_airport": 0, "medium_airport": 1}
    found = [(a, distance_km(lat, lon, a.lat, a.lon)) for a in candidates]
    found = [(a, d) for a, d in found if d <= radius_km]
    found.sort(key=lambda item: (rank.get(item[0].kind, 2), item[1]))
    return found[:limit]
