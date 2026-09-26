from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from tripplanner.models import Airport


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
