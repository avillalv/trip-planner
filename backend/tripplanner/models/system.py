from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, SmallInteger, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from tripplanner.models.base import Base


class AppSetting(Base):
    """User preferences that can change at runtime (home currency, default airports, ...)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[Any] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class WorkerHeartbeat(Base):
    """Single row the background worker refreshes so the UI can show scheduler health."""

    __tablename__ = "worker_heartbeat"
    __table_args__ = (CheckConstraint("id = 1", name="singleton"),)

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    pid: Mapped[int]
    version: Mapped[str] = mapped_column(String(40))
    started_at: Mapped[datetime]
    last_seen: Mapped[datetime]
