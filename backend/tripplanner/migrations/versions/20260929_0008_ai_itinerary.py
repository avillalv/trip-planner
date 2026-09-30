"""AI itinerary: trip interests, booked-flight legs, activity suggestions, and one-shot AI run kinds

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-29 22:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_RUN_KINDS = "kind IN ('flight_api', 'flight_agent', 'research_agent')"
NEW_RUN_KINDS = "kind IN ('flight_api', 'flight_agent', 'research_agent', 'itinerary_agent', 'lodging_agent')"


def upgrade() -> None:
    op.add_column(
        "trips", sa.Column("interests", postgresql.ARRAY(sa.Text()), server_default="{}", nullable=False)
    )
    op.add_column(
        "flight_quotes", sa.Column("segments", postgresql.JSONB(astext_type=sa.Text()), nullable=True)
    )
    op.add_column("activities", sa.Column("flight_quote_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        op.f("fk_activities_flight_quote_id_flight_quotes"),
        "activities",
        "flight_quotes",
        ["flight_quote_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(op.f("ix_activities_flight_quote_id"), "activities", ["flight_quote_id"], unique=False)

    op.create_table(
        "activity_suggestions",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("trip_id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=True),
        sa.Column("mode", sa.String(length=12), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("category", sa.String(length=20), nullable=False),
        sa.Column("description", sa.Text(), server_default="", nullable=False),
        sa.Column("why", sa.Text(), server_default="", nullable=False),
        sa.Column("timing_note", sa.Text(), server_default="", nullable=False),
        sa.Column("day", sa.Date(), nullable=True),
        sa.Column("start_time", sa.Time(), nullable=True),
        sa.Column("duration_min", sa.Integer(), nullable=True),
        sa.Column("location_name", sa.String(length=200), nullable=True),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("sources", postgresql.ARRAY(sa.Text()), server_default="{}", nullable=False),
        sa.Column("status", sa.String(length=12), server_default="new", nullable=False),
        sa.Column("activity_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "mode IN ('brainstorm', 'surprise')", name=op.f("ck_activity_suggestions_valid_mode")
        ),
        sa.CheckConstraint(
            "status IN ('new', 'added', 'dismissed')", name=op.f("ck_activity_suggestions_valid_status")
        ),
        sa.CheckConstraint(
            "category IN ('sights', 'museum', 'food', 'nature', 'nightlife', 'shopping', 'travel', 'other')",
            name=op.f("ck_activity_suggestions_valid_category"),
        ),
        sa.CheckConstraint(
            "day IS NOT NULL OR start_time IS NULL", name=op.f("ck_activity_suggestions_time_needs_day")
        ),
        sa.ForeignKeyConstraint(
            ["trip_id"], ["trips.id"], name=op.f("fk_activity_suggestions_trip_id_trips"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["run_id"], ["runs.id"], name=op.f("fk_activity_suggestions_run_id_runs"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["activity_id"],
            ["activities.id"],
            name=op.f("fk_activity_suggestions_activity_id_activities"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_activity_suggestions")),
    )
    op.create_index(op.f("ix_activity_suggestions_run_id"), "activity_suggestions", ["run_id"], unique=False)
    op.create_index(
        "ix_activity_suggestions_trip_status", "activity_suggestions", ["trip_id", "status"], unique=False
    )

    op.drop_constraint(op.f("ck_runs_valid_kind"), "runs", type_="check")
    op.create_check_constraint(op.f("ck_runs_valid_kind"), "runs", NEW_RUN_KINDS)


def downgrade() -> None:
    op.execute("DELETE FROM runs WHERE kind IN ('itinerary_agent', 'lodging_agent')")
    op.drop_constraint(op.f("ck_runs_valid_kind"), "runs", type_="check")
    op.create_check_constraint(op.f("ck_runs_valid_kind"), "runs", OLD_RUN_KINDS)

    op.drop_index("ix_activity_suggestions_trip_status", table_name="activity_suggestions")
    op.drop_index(op.f("ix_activity_suggestions_run_id"), table_name="activity_suggestions")
    op.drop_table("activity_suggestions")

    op.drop_index(op.f("ix_activities_flight_quote_id"), table_name="activities")
    op.drop_constraint(op.f("fk_activities_flight_quote_id_flight_quotes"), "activities", type_="foreignkey")
    op.drop_column("activities", "flight_quote_id")
    op.drop_column("flight_quotes", "segments")
    op.drop_column("trips", "interests")
