"""Everything the presentation deck shows, in one response so it opens at once."""

from datetime import date, datetime, time
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from tripplanner.schemas.flights import QuoteOut, RouteOut
from tripplanner.schemas.itinerary import ActivityCategory, ActivityStatus
from tripplanner.schemas.lodging import LodgingOut
from tripplanner.schemas.trips import DestinationOut, TripOut


class DeckDestination(DestinationOut):
    currency: str | None
    # How much local currency one unit of the trip's currency buys (None without rates).
    rate: Decimal | None


class TrendPoint(BaseModel):
    day: date
    price: Decimal


class DeckRoute(BaseModel):
    route: RouteOut
    # The cheapest current fares, not counting ones flagged as suspect.
    options: list[QuoteOut]
    # Cheapest price seen each day, in the trip's currency.
    trend: list[TrendPoint]
    typical_low: Decimal | None
    typical_high: Decimal | None
    price_level: str | None
    # The flight picked for the trip, at its latest price (not repeated in `options`).
    chosen: QuoteOut | None = None


class DeckActivity(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    start_time: time | None
    end_time: time | None
    title: str
    category: ActivityCategory
    status: ActivityStatus
    location_name: str | None
    lat: float | None
    lon: float | None
    notes: str


class DeckDay(BaseModel):
    day: date
    title: str
    notes: str
    destination_name: str | None
    timezone: str | None
    in_trip: bool
    activities: list[DeckActivity]


class Presentation(BaseModel):
    trip: TripOut
    destinations: list[DeckDestination]
    routes: list[DeckRoute]
    # The shortlist (booked, shortlisted, or starred), or every option still considered if there's none.
    lodging: list[LodgingOut]
    # Days with plans, a title, or notes.
    days: list[DeckDay]
    idea_count: int
    generated_at: datetime
