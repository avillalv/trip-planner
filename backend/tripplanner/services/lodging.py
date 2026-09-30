"""The lodging shortlist: saving options from links, the bookmarklet, or rental searches, and hearts."""

from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from tripplanner import __version__
from tripplanner.models import ApiCall, LodgingOption, LodgingVote, Trip
from tripplanner.providers import link_preview, serpapi_rentals
from tripplanner.schemas.lodging import (
    LinkPreview,
    LodgingIn,
    LodgingOut,
    LodgingUpdate,
    RentalOffer,
    RentalSearchIn,
    RentalSearchResult,
)
from tripplanner.services import fx, serpapi_budget
from tripplanner.services.places import cache_get, cache_key, cache_put

RENTALS_TTL = timedelta(hours=12)
CENT = Decimal("0.01")


class LodgingNotFound(LookupError):
    pass


class DuplicateLodging(Exception):
    """The same listing is already on this trip's shortlist."""


class OutOfSearches(Exception):
    pass


def nights(option: LodgingOption) -> int | None:
    if option.check_in and option.check_out:
        return (option.check_out - option.check_in).days
    return None


def ensure_rates(db: Session, currency: str | None, home_currency: str) -> None:
    """Fetch exchange rates if a foreign price needs them (free, and at most every 12 hours)."""
    if not currency or currency.upper() == home_currency:
        return
    with httpx.Client(timeout=8, headers={"User-Agent": f"TripPlanner/{__version__}"}) as client:
        fx.refresh_rates(db, client)


def _fill_prices(db: Session, option: LodgingOption, home_currency: str) -> None:
    """Derive total or per-night from the other when dates are known, and convert the total."""
    # Stored to the cent; round now so the saved option reads back the same.
    for field in ("price_total", "price_per_night"):
        if (value := getattr(option, field)) is not None:
            setattr(option, field, Decimal(value).quantize(CENT, ROUND_HALF_UP))
    count = nights(option)
    if count:
        if option.price_total is None and option.price_per_night is not None:
            option.price_total = (option.price_per_night * count).quantize(CENT, ROUND_HALF_UP)
        elif option.price_per_night is None and option.price_total is not None:
            option.price_per_night = (option.price_total / count).quantize(CENT, ROUND_HALF_UP)
    option.price_home_total = (
        fx.convert(db, option.price_total, option.currency, home_currency)
        if option.price_total is not None and option.currency
        else None
    )


def to_out(db: Session, option: LodgingOption, trip: Trip | None = None) -> LodgingOut:
    trip = trip or db.get(Trip, option.trip_id)
    assert trip is not None
    hearts = db.scalars(select(LodgingVote.person_id).where(LodgingVote.lodging_id == option.id))
    return LodgingOut.model_validate(
        {
            **{c.key: getattr(option, c.key) for c in LodgingOption.__table__.columns},
            "nights": nights(option),
            "home_currency": trip.home_currency,
            "hearts": sorted(hearts),
        }
    )


def list_options(db: Session, trip: Trip) -> list[LodgingOut]:
    options = db.scalars(
        select(LodgingOption).where(LodgingOption.trip_id == trip.id).order_by(LodgingOption.created_at)
    )
    return [to_out(db, o, trip) for o in options]


def get_option(db: Session, option_id: int) -> LodgingOption:
    option = db.get(LodgingOption, option_id)
    if option is None:
        raise LodgingNotFound(option_id)
    return option


def create_option(db: Session, trip: Trip, body: LodgingIn, run_id: UUID | None = None) -> LodgingOption:
    """Save an option; `run_id` marks one an agent run picked."""
    ensure_rates(db, body.currency, trip.home_currency)
    option = LodgingOption(trip_id=trip.id, run_id=run_id, **body.model_dump())
    if body.url:
        option.url_normalized = link_preview.normalize_url(body.url)
        option.site = link_preview.site_name(body.url)
    _fill_prices(db, option, trip.home_currency)
    db.add(option)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise DuplicateLodging(body.url) from exc
    return option


def update_option(db: Session, option: LodgingOption, body: LodgingUpdate) -> LodgingOption:
    changes = body.model_dump(exclude_unset=True)
    trip = db.get(Trip, option.trip_id)
    assert trip is not None
    # Only a new price, or one never converted, is worth waiting on the rates service for.
    if changes.keys() & {"price_total", "price_per_night", "currency"} or option.price_home_total is None:
        ensure_rates(db, changes.get("currency", option.currency), trip.home_currency)
    for field in ("title", "status", "favorite", "notes", "pros", "cons", "photos"):
        if field in changes and changes[field] is None:
            raise ValueError(f"{field.capitalize()} can't be empty.")
    # A new total or nightly price replaces the one derived from it.
    if "price_total" in changes and "price_per_night" not in changes:
        option.price_per_night = None
    if "price_per_night" in changes and "price_total" not in changes:
        option.price_total = None
    for field, value in changes.items():
        setattr(option, field, value)
    if "url" in changes:
        option.url_normalized = link_preview.normalize_url(option.url) if option.url else None
        option.site = link_preview.site_name(option.url) if option.url else None
    if option.check_in and option.check_out and option.check_out <= option.check_in:
        raise ValueError("Check-out must be after check-in.")
    if (option.lat is None) != (option.lon is None):
        raise ValueError("Give both latitude and longitude, or neither.")
    if (option.price_total or option.price_per_night) and not option.currency:
        raise ValueError("Say which currency the price is in.")
    _fill_prices(db, option, trip.home_currency)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise DuplicateLodging(option.url) from exc
    return option


def set_heart(db: Session, option: LodgingOption, person_id: int, hearted: bool) -> None:
    if hearted:
        stmt = insert(LodgingVote).values(lodging_id=option.id, person_id=person_id)
        db.execute(stmt.on_conflict_do_nothing())
    else:
        db.execute(
            delete(LodgingVote).where(LodgingVote.lodging_id == option.id, LodgingVote.person_id == person_id)
        )
    db.commit()


def preview_link(client: httpx.Client, url: str, fetch: bool) -> LinkPreview:
    check_in, check_out, guests = link_preview.parse_listing_url(url)
    preview = LinkPreview(
        url=url, site=link_preview.site_name(url), check_in=check_in, check_out=check_out, guests=guests
    )
    if fetch:
        try:
            title, description, photos = link_preview.fetch_preview(client, url)
            preview.title, preview.description, preview.photos = title, description, photos
            preview.fetched = True
        except link_preview.PreviewBlocked as exc:
            preview.fetch_problem = str(exc)
    return preview


def _rental_request(trip: Trip, body: RentalSearchIn, vacation_rentals: bool) -> tuple[dict[str, Any], str]:
    """The SerpApi parameters for a search, and the key its response is cached under."""
    params = serpapi_rentals.request_params(
        body.place or trip_place(trip),
        body.check_in,
        body.check_out,
        body.adults,
        body.children,
        trip.home_currency,
        vacation_rentals=vacation_rentals,
    )
    return params, cache_key("serpapi-rentals", params)


def search_rentals(
    db: Session,
    client: httpx.Client,
    api_key: str,
    trip: Trip,
    body: RentalSearchIn,
    now: datetime | None = None,
    *,
    vacation_rentals: bool = True,
) -> RentalSearchResult:
    """One SerpApi search (free within 12 hours of the same one); hotels when `vacation_rentals` is off."""
    now = now or datetime.now(UTC)
    params, key = _rental_request(trip, body, vacation_rentals)
    data: dict[str, Any] | None = cache_get(db, key, now)
    cached = data is not None
    if data is None:
        usage = serpapi_budget.usage(db, now)
        if usage.used_this_month >= usage.monthly_cap:
            raise OutOfSearches(usage.monthly_cap)
        data = serpapi_rentals.fetch(client, params, api_key)
        # Keep what's shown; the full response carries a lot of unused detail.
        data = {
            "properties": data.get("properties") or [],
            "google_hotels_url": (data.get("search_metadata") or {}).get("google_hotels_url"),
        }
        cache_put(db, key, "serpapi", data, now, RENTALS_TTL)
        db.add(
            ApiCall(
                provider="serpapi", endpoint="google_hotels", units=1, cached=False, status_code=200, ok=True
            )
        )
        db.commit()
    return RentalSearchResult(
        offers=serpapi_rentals.parse(data, trip.home_currency),
        cached=cached,
        google_hotels_url=data.get("google_hotels_url"),
    )


def cached_offers(
    db: Session,
    trip: Trip,
    body: RentalSearchIn,
    vacation_rentals: bool = True,
    now: datetime | None = None,
) -> list[RentalOffer] | None:
    """What an earlier search found, if it's still cached; None when it isn't. Never searches or spends."""
    _, key = _rental_request(trip, body, vacation_rentals)
    data = cache_get(db, key, now or datetime.now(UTC))
    return None if data is None else serpapi_rentals.parse(data, trip.home_currency)


def trip_place(trip: Trip) -> str:
    if not trip.destinations:
        raise ValueError("Add a destination to the trip, or say where to search.")
    first = trip.destinations[0]
    return ", ".join(p for p in (first.name, first.country) if p)
