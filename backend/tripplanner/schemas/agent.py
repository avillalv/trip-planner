"""Shapes of the agent ingest API. The MCP bridge reuses these, so agents see the same schema."""

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from tripplanner.schemas.common import CurrencyCode, IataCode, text


class AgentQuoteIn(BaseModel):
    """One fare the agent saw on a web page during this run."""

    model_config = ConfigDict(extra="forbid")

    route_id: int = Field(description="The route's id from get_task.")
    origin: IataCode = Field(description="Departure airport code; one of the route's origins.")
    destination: IataCode = Field(description="Arrival airport code; one of the route's destinations.")
    depart_date: date
    return_date: date | None = Field(None, description="Required for round trips; leave out for one way.")
    price_total: Decimal = Field(
        gt=0, max_digits=12, decimal_places=2, description="The price exactly as the page showed it."
    )
    currency: CurrencyCode = Field(description="ISO code of the currency shown, e.g. USD, EUR, JPY.")
    passengers: int = Field(
        ge=1, le=17, description="Travelers price_total covers: the route's party size, or 1 if per person."
    )
    airlines: list[text(60, min_length=1)] = Field(default_factory=list, max_length=6)
    stops_outbound: int | None = Field(None, ge=0, le=4)
    stops_return: int | None = Field(None, ge=0, le=4)
    duration_outbound_min: int | None = Field(None, ge=30, le=4000)
    source_url: str = Field(max_length=2000, description="The exact page that showed this price.")
    seen_on: text(80) | None = Field(None, description="The site's name, e.g. Kayak or united.com.")
    observed_at: datetime | None = Field(None, description="When you saw it; defaults to now.")
    notes: text(300) | None = None


class QuoteBatchIn(BaseModel):
    # Items are validated one by one, so one bad fare doesn't reject the whole batch.
    quotes: list[dict[str, Any]] = Field(min_length=1, max_length=50)


class FieldError(BaseModel):
    field: str
    msg: str


class AcceptedItem(BaseModel):
    index: int
    id: int
    flags: list[str]


class RejectedItem(BaseModel):
    index: int
    errors: list[FieldError]


class QuoteBatchResult(BaseModel):
    accepted: list[AcceptedItem]
    rejected: list[RejectedItem]
    duplicates: list[int]


class NoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: text(160, min_length=1)
    body: text(4000, min_length=1)
    urls: list[str] = Field(default_factory=list, max_length=10)


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    trip_id: int
    run_id: UUID | None
    title: str
    body: str
    urls: list[str]
    created_at: datetime


class FinishIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "partial", "failed"]
    summary: text(2000, min_length=1)
    sources_checked: list[text(300)] = Field(default_factory=list, max_length=40)
    issues: list[text(500)] = Field(default_factory=list, max_length=20)


class AgentAck(BaseModel):
    ok: bool
    message: str


class ContextRoute(BaseModel):
    id: int
    label: str | None
    origins: list[str]
    destinations: list[str]
    trip_type: str
    depart_from: date
    depart_to: date
    nights: list[int] | None
    return_window: list[date] | None
    passengers: int
    adults: int
    children: int
    cabin: str
    max_stops: int | None
    cheapest_known: dict[str, Any] | None


class RunContext(BaseModel):
    run_id: str
    kind: str
    today: date
    trip: dict[str, Any]
    routes: list[ContextRoute]
    topic: str | None
    instructions: str | None
    rules: list[str]
    blocked_domains: list[str]


class RejectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    entity: str
    item: dict[str, Any]
    errors: list[FieldError]
    created_at: datetime
