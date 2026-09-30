from datetime import date, datetime
from decimal import Decimal
from itertools import pairwise
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, NaiveDatetime, computed_field, model_validator

from tripplanner.schemas.common import CurrencyCode, IataCode, text

Cabin = Literal["economy", "premium_economy", "business", "first"]
TripType = Literal["round_trip", "one_way"]
RouteSource = Literal["serpapi", "travelpayouts", "agent"]
MAX_WINDOW_DAYS = 60


class RouteIn(BaseModel):
    label: text(80) | None = None
    origin_codes: list[IataCode] = Field(min_length=1, max_length=4)
    destination_codes: list[IataCode] = Field(min_length=1, max_length=4)
    trip_type: TripType = "round_trip"
    depart_from: date
    depart_to: date
    return_from: date | None = None
    return_to: date | None = None
    min_nights: int | None = Field(None, ge=1, le=60)
    max_nights: int | None = Field(None, ge=1, le=60)
    adults: int = Field(1, ge=1, le=9)
    children: int = Field(0, ge=0, le=8)
    cabin: Cabin = "economy"
    max_stops: int | None = Field(None, ge=0, le=2)
    sources: list[RouteSource] = Field(default_factory=lambda: ["serpapi", "travelpayouts"])
    alert_price: Decimal | None = Field(None, gt=0, max_digits=12, decimal_places=2)
    active: bool = True

    @model_validator(mode="after")
    def check_rules(self) -> "RouteIn":
        self.origin_codes = list(dict.fromkeys(self.origin_codes))
        self.destination_codes = list(dict.fromkeys(self.destination_codes))
        self.sources = list(dict.fromkeys(self.sources))
        if set(self.origin_codes) & set(self.destination_codes):
            raise ValueError("An airport can't be both an origin and a destination.")
        if self.depart_to < self.depart_from:
            raise ValueError("The departure window must end on or after it starts.")
        if (self.depart_to - self.depart_from).days > MAX_WINDOW_DAYS:
            raise ValueError(f"Keep the departure window to {MAX_WINDOW_DAYS} days or less.")

        has_window = self.return_from is not None or self.return_to is not None
        has_nights = self.min_nights is not None or self.max_nights is not None
        if self.trip_type == "one_way":
            if has_window or has_nights:
                raise ValueError("One-way routes don't have a return window or trip length.")
            return self
        if has_window == has_nights:
            raise ValueError("Set either a return window or a trip length in nights.")
        if has_nights:
            if self.min_nights is None or self.max_nights is None:
                raise ValueError("Set both the minimum and maximum number of nights.")
            if self.max_nights < self.min_nights:
                raise ValueError("The maximum nights must be at least the minimum.")
        else:
            if self.return_from is None or self.return_to is None:
                raise ValueError("Set both ends of the return window.")
            if self.return_to < self.return_from:
                raise ValueError("The return window must end on or after it starts.")
            if self.return_to <= self.depart_from:
                raise ValueError("The return window must end after the earliest departure.")
            if (self.return_to - self.return_from).days > MAX_WINDOW_DAYS:
                raise ValueError(f"Keep the return window to {MAX_WINDOW_DAYS} days or less.")
        return self


class RouteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    trip_id: int
    label: str | None
    origin_codes: list[str]
    destination_codes: list[str]
    trip_type: TripType
    depart_from: date
    depart_to: date
    return_from: date | None
    return_to: date | None
    min_nights: int | None
    max_nights: int | None
    adults: int
    children: int
    cabin: Cabin
    max_stops: int | None
    sources: list[RouteSource]
    alert_price: Decimal | None
    active: bool
    # The flight picked for the trip (its dates are the trip's dates), if any.
    chosen_quote_id: int | None
    created_at: datetime
    updated_at: datetime


class Layover(BaseModel):
    airport: str
    minutes: int
    overnight: bool


class FlightSegment(BaseModel):
    """One flight of a booked itinerary. Times are local wall-clock times at each airport."""

    direction: Literal["out", "back"]
    flight_number: text(10, min_length=2)
    origin: IataCode
    destination: IataCode
    depart_at: NaiveDatetime
    arrive_at: NaiveDatetime


def _layovers(raw: dict[str, Any] | None) -> list[Layover]:
    """Layovers from a Google Flights itinerary (other sources have none)."""
    return [
        Layover(airport=item["id"], minutes=item["duration"], overnight=bool(item.get("overnight")))
        for item in (raw or {}).get("layovers") or []
        if item.get("id") and isinstance(item.get("duration"), int)
    ]


class QuoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    route_id: int
    source: str
    confidence: str
    origin: str
    destination: str
    depart_date: date
    return_date: date | None
    price_total: Decimal
    currency: str
    price_home: Decimal | None
    home_currency: str
    passengers: int
    airlines: list[str]
    stops_out: int | None
    stops_back: int | None
    duration_out_min: int | None
    duration_back_min: int | None
    depart_at_local: str | None
    flight_numbers: list[str] | None
    segments: list[FlightSegment] | None
    booking_url: str | None
    source_url: str | None
    observed_at: datetime
    suspect: bool
    hidden: bool
    # Only read to work out `layovers`; the source's whole itinerary isn't sent.
    raw: Any = Field(None, exclude=True)

    @computed_field
    @property
    def layovers(self) -> list[Layover]:
        return _layovers(self.raw)


class QuoteUpdate(BaseModel):
    hidden: bool | None = None
    suspect: bool | None = None


class HistoryPoint(BaseModel):
    day: date
    source: str
    price: Decimal


class GoogleHistoryPoint(BaseModel):
    at: datetime
    price: Decimal


class RouteHistory(BaseModel):
    currency: str
    points: list[HistoryPoint]
    google: list[GoogleHistoryPoint]
    typical_low: Decimal | None
    typical_high: Decimal | None
    price_level: str | None


class DateGridCell(BaseModel):
    # The fare behind the price, so a cell can be chosen as the trip's flight.
    quote_id: int
    depart_date: date
    return_date: date | None
    price: Decimal
    source: str
    observed_at: datetime


class RouteSummary(BaseModel):
    """Per-route status for the Flights page."""

    route_id: int
    cheapest: QuoteOut | None
    last_checked_at: datetime | None
    quote_count: int
    # The flight picked for the trip, as it was when chosen, and its latest price.
    chosen: QuoteOut | None = None
    chosen_latest: QuoteOut | None = None


class FlightChoiceIn(BaseModel):
    quote_id: int


class BookedFlightIn(BaseModel):
    """A flight the travelers already booked, entered leg by leg as printed on the ticket."""

    airline: text(60, min_length=1)
    price_per_person: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    currency: CurrencyCode
    passengers: int = Field(ge=1, le=17)
    segments: list[FlightSegment] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def check_legs(self) -> "BookedFlightIn":
        out = [s for s in self.segments if s.direction == "out"]
        back = [s for s in self.segments if s.direction == "back"]
        if not out:
            raise ValueError("Add at least one outbound flight.")
        for legs in (out, back):
            for earlier, later in pairwise(legs):
                if later.depart_at.date() < earlier.depart_at.date():
                    raise ValueError("List each direction's flights in the order you fly them.")
        if back and back[0].depart_at.date() < out[-1].depart_at.date():
            raise ValueError("The return must leave on or after the last outbound flight.")
        return self
