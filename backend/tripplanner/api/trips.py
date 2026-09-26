from fastapi import APIRouter, BackgroundTasks, HTTPException, status

from tripplanner.api.deps import DbSession
from tripplanner.schemas.trips import TripIn, TripOut
from tripplanner.services import trips as service
from tripplanner.services.enrichment import enrich_destinations

router = APIRouter(prefix="/api/v1/trips", tags=["trips"])


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found.")


@router.get("", response_model=list[TripOut])
def list_trips(db: DbSession) -> list[TripOut]:
    return [service.to_out(t) for t in service.list_trips(db)]


@router.post("", response_model=TripOut, status_code=status.HTTP_201_CREATED)
def create_trip(body: TripIn, db: DbSession, background: BackgroundTasks) -> TripOut:
    try:
        trip, needs_info = service.create_trip(db, body)
    except service.InvalidReference as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    background.add_task(enrich_destinations, needs_info)
    return service.to_out(trip)


@router.get("/{trip_id}", response_model=TripOut)
def get_trip(trip_id: int, db: DbSession) -> TripOut:
    try:
        return service.to_out(service.get_trip(db, trip_id))
    except service.TripNotFound as exc:
        raise _not_found() from exc


@router.put("/{trip_id}", response_model=TripOut)
def update_trip(trip_id: int, body: TripIn, db: DbSession, background: BackgroundTasks) -> TripOut:
    try:
        trip, needs_info = service.update_trip(db, trip_id, body)
    except service.TripNotFound as exc:
        raise _not_found() from exc
    except service.InvalidReference as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    background.add_task(enrich_destinations, needs_info)
    return service.to_out(trip)


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trip(trip_id: int, db: DbSession) -> None:
    try:
        service.delete_trip(db, trip_id)
    except service.TripNotFound as exc:
        raise _not_found() from exc


@router.post("/{trip_id}/refresh-info", status_code=status.HTTP_202_ACCEPTED)
def refresh_destination_info(trip_id: int, db: DbSession, background: BackgroundTasks) -> None:
    """Fetch Wikipedia summaries and photos again for destinations that don't have them."""
    try:
        trip = service.get_trip(db, trip_id)
    except service.TripNotFound as exc:
        raise _not_found() from exc
    background.add_task(enrich_destinations, [d.id for d in trip.destinations if d.info_status != "ready"])
