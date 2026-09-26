from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Identity,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from tripplanner.models.base import Base, TimestampMixin

LODGING_STATUSES = ("candidate", "shortlisted", "booked", "rejected")
LODGING_SOURCES = ("bookmarklet", "paste", "serpapi", "agent", "manual")

Money = Numeric(12, 2)


class LodgingOption(TimestampMixin, Base):
    """A place to stay you're considering: from a pasted link, the bookmarklet, or a rental search."""

    __tablename__ = "lodging_options"
    __table_args__ = (
        CheckConstraint(f"status IN {LODGING_STATUSES}", name="valid_status"),
        CheckConstraint(f"added_via IN {LODGING_SOURCES}", name="valid_source"),
        CheckConstraint("check_out IS NULL OR check_in IS NULL OR check_out > check_in", name="valid_dates"),
        CheckConstraint("(lat IS NULL) = (lon IS NULL)", name="lat_lon_pair"),
        # The same listing is saved once per trip (links are compared without their query string).
        UniqueConstraint("trip_id", "url_normalized", name="uq_lodging_options_trip_url"),
    )

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    url: Mapped[str | None] = mapped_column(Text)
    url_normalized: Mapped[str | None] = mapped_column(Text)
    site: Mapped[str | None] = mapped_column(String(60))
    check_in: Mapped[date | None]
    check_out: Mapped[date | None]
    guests: Mapped[int | None]
    price_total: Mapped[Decimal | None] = mapped_column(Money)
    price_per_night: Mapped[Decimal | None] = mapped_column(Money)
    currency: Mapped[str | None] = mapped_column(String(3))
    price_home_total: Mapped[Decimal | None] = mapped_column(Money)
    photos: Mapped[list[str]] = mapped_column(JSONB, server_default="[]")
    location_name: Mapped[str | None] = mapped_column(String(300))
    lat: Mapped[float | None]
    lon: Mapped[float | None]
    bedrooms: Mapped[int | None]
    beds: Mapped[int | None]
    baths: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    rating: Mapped[Decimal | None] = mapped_column(Numeric(3, 2))
    review_count: Mapped[int | None]
    notes: Mapped[str] = mapped_column(Text, server_default="")
    pros: Mapped[str] = mapped_column(Text, server_default="")
    cons: Mapped[str] = mapped_column(Text, server_default="")
    status: Mapped[str] = mapped_column(String(12), server_default="candidate")
    favorite: Mapped[bool] = mapped_column(Boolean, server_default="false")
    added_via: Mapped[str] = mapped_column(String(12))
    run_id: Mapped[UUID | None] = mapped_column(ForeignKey("runs.id", ondelete="SET NULL"))
    raw: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class LodgingVote(Base):
    """One traveler's heart on a lodging option."""

    __tablename__ = "lodging_votes"

    lodging_id: Mapped[int] = mapped_column(
        ForeignKey("lodging_options.id", ondelete="CASCADE"), primary_key=True
    )
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
