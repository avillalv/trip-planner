"""Weather for each day of a trip: the forecast when it reaches that far, typical weather otherwise.

Typical weather is the average over the same calendar dates in each of the last five years, with a
window of a few days either side of each date, so a day's numbers come from about 35 samples.
Responses are cached (the forecast for hours, history for weeks). A destination Open-Meteo can't
answer for leaves its days out rather than failing the trip.
"""

import logging
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from itertools import groupby
from statistics import fmean
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from tripplanner.models import ApiCall, ItineraryDay, Trip, TripDestination
from tripplanner.providers import ProviderError
from tripplanner.providers import open_meteo as meteo
from tripplanner.schemas.weather import DayWeather
from tripplanner.services.itinerary import day_destination, trip_dates
from tripplanner.services.places import cache_get, cache_key, cache_put

FORECAST_TTL = timedelta(hours=3)
ARCHIVE_TTL = timedelta(days=30)
# The forecast reaches this many days past today.
FORECAST_REACH = 15
HISTORY_YEARS = 5
WINDOW_DAYS = 3
# Archive data trails the present by a few days.
ARCHIVE_LAG = timedelta(days=7)
# A day with at least this much rain or snow counts as wet (about 1 mm).
WET_DAY_IN = 0.04

log = logging.getLogger(__name__)


def _fetch(
    db: Session,
    client: httpx.Client,
    request: tuple[str, dict[str, Any]],
    endpoint: str,
    ttl: timedelta,
    now: datetime,
) -> dict[date, meteo.Daily]:
    """The days of one request, from the cache or Open-Meteo; empty when it can't be had."""
    url, params = request
    key = cache_key("open_meteo", url, params)
    data = cache_get(db, key, now)
    if data is None:
        try:
            data = meteo.fetch(client, url, params)
        except ProviderError as exc:
            log.warning("Weather lookup failed (%s, %s): %s", endpoint, params["start_date"], exc)
            return {}
        cache_put(db, key, "open_meteo", data, now, ttl)
        db.add(
            ApiCall(provider="open_meteo", endpoint=endpoint, units=1, cached=False, status_code=200, ok=True)
        )
        db.commit()
    return meteo.parse_daily(data)


def _in_year(day: date, year: int) -> date:
    """The same calendar date in another year (Feb 29 becomes Feb 28)."""
    try:
        return day.replace(year=year)
    except ValueError:
        return day.replace(year=year, day=28)


def _forecast(
    db: Session, client: httpx.Client, place: TripDestination, days: list[date], now: datetime
) -> list[DayWeather]:
    request = meteo.forecast_request(place.lat, place.lon, place.timezone, min(days), max(days))
    rows = _fetch(db, client, request, "forecast", FORECAST_TTL, now)
    result = []
    for day in days:
        row = rows.get(day)
        if row is None or row.high is None or row.low is None:
            continue
        result.append(
            DayWeather(
                day=day,
                destination_id=place.id,
                destination_name=place.name,
                kind="forecast",
                high_f=round(row.high),
                low_f=round(row.low),
                precip_in=round(row.precip or 0, 2),
                rain_chance=None if row.rain_chance is None else round(row.rain_chance),
            )
        )
    return result


def _history(
    db: Session, client: httpx.Client, place: TripDestination, days: list[date], today: date, now: datetime
) -> dict[date, meteo.Daily]:
    """Past days around each of `days` in each of the last five years: one request per year (and per
    calendar year the days fall in, so a trip over New Year's doesn't fetch a whole year between)."""
    latest = today - ARCHIVE_LAG
    window = timedelta(days=WINDOW_DAYS)
    history: dict[date, meteo.Daily] = {}
    for _, group in groupby(days, key=lambda d: d.year):
        span = list(group)
        for year in range(today.year - HISTORY_YEARS, today.year):
            start = _in_year(span[0], year) - window
            end = min(_in_year(span[-1], year) + window, latest)
            if start > end:
                continue
            request = meteo.archive_request(place.lat, place.lon, place.timezone, start, end)
            history.update(_fetch(db, client, request, "archive", ARCHIVE_TTL, now))
    return history


def _typical(
    db: Session,
    client: httpx.Client,
    place: TripDestination,
    days: list[date],
    today: date,
    now: datetime,
) -> list[DayWeather]:
    history = _history(db, client, place, days, today, now)
    result = []
    for day in days:
        samples = [
            row
            for year in range(today.year - HISTORY_YEARS, today.year)
            for offset in range(-WINDOW_DAYS, WINDOW_DAYS + 1)
            if (row := history.get(_in_year(day, year) + timedelta(days=offset))) is not None
            and None not in (row.high, row.low, row.precip)
        ]
        if not samples:
            continue
        result.append(
            DayWeather(
                day=day,
                destination_id=place.id,
                destination_name=place.name,
                kind="typical",
                high_f=round(fmean(s.high for s in samples)),
                low_f=round(fmean(s.low for s in samples)),
                precip_in=round(fmean(s.precip for s in samples), 2),
                wet_days_pct=round(100 * sum(s.precip >= WET_DAY_IN for s in samples) / len(samples)),
            )
        )
    return result


def trip_weather(
    db: Session, client: httpx.Client, trip: Trip, today: date, now: datetime | None = None
) -> list[DayWeather]:
    """Weather for every trip day with a destination, oldest first. Days it has no data for are left out."""
    now = now or datetime.now(UTC)
    overrides = {
        row.day: row for row in db.scalars(select(ItineraryDay).where(ItineraryDay.trip_id == trip.id))
    }
    places: dict[int, TripDestination] = {}
    days_by_place: dict[int, list[date]] = defaultdict(list)
    for day in trip_dates(trip):
        place = day_destination(trip, overrides.get(day))
        if place is not None:
            places[place.id] = place
            days_by_place[place.id].append(day)

    reach = today + timedelta(days=FORECAST_REACH)
    weather: list[DayWeather] = []
    for place_id, days in days_by_place.items():
        place = places[place_id]
        soon = [d for d in days if today <= d <= reach]
        later = [d for d in days if not today <= d <= reach]
        if soon:
            weather += _forecast(db, client, place, soon, now)
        if later:
            weather += _typical(db, client, place, later, today, now)
    return sorted(weather, key=lambda w: w.day)
