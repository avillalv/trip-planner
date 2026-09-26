import httpx
from fastapi import APIRouter, HTTPException, status

from tripplanner import __version__
from tripplanner.api.deps import DbSession
from tripplanner.config import get_settings
from tripplanner.models import Person, Trip
from tripplanner.providers import ProviderError
from tripplanner.schemas.lodging import (
    HeartIn,
    LinkPreview,
    LinkPreviewIn,
    LodgingIn,
    LodgingOut,
    LodgingUpdate,
    RentalSearchIn,
    RentalSearchResult,
)
from tripplanner.services import lodging

router = APIRouter(prefix="/api/v1", tags=["lodging"])

DUPLICATE = "This listing is already on the trip's list."


def _trip(db: DbSession, trip_id: int) -> Trip:
    trip = db.get(Trip, trip_id)
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found.")
    return trip


def _option(db: DbSession, option_id: int):
    try:
        return lodging.get_option(db, option_id)
    except lodging.LodgingNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This place to stay no longer exists.") from exc


@router.get("/trips/{trip_id}/lodging", response_model=list[LodgingOut])
def list_lodging(trip_id: int, db: DbSession) -> list[LodgingOut]:
    return lodging.list_options(db, _trip(db, trip_id))


@router.post("/trips/{trip_id}/lodging", response_model=LodgingOut, status_code=status.HTTP_201_CREATED)
def add_lodging(trip_id: int, body: LodgingIn, db: DbSession) -> LodgingOut:
    trip = _trip(db, trip_id)
    try:
        return lodging.to_out(db, lodging.create_option(db, trip, body), trip)
    except lodging.DuplicateLodging as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, DUPLICATE) from exc


@router.patch("/lodging/{option_id}", response_model=LodgingOut)
def update_lodging(option_id: int, body: LodgingUpdate, db: DbSession) -> LodgingOut:
    option = _option(db, option_id)
    try:
        return lodging.to_out(db, lodging.update_option(db, option, body))
    except lodging.DuplicateLodging as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, DUPLICATE) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.delete("/lodging/{option_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lodging(option_id: int, db: DbSession) -> None:
    db.delete(_option(db, option_id))
    db.commit()


@router.put("/lodging/{option_id}/hearts/{person_id}", response_model=LodgingOut)
def heart_lodging(option_id: int, person_id: int, body: HeartIn, db: DbSession) -> LodgingOut:
    """Each traveler can heart the places they like."""
    option = _option(db, option_id)
    if db.get(Person, person_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Traveler not found.")
    lodging.set_heart(db, option, person_id, body.hearted)
    return lodging.to_out(db, option)


@router.post("/lodging/preview", response_model=LinkPreview)
def preview_link(body: LinkPreviewIn) -> LinkPreview:
    """Dates and guests from a pasted link; with `fetch`, also the page's title and photo."""
    with httpx.Client(timeout=8, headers={"User-Agent": f"TripPlanner/{__version__}"}) as client:
        return lodging.preview_link(client, body.url, body.fetch)


@router.post("/trips/{trip_id}/lodging/search-rentals", response_model=RentalSearchResult)
def search_rentals(trip_id: int, body: RentalSearchIn, db: DbSession) -> RentalSearchResult:
    """Priced vacation rentals for the dates (one SerpApi search; repeats within 12 hours are free)."""
    key = get_settings().serpapi_api_key
    if key is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Add SERPAPI_API_KEY to .env to search rentals."
        )
    trip = _trip(db, trip_id)
    try:
        with httpx.Client(timeout=60, headers={"User-Agent": f"TripPlanner/{__version__}"}) as client:
            return lodging.search_rentals(db, client, key.get_secret_value(), trip, body)
    except lodging.OutOfSearches as exc:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "This month's live searches are used up (they're shared with flight price checks). "
            "They reset on the 1st.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    except ProviderError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
