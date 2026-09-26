from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

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
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from tripplanner.models.base import Base, TimestampMixin

ROUTINE_KINDS = ("flight_api", "flight_agent", "research_agent")
RUN_TRIGGERS = ("schedule", "manual", "catch_up")
RUN_STATUSES = (
    "queued",
    "running",
    "succeeded",
    "partial",
    "failed",
    "timed_out",
    "cancelled",
    "interrupted",
)
FINISHED_STATUSES = frozenset({"succeeded", "partial", "failed", "timed_out", "cancelled", "interrupted"})


class Routine(TimestampMixin, Base):
    """Recurring background work for a trip: API price checks or Claude agent research."""

    __tablename__ = "routines"
    __table_args__ = (CheckConstraint(f"kind IN {ROUTINE_KINDS}", name="valid_kind"),)

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(20))
    enabled: Mapped[bool] = mapped_column(Boolean, server_default="true")
    # Standard 5-field cron, evaluated in `timezone`.
    schedule_cron: Mapped[str] = mapped_column(String(100))
    timezone: Mapped[str] = mapped_column(String(64))
    # Run once at startup if a scheduled slot was missed while the app was off.
    catch_up: Mapped[bool] = mapped_column(Boolean, server_default="true")
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default="{}")
    last_slot_at: Mapped[datetime | None]


class Run(Base):
    """One execution of a routine (scheduled, manual, or catch-up)."""

    __tablename__ = "runs"
    __table_args__ = (
        CheckConstraint(f"kind IN {ROUTINE_KINDS}", name="valid_kind"),
        CheckConstraint(f"trigger IN {RUN_TRIGGERS}", name="valid_trigger"),
        CheckConstraint(f"status IN {RUN_STATUSES}", name="valid_status"),
        Index("ix_runs_status_queued_at", "status", "queued_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    routine_id: Mapped[int | None] = mapped_column(ForeignKey("routines.id", ondelete="SET NULL"), index=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    trigger: Mapped[str] = mapped_column(String(12))
    status: Mapped[str] = mapped_column(String(12), server_default="queued")
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default="{}")
    queued_at: Mapped[datetime] = mapped_column(server_default=func.now())
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]
    pid: Mapped[int | None]
    exit_code: Mapped[int | None]
    prompt: Mapped[str | None] = mapped_column(Text)
    argv_redacted: Mapped[list[str] | None] = mapped_column(JSONB)
    summary: Mapped[str | None] = mapped_column(Text)
    report: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    accepted_count: Mapped[int] = mapped_column(server_default="0")
    rejected_count: Mapped[int] = mapped_column(server_default="0")
    input_tokens: Mapped[int | None]
    output_tokens: Mapped[int | None]
    cost_usd_est: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    cancel_requested: Mapped[bool] = mapped_column(Boolean, server_default="false")
    log_path: Mapped[str | None] = mapped_column(Text)


class RunEvent(Base):
    """A line in a run's log: progress messages, tool calls, results, errors."""

    __tablename__ = "run_events"
    __table_args__ = (UniqueConstraint("run_id", "seq", name="uq_run_events_run_seq"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    run_id: Mapped[UUID] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    seq: Mapped[int]
    ts: Mapped[datetime] = mapped_column(server_default=func.now())
    # info | warning | error | tool_use | tool_result | text | result
    type: Mapped[str] = mapped_column(String(20))
    tool_name: Mapped[str | None] = mapped_column(String(80))
    summary: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class ApiCall(Base):
    """Metered calls to external APIs, used to stay inside free tiers."""

    __tablename__ = "api_calls"
    __table_args__ = (Index("ix_api_calls_provider_created", "provider", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    provider: Mapped[str] = mapped_column(String(20))
    endpoint: Mapped[str] = mapped_column(String(60))
    run_id: Mapped[UUID | None] = mapped_column(ForeignKey("runs.id", ondelete="SET NULL"))
    units: Mapped[int] = mapped_column(server_default="1")
    cached: Mapped[bool] = mapped_column(Boolean, server_default="false")
    status_code: Mapped[int | None]
    ok: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
