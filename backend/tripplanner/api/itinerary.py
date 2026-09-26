from datetime import date

from fastapi import APIRouter, HTTPException, Query, status

from tripplanner.api.deps import DbSession
from tripplanner.models import Trip
from tripplanner.schemas.itinerary import ActivityIn, ActivityOut, ActivityUpdate, DayOut, DayUpdate
from tripplanner.services import itinerary

router = APIRouter(prefix="/api/v1", tags=["itinerary"])

CONFLICT = (
    "This activity was changed on another device. The latest version is shown now; make your change again."
)
GONE = "This activity no longer exists. It may have been deleted on another device."


def _trip(db: DbSession, trip_id: int) -> Trip:
    trip = db.get(Trip, trip_id)
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found.")
    return trip


@router.get("/trips/{trip_id}/days", response_model=list[DayOut])
def list_days(trip_id: int, db: DbSession) -> list[DayOut]:
    """Every day of the trip (plus any outside its dates that have activities), with a summary of each."""
    return itinerary.list_days(db, _trip(db, trip_id))


@router.put("/trips/{trip_id}/days/{day}", response_model=DayOut)
def update_day(trip_id: int, day: date, body: DayUpdate, db: DbSession) -> DayOut:
    try:
        return itinerary.update_day(db, _trip(db, trip_id), day, body)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.get("/trips/{trip_id}/activities", response_model=list[ActivityOut])
def list_activities(
    trip_id: int,
    db: DbSession,
    day: date | None = None,
    ideas: bool = Query(False, description="Only ideas (activities without a day)"),
) -> list[ActivityOut]:
    _trip(db, trip_id)
    return [ActivityOut.model_validate(a) for a in itinerary.list_activities(db, trip_id, day, ideas)]


@router.post("/trips/{trip_id}/activities", response_model=ActivityOut, status_code=status.HTTP_201_CREATED)
def create_activity(trip_id: int, body: ActivityIn, db: DbSession) -> ActivityOut:
    return ActivityOut.model_validate(itinerary.create_activity(db, _trip(db, trip_id), body))


@router.patch("/activities/{activity_id}", response_model=ActivityOut)
def update_activity(activity_id: int, body: ActivityUpdate, db: DbSession) -> ActivityOut:
    """Change some fields. `version` must match the server's, or you get 409 and should reload."""
    try:
        return ActivityOut.model_validate(itinerary.update_activity(db, activity_id, body))
    except itinerary.ActivityNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, GONE) from exc
    except itinerary.ActivityConflict as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, CONFLICT) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.delete("/activities/{activity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_activity(activity_id: int, db: DbSession, version: int = Query(ge=1)) -> None:
    try:
        itinerary.delete_activity(db, activity_id, version)
    except itinerary.ActivityNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, GONE) from exc
    except itinerary.ActivityConflict as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, CONFLICT) from exc
