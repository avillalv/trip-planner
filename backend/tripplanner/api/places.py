from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException, Query, status

from tripplanner import __version__
from tripplanner.api.deps import DbSession
from tripplanner.config import get_settings
from tripplanner.providers import ProviderError
from tripplanner.providers.wikipedia import WikipediaClient
from tripplanner.schemas.places import PlaceOut, PlaceSearchResult, SearchKind, WikiSummary
from tripplanner.services import places

router = APIRouter(prefix="/api/v1/places", tags=["places"])


def _api_key() -> str:
    key = get_settings().geoapify_api_key
    if key is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Add GEOAPIFY_API_KEY to .env to search for places."
        )
    return key.get_secret_value()


def _client() -> httpx.Client:
    return httpx.Client(timeout=15, headers={"User-Agent": f"TripPlanner/{__version__}"})


@router.get("/search", response_model=PlaceSearchResult)
def search_places(
    db: DbSession,
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    kind: SearchKind | None = None,
    q: Annotated[str | None, Query(min_length=2, max_length=100)] = None,
    radius_m: Annotated[int, Query(ge=200, le=50_000)] = 5000,
    offset: Annotated[int, Query(ge=0, le=200)] = 0,
) -> PlaceSearchResult:
    """Things to do near a point: by category (`kind`) or by name (`q`). Results are cached for a week."""
    if kind is None and not (q and q.strip()):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Type something to search for, or pick a category."
        )
    key = _api_key()
    try:
        with _client() as client:
            return places.search(
                db, client, key, lat=lat, lon=lon, radius_m=radius_m, kind=kind, text=q, offset=offset
            )
    except ProviderError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


@router.get("/wiki", response_model=WikiSummary | None)
def place_wiki(
    db: DbSession,
    wikidata: Annotated[str | None, Query(pattern=r"^Q\d+$")] = None,
    wikipedia: Annotated[str | None, Query(max_length=300)] = None,
) -> WikiSummary | None:
    """The English Wikipedia summary for a place, when it has one (null otherwise)."""
    contact = get_settings().wikimedia_contact
    if not contact or not (wikidata or wikipedia):
        return None
    wiki = WikipediaClient(contact)
    try:
        return places.wiki_summary(db, wiki, wikidata, wikipedia)
    finally:
        wiki.close()


@router.get("/geoapify/{place_id}", response_model=PlaceOut)
def place_details(place_id: str, db: DbSession) -> PlaceOut:
    """Hours, website, and links for a place found by name (category results already include them)."""
    key = _api_key()
    try:
        with _client() as client:
            place = places.details(db, client, key, place_id)
    except ProviderError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    if place is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Geoapify has no details for this place.")
    return place
