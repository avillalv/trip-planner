from datetime import date, datetime, time
from typing import Any, ClassVar

from sqlalchemy import CheckConstraint, ForeignKey, Identity, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from tripplanner.models.base import Base, TimestampMixin

ACTIVITY_STATUSES = ("idea", "planned", "booked")
# Groups that set an activity's color and icon in the day view; places are sorted into them.
ACTIVITY_CATEGORIES = ("sights", "museum", "food", "nature", "nightlife", "shopping", "travel", "other")


class ItineraryDay(Base):
    """A day's title, notes, and which destination it's in.

    The days themselves come from the trip's dates; a row exists only once something is set.
    """

    __tablename__ = "itinerary_days"

    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120), server_default="")
    notes: Mapped[str] = mapped_column(Text, server_default="")
    destination_id: Mapped[int | None] = mapped_column(
        ForeignKey("trip_destinations.id", ondelete="SET NULL")
    )
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class Activity(TimestampMixin, Base):
    """Something to do: an idea (no day yet), or planned for a day, at set times or any time.

    Times are wall-clock times at the destination. An end time at or before the start time means
    the activity runs past midnight.
    """

    __tablename__ = "activities"
    __table_args__ = (
        CheckConstraint(f"status IN {ACTIVITY_STATUSES}", name="valid_status"),
        CheckConstraint(f"category IN {ACTIVITY_CATEGORIES}", name="valid_category"),
        CheckConstraint("day IS NOT NULL OR start_time IS NULL", name="times_need_day"),
        CheckConstraint("start_time IS NOT NULL OR end_time IS NULL", name="end_needs_start"),
        CheckConstraint("(lat IS NULL) = (lon IS NULL)", name="lat_lon_pair"),
        Index("ix_activities_trip_day", "trip_id", "day"),
    )

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"))
    day: Mapped[date | None]
    start_time: Mapped[time | None]
    end_time: Mapped[time | None]
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(20), server_default="other")
    status: Mapped[str] = mapped_column(String(12), server_default="idea")
    location_name: Mapped[str | None] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(Text)
    lat: Mapped[float | None]
    lon: Mapped[float | None]
    url: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str] = mapped_column(Text, server_default="")
    # Where it came from, when added from a places search (kept so details show without a new lookup).
    place_provider: Mapped[str | None] = mapped_column(String(20))
    place_id: Mapped[str | None] = mapped_column(Text)
    place_data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # Bumped on every change; an edit based on an older version is refused (another device won).
    version: Mapped[int] = mapped_column(server_default="1")

    __mapper_args__: ClassVar[dict[str, Any]] = {"version_id_col": version}


class PlaceCacheEntry(Base):
    """A stored places-provider response. Geoapify allows keeping results, and each lookup costs credits."""

    __tablename__ = "places_cache"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    provider: Mapped[str] = mapped_column(String(20))
    response: Mapped[Any] = mapped_column(JSONB)
    fetched_at: Mapped[datetime]
    expires_at: Mapped[datetime] = mapped_column(index=True)
