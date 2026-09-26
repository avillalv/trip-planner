from datetime import date, datetime

from sqlalchemy import CheckConstraint, Column, Float, ForeignKey, Identity, String, Table, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tripplanner.models.base import Base, TimestampMixin
from tripplanner.models.people import Person

TRIP_STATUSES = ("planning", "booked", "done", "archived")
# pending: not fetched yet; skipped: no Wikimedia contact configured
INFO_STATUSES = ("pending", "ready", "not_found", "failed", "skipped")

trip_travelers = Table(
    "trip_travelers",
    Base.metadata,
    Column("trip_id", ForeignKey("trips.id", ondelete="CASCADE"), primary_key=True),
    Column("person_id", ForeignKey("people.id", ondelete="CASCADE"), primary_key=True),
)


class Trip(TimestampMixin, Base):
    __tablename__ = "trips"
    __table_args__ = (
        CheckConstraint(
            "(start_date IS NULL) = (end_date IS NULL) AND (end_date IS NULL OR end_date >= start_date)",
            name="valid_dates",
        ),
        CheckConstraint(f"status IN {TRIP_STATUSES}", name="valid_status"),
    )

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    # Dates are optional: a trip can be an idea before it has dates.
    start_date: Mapped[date | None]
    end_date: Mapped[date | None]
    status: Mapped[str] = mapped_column(String(12), server_default="planning")
    home_currency: Mapped[str] = mapped_column(String(3))
    notes: Mapped[str] = mapped_column(Text, server_default="")

    destinations: Mapped[list["TripDestination"]] = relationship(
        back_populates="trip", order_by="TripDestination.position", cascade="all, delete-orphan"
    )
    travelers: Mapped[list[Person]] = relationship(secondary=trip_travelers, order_by=Person.id)


class TripDestination(Base):
    """A place the trip visits, located via Geoapify and described via Wikipedia."""

    __tablename__ = "trip_destinations"
    __table_args__ = (CheckConstraint(f"info_status IN {INFO_STATUSES}", name="valid_info_status"),)

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    position: Mapped[int]
    name: Mapped[str] = mapped_column(String(120))
    region: Mapped[str | None] = mapped_column(String(120))
    country: Mapped[str | None] = mapped_column(String(120))
    country_code: Mapped[str | None] = mapped_column(String(2))
    kind: Mapped[str | None] = mapped_column(String(20))
    lat: Mapped[float]
    lon: Mapped[float]
    timezone: Mapped[str | None] = mapped_column(String(64))
    # [west, south, east, north]
    bbox: Mapped[list[float] | None] = mapped_column(ARRAY(Float))
    geoapify_place_id: Mapped[str | None] = mapped_column(Text)

    summary: Mapped[str | None] = mapped_column(Text)
    wiki_url: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)
    image_file: Mapped[str | None] = mapped_column(Text)
    info_status: Mapped[str] = mapped_column(String(12), server_default="pending")
    info_updated_at: Mapped[datetime | None]

    trip: Mapped[Trip] = relationship(back_populates="destinations")
