"""baseline: app settings, worker heartbeat, airports

Revision ID: 0001
Revises:
Create Date: 2026-09-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_app_settings")),
    )
    op.create_table(
        "worker_heartbeat",
        sa.Column("id", sa.SmallInteger(), nullable=False),
        sa.Column("pid", sa.Integer(), nullable=False),
        sa.Column("version", sa.String(length=40), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name=op.f("ck_worker_heartbeat_singleton")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_worker_heartbeat")),
    )
    op.create_table(
        "airports",
        sa.Column("iata", sa.String(length=3), nullable=False),
        sa.Column("icao", sa.String(length=4), nullable=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("city", sa.String(length=120), nullable=True),
        sa.Column("country_code", sa.String(length=2), nullable=False),
        sa.Column("region_code", sa.String(length=10), nullable=True),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lon", sa.Float(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.PrimaryKeyConstraint("iata", name=op.f("pk_airports")),
    )


def downgrade() -> None:
    op.drop_table("airports")
    op.drop_table("worker_heartbeat")
    op.drop_table("app_settings")
