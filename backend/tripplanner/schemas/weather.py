from datetime import date
from typing import Literal

from pydantic import BaseModel


class DayWeather(BaseModel):
    """One trip day's weather at its destination, in °F and inches.

    `forecast` days are within the forecast's reach and carry `rain_chance`. All other days are
    `typical`: averages over the last five years, with `wet_days_pct` (the share of those days that
    had at least 0.04 in of rain or snow).
    """

    day: date
    destination_id: int
    destination_name: str
    kind: Literal["forecast", "typical"]
    high_f: int
    low_f: int
    precip_in: float
    rain_chance: int | None = None
    wet_days_pct: int | None = None
    # The destination is a whole country, so this is the weather at its middle, not where they'll be.
    whole_country: bool = False
