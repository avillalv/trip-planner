from datetime import date

import httpx
from fastapi import APIRouter, HTTPException, status

from tripplanner import __version__
from tripplanner.api.deps import DbSession
from tripplanner.models import Trip
from tripplanner.schemas.weather import DayWeather
from tripplanner.services import weather

router = APIRouter(prefix="/api/v1/trips", tags=["weather"])


@router.get("/{trip_id}/weather", response_model=list[DayWeather])
def trip_weather(trip_id: int, db: DbSession) -> list[DayWeather]:
    """Weather for each trip day: the forecast for the next 15 days, typical weather (the last five
    years' average for that date) for the rest. Days with no destination or no data are left out, so
    an undated trip, or one whose weather can't be reached, gives an empty list."""
    trip = db.get(Trip, trip_id)
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found.")
    with httpx.Client(timeout=15, headers={"User-Agent": f"TripPlanner/{__version__}"}) as client:
        return weather.trip_weather(db, client, trip, date.today())
