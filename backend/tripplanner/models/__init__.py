"""SQLAlchemy models. Import every model here so Alembic sees the full metadata."""

from tripplanner.models.airport import Airport
from tripplanner.models.base import Base
from tripplanner.models.people import Person
from tripplanner.models.system import AppSetting, WorkerHeartbeat
from tripplanner.models.trip import Trip, TripDestination, trip_travelers

__all__ = [
    "Airport",
    "AppSetting",
    "Base",
    "Person",
    "Trip",
    "TripDestination",
    "WorkerHeartbeat",
    "trip_travelers",
]
