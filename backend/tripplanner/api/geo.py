import httpx
from fastapi import APIRouter, HTTPException, Query, status

from tripplanner.api.deps import DbSession
from tripplanner.config import get_settings
from tripplanner.providers import ProviderError
from tripplanner.providers.geoapify import search_destinations
from tripplanner.schemas.geo import AirportOut, DestinationSuggestion, NearbyAirport
from tripplanner.services.airports import nearby_airports, search_airports

router = APIRouter(prefix="/api/v1", tags=["lookup"])


@router.get("/geo/destinations", response_model=list[DestinationSuggestion])
async def destination_suggestions(
    q: str = Query(min_length=2, max_length=100),
) -> list[DestinationSuggestion]:
    key = get_settings().geoapify_api_key
    if key is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Add GEOAPIFY_API_KEY to .env to search for destinations."
        )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            return await search_destinations(q, key.get_secret_value(), client)
    except ProviderError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/airports", response_model=list[AirportOut])
def airports(db: DbSession, q: str = Query(min_length=1, max_length=60)) -> list[AirportOut]:
    return [AirportOut.model_validate(a) for a in search_airports(db, q)]


@router.get("/airports/nearby", response_model=list[NearbyAirport])
def airports_nearby(
    db: DbSession,
    lat: float = Query(ge=-90, le=90),
    lon: float = Query(ge=-180, le=180),
    radius_km: float = Query(150, gt=0, le=500),
) -> list[NearbyAirport]:
    """Airports near a destination, for suggesting where to fly."""
    return [
        NearbyAirport.model_validate(
            {**AirportOut.model_validate(a).model_dump(), "distance_km": round(d, 1)}
        )
        for a, d in nearby_airports(db, lat, lon, radius_km)
    ]
