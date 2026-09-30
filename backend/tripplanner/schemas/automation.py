from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from tripplanner.schemas.agent import NoteOut, RejectionOut
from tripplanner.schemas.common import text
from tripplanner.schemas.flights import QuoteOut
from tripplanner.schemas.suggestions import SuggestionOut

RunStatus = Literal[
    "queued", "running", "succeeded", "partial", "failed", "timed_out", "cancelled", "interrupted"
]
RoutineKind = Literal["flight_api", "flight_agent", "research_agent"]
AgentKind = Literal["flight_agent", "research_agent"]
# Every kind of run; the last two are one-shot runs a traveler starts from a page, never routines.
RunKind = Literal["flight_api", "flight_agent", "research_agent", "itinerary_agent", "lodging_agent"]


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    routine_id: int | None
    trip_id: int
    kind: RunKind
    trigger: Literal["schedule", "manual", "catch_up"]
    status: RunStatus
    params: dict[str, Any]
    queued_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    summary: str | None
    error: str | None
    accepted_count: int
    rejected_count: int
    input_tokens: int | None
    output_tokens: int | None
    cost_usd_est: Decimal | None
    cancel_requested: bool


class RunDetailOut(RunOut):
    """A run with what it was asked to do and how it was started."""

    prompt: str | None
    argv_redacted: list[str] | None
    exit_code: int | None
    report: dict[str, Any] | None
    log_path: str | None


class RunEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    seq: int
    ts: datetime
    type: str
    tool_name: str | None
    summary: str
    payload: dict[str, Any] | None


class RunOutputs(BaseModel):
    """Everything a run saved or had rejected."""

    quotes: list[QuoteOut]
    notes: list[NoteOut]
    suggestions: list[SuggestionOut]
    rejections: list[RejectionOut]


class RoutineConfig(BaseModel):
    """Options for agent routines. Price-check (API) routines use none of them."""

    # Routes a flight agent searches; empty means every active route on the trip.
    route_ids: list[int] = Field(default_factory=list, max_length=20)
    # What a research agent looks into.
    topic: text(300) | None = None
    # Extra guidance from the travelers, added to the prompt.
    instructions: text(2000) | None = None
    max_turns: int | None = Field(None, ge=5, le=100)
    timeout_min: int | None = Field(None, ge=5, le=60)


class RoutineOut(BaseModel):
    id: int
    trip_id: int
    name: str
    kind: RoutineKind
    enabled: bool
    schedule_cron: str
    timezone: str
    catch_up: bool
    config: RoutineConfig
    next_run_at: datetime | None
    last_run: RunOut | None


class RoutineCreate(BaseModel):
    trip_id: int
    name: text(80, min_length=1)
    kind: AgentKind
    schedule_cron: text(100, min_length=9)
    enabled: bool = True
    catch_up: bool = True
    config: RoutineConfig = Field(default_factory=RoutineConfig)


class RoutineUpdate(BaseModel):
    name: text(80, min_length=1) | None = None
    enabled: bool | None = None
    schedule_cron: text(100, min_length=9) | None = None
    catch_up: bool | None = None
    config: RoutineConfig | None = None


class RefreshRequest(BaseModel):
    route_ids: list[int] = Field(default_factory=list, max_length=20)
