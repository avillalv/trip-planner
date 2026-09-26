from sqlalchemy import Identity, String
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from tripplanner.models.base import Base, TimestampMixin


class Person(TimestampMixin, Base):
    """Someone who travels on trips (you two, plus any guests). Reused across trips."""

    __tablename__ = "people"

    id: Mapped[int] = mapped_column(Identity(), primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    color: Mapped[str] = mapped_column(String(7))
    home_airports: Mapped[list[str]] = mapped_column(ARRAY(String(3)), server_default="{}")
