"""Daily weather from Open-Meteo (free, no key; data is CC BY 4.0, so the UI shows attribution).

The forecast API reaches 15 days ahead; the archive API holds past days (reanalysis, a few days
behind). Both give the day's high and low temperature and total precipitation.
"""

from dataclasses import dataclass
from datetime import date
from typing import Any

import httpx

from tripplanner.providers import ProviderError

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

_DAILY = "temperature_2m_max,temperature_2m_min,precipitation_sum"


@dataclass(frozen=True)
class Daily:
    """One day, in °F and inches. Any value can be missing."""

    high: float | None
    low: float | None
    precip: float | None
    # Forecast only: the chance of rain, as a percent.
    rain_chance: float | None = None


def _request(
    url: str, daily: str, lat: float, lon: float, timezone: str | None, start: date, end: date
) -> tuple[str, dict[str, Any]]:
    params = {
        # About 1 km: finer than the weather models, and small moves share cached answers.
        "latitude": round(lat, 2),
        "longitude": round(lon, 2),
        "daily": daily,
        "temperature_unit": "fahrenheit",
        "precipitation_unit": "inch",
        "timezone": timezone or "auto",
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
    }
    return url, params


def forecast_request(
    lat: float, lon: float, timezone: str | None, start: date, end: date
) -> tuple[str, dict[str, Any]]:
    return _request(FORECAST_URL, f"{_DAILY},precipitation_probability_max", lat, lon, timezone, start, end)


def archive_request(
    lat: float, lon: float, timezone: str | None, start: date, end: date
) -> tuple[str, dict[str, Any]]:
    return _request(ARCHIVE_URL, _DAILY, lat, lon, timezone, start, end)


def fetch(client: httpx.Client, url: str, params: dict[str, Any]) -> dict[str, Any]:
    try:
        response = client.get(url, params=params)
    except httpx.HTTPError as exc:
        raise ProviderError("Couldn't reach Open-Meteo. Check your internet connection.") from exc
    if response.status_code == 429:
        raise ProviderError("Open-Meteo's free limit was reached. Weather works again later.")
    if response.status_code != 200:
        raise ProviderError(f"Open-Meteo returned an error ({response.status_code}). Try again in a moment.")
    try:
        data = response.json()
    except ValueError as exc:
        raise ProviderError("Open-Meteo sent a response that couldn't be read.") from exc
    if not isinstance(data, dict):
        raise ProviderError("Open-Meteo sent a response that couldn't be read.")
    return data


def _number(values: Any, index: int) -> float | None:
    value = values[index] if isinstance(values, list) and index < len(values) else None
    return float(value) if isinstance(value, int | float) else None


def parse_daily(data: dict[str, Any]) -> dict[date, Daily]:
    """The response's days by date. Days with a date we can't read are skipped."""
    daily = data.get("daily") or {}
    days: dict[date, Daily] = {}
    for i, stamp in enumerate(daily.get("time") or []):
        try:
            day = date.fromisoformat(stamp)
        except (TypeError, ValueError):
            continue
        days[day] = Daily(
            high=_number(daily.get("temperature_2m_max"), i),
            low=_number(daily.get("temperature_2m_min"), i),
            precip=_number(daily.get("precipitation_sum"), i),
            rain_chance=_number(daily.get("precipitation_probability_max"), i),
        )
    return days
