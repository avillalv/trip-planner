from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException, Query, status

from tripplanner import __version__
from tripplanner.api.deps import DbSession
from tripplanner.api.lodging import OUT_OF_SEARCHES
from tripplanner.config import get_settings
from tripplanner.models import Trip
from tripplanner.providers import ProviderError
from tripplanner.schemas.automation import RunOut
from tripplanner.schemas.itinerary import ActivityOut
from tripplanner.schemas.lodging import AskLodgingIn
from tripplanner.schemas.suggestions import (
    AddSuggestionIn,
    IdeasIn,
    SuggestionOut,
    SuggestionStatus,
    SuggestionUpdate,
)
from tripplanner.services import ai_lodging, lodging, suggestions

router = APIRouter(prefix="/api/v1", tags=["suggestions"])


def _trip(db: DbSession, trip_id: int) -> Trip:
    trip = db.get(Trip, trip_id)
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found.")
    return trip


GONE = "Suggestion not found. It may have been removed with its trip."


@router.post("/trips/{trip_id}/ai/ideas", response_model=RunOut, status_code=status.HTTP_202_ACCEPTED)
def ask_for_ideas(trip_id: int, body: IdeasIn, db: DbSession) -> RunOut:
    """Queue a Claude run that suggests things to do. Poll the run, then read the trip's suggestions."""
    try:
        return RunOut.model_validate(suggestions.ask_for_ideas(db, _trip(db, trip_id), body))
    except suggestions.IdeasNotAllowed as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    except suggestions.IdeasBusy as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except suggestions.IdeasUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc


@router.post("/trips/{trip_id}/ai/lodging", response_model=RunOut, status_code=status.HTTP_202_ACCEPTED)
def ask_for_lodging(trip_id: int, body: AskLodgingIn, db: DbSession) -> RunOut:
    """Search Google Hotels for the dates (one SerpApi search), then queue a Claude run that ranks the
    best places to stay. The picks arrive as lodging options; poll the run, then read the trip's lodging."""
    trip = _trip(db, trip_id)
    key = get_settings().serpapi_api_key
    try:
        with httpx.Client(timeout=60, headers={"User-Agent": f"TripPlanner/{__version__}"}) as client:
            run = ai_lodging.ask_for_picks(db, client, key.get_secret_value() if key else None, trip, body)
    except suggestions.IdeasBusy as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except suggestions.IdeasUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except lodging.OutOfSearches as exc:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, OUT_OF_SEARCHES) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    except ProviderError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    return RunOut.model_validate(run)


@router.get("/trips/{trip_id}/suggestions", response_model=list[SuggestionOut])
def list_suggestions(
    trip_id: int,
    db: DbSession,
    suggestion_status: Annotated[list[SuggestionStatus] | None, Query(alias="status")] = None,
) -> list[SuggestionOut]:
    """The trip's suggestions, newest run first. Without `status`, the new and added ones."""
    _trip(db, trip_id)
    return [
        SuggestionOut.model_validate(s) for s in suggestions.list_suggestions(db, trip_id, suggestion_status)
    ]


@router.patch("/suggestions/{suggestion_id}", response_model=SuggestionOut)
def update_suggestion(suggestion_id: int, body: SuggestionUpdate, db: DbSession) -> SuggestionOut:
    """Dismiss a suggestion, or bring a dismissed one back."""
    try:
        return SuggestionOut.model_validate(suggestions.set_status(db, suggestion_id, body.status))
    except suggestions.SuggestionNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, GONE) from exc
    except suggestions.AlreadyAdded as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc


@router.post(
    "/suggestions/{suggestion_id}/add", response_model=ActivityOut, status_code=status.HTTP_201_CREATED
)
def add_suggestion(suggestion_id: int, db: DbSession, body: AddSuggestionIn | None = None) -> ActivityOut:
    """Add the suggestion to the itinerary: planned at its day and time, or as an idea with `as_idea`."""
    try:
        activity = suggestions.add_to_itinerary(db, suggestion_id, as_idea=bool(body and body.as_idea))
    except suggestions.SuggestionNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, GONE) from exc
    except suggestions.AlreadyAdded as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return ActivityOut.model_validate(activity)
