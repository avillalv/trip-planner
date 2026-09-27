from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Identity,
    Index,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from tripplanner.models.base import Base, TimestampMixin

CABINS = ("economy", "premium_economy", "business", "first")
TRIP_TYPES = ("round_trip", "one_way")
QUOTE_SOURCES = ("serpapi", "travelpayouts", "agent", "manual")
# live: seen in a real-time search; cached: a fare other travelers found recently;
# indicative: reported by an agent from a web page.
CONFIDENCES = ("live", "cached", "indicative")

Money = Numeric(12, 2)


class FlightRoute(TimestampMixin, Base):
    """Airports and flexible dates to watch. Round trips set either a return window or a nights range."""

    __tablename__ = "flight_routes"
    __table_args__ = (
        CheckConstraint(f"trip_type IN {TRIP_TYPES}", name="valid_trip_type"),
        CheckConstraint(f"cabin IN {CABINS}", name="valid_cabin"),
        CheckConstraint("depart_to >= depart_from", name="valid_depart_window"),
        CheckConstraint("adults BETWEEN 1 AND 9 AND children BETWEEN 0 AND 8", name="valid_passengers"),
        CheckConstraint("(return_from IS NULL) = (return_to IS NULL)", name="return_window_pair"),
        CheckConstraint("(min_nights IS NULL) = (max_nights IS NULL)", name="nights_pair"),
        CheckConstraint(
            "(trip_type = 'one_way' AND return_from IS NULL AND min_nights IS NULL) OR "
            "(trip_type = 'round_trip' AND (return_from IS NULL) <> (min_nights IS NULL))",
            name="return_rule",
        ),
    )

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    label: Mapped[str | None] = mapped_column(String(80))
    origin_codes: Mapped[list[str]] = mapped_column(ARRAY(String(3)))
    destination_codes: Mapped[list[str]] = mapped_column(ARRAY(String(3)))
    trip_type: Mapped[str] = mapped_column(String(12), server_default="round_trip")
    depart_from: Mapped[date]
    depart_to: Mapped[date]
    return_from: Mapped[date | None]
    return_to: Mapped[date | None]
    min_nights: Mapped[int | None]
    max_nights: Mapped[int | None]
    adults: Mapped[int] = mapped_column(server_default="1")
    children: Mapped[int] = mapped_column(server_default="0")
    cabin: Mapped[str] = mapped_column(String(16), server_default="economy")
    # None = any number of stops.
    max_stops: Mapped[int | None]
    sources: Mapped[list[str]] = mapped_column(ARRAY(String(20)), server_default="{serpapi,travelpayouts}")
    alert_price: Mapped[Decimal | None] = mapped_column(Money)
    active: Mapped[bool] = mapped_column(Boolean, server_default="true")
    # The flight picked for the trip: its departure and return become the trip's dates.
    # (Quotes point back at their route, so this foreign key is added after both tables.)
    chosen_quote_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("flight_quotes.id", ondelete="SET NULL", use_alter=True)
    )
    chosen_quote: Mapped["FlightQuote | None"] = relationship(foreign_keys=[chosen_quote_id], viewonly=True)


class FlightQuote(Base):
    """One observed price. Rows are never updated, so the table is the price history."""

    __tablename__ = "flight_quotes"
    __table_args__ = (
        CheckConstraint(f"source IN {QUOTE_SOURCES}", name="valid_source"),
        CheckConstraint(f"confidence IN {CONFIDENCES}", name="valid_confidence"),
        CheckConstraint("price_total > 0", name="positive_price"),
        Index("ix_flight_quotes_route_observed", "route_id", "observed_at"),
        Index("ix_flight_quotes_route_dates", "route_id", "depart_date", "return_date"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    route_id: Mapped[int] = mapped_column(ForeignKey("flight_routes.id", ondelete="CASCADE"))
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    run_id: Mapped[UUID | None] = mapped_column(ForeignKey("runs.id", ondelete="SET NULL"), index=True)
    source: Mapped[str] = mapped_column(String(20))
    confidence: Mapped[str] = mapped_column(String(12))
    origin: Mapped[str] = mapped_column(String(3))
    destination: Mapped[str] = mapped_column(String(3))
    depart_date: Mapped[date]
    return_date: Mapped[date | None]
    price_total: Mapped[Decimal] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(3))
    price_home: Mapped[Decimal | None] = mapped_column(Money)
    home_currency: Mapped[str] = mapped_column(String(3))
    passengers: Mapped[int]
    airlines: Mapped[list[str]] = mapped_column(ARRAY(String(60)), server_default="{}")
    stops_out: Mapped[int | None]
    stops_back: Mapped[int | None]
    duration_out_min: Mapped[int | None]
    duration_back_min: Mapped[int | None]
    # Local departure time as shown by the source, e.g. "2026-11-05 11:30".
    depart_at_local: Mapped[str | None] = mapped_column(String(25))
    flight_numbers: Mapped[list[str] | None] = mapped_column(JSONB)
    booking_url: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(Text)
    source_domain: Mapped[str | None] = mapped_column(String(120))
    observed_at: Mapped[datetime]
    suspect: Mapped[bool] = mapped_column(Boolean, server_default="false")
    hidden: Mapped[bool] = mapped_column(Boolean, server_default="false")
    dedupe_key: Mapped[str] = mapped_column(String(64), index=True)
    raw: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class RoutePriceInsight(Base):
    """Google Flights' own view of a date pair: price level, typical range, and price history."""

    __tablename__ = "route_price_insights"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    route_id: Mapped[int] = mapped_column(ForeignKey("flight_routes.id", ondelete="CASCADE"), index=True)
    run_id: Mapped[UUID | None] = mapped_column(ForeignKey("runs.id", ondelete="SET NULL"))
    depart_date: Mapped[date]
    return_date: Mapped[date | None]
    observed_at: Mapped[datetime]
    currency: Mapped[str] = mapped_column(String(3))
    lowest_price: Mapped[Decimal | None] = mapped_column(Money)
    price_level: Mapped[str | None] = mapped_column(String(12))
    typical_low: Mapped[Decimal | None] = mapped_column(Money)
    typical_high: Mapped[Decimal | None] = mapped_column(Money)
    # [[unix_seconds, price], ...]
    history: Mapped[list[list[float]]] = mapped_column(JSONB, server_default="[]")


class FxRate(Base):
    """Latest reference rate per currency, as units per 1 EUR (ECB via Frankfurter)."""

    __tablename__ = "fx_rates"

    currency: Mapped[str] = mapped_column(String(3), primary_key=True)
    per_eur: Mapped[Decimal] = mapped_column(Numeric(20, 8))
    rate_date: Mapped[date]
    fetched_at: Mapped[datetime]
