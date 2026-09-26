from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from tripplanner.models.base import Base


class Airport(Base):
    """Airports with scheduled service, seeded from OurAirports (public domain).

    Used for route autocomplete and to validate airport codes that agents submit.
    """

    __tablename__ = "airports"

    iata: Mapped[str] = mapped_column(String(3), primary_key=True)
    icao: Mapped[str | None] = mapped_column(String(4))
    name: Mapped[str] = mapped_column(String(200))
    city: Mapped[str | None] = mapped_column(String(120))
    country_code: Mapped[str] = mapped_column(String(2))
    region_code: Mapped[str | None] = mapped_column(String(10))
    lat: Mapped[float]
    lon: Mapped[float]
    # large_airport | medium_airport | small_airport
    kind: Mapped[str] = mapped_column(String(20))
