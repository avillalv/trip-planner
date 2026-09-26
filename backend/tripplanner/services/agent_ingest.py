"""Checks and stores what agents submit. This is the only way agent output reaches the database."""

import ipaddress
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy.orm import Session

from tripplanner.models import AgentNote, FlightRoute, IngestRejection, Run, Trip
from tripplanner.schemas.agent import (
    AcceptedItem,
    AgentQuoteIn,
    FieldError,
    FinishIn,
    NoteIn,
    QuoteBatchResult,
    RejectedItem,
)
from tripplanner.services import fx
from tripplanner.services.agent_context import BLOCKED_DOMAINS
from tripplanner.services.quotes import NewQuote, add_quote

# Hard bounds on the per-person price, converted from USD to the trip's currency.
MIN_PER_PERSON_USD = Decimal(30)
MAX_PER_PERSON_USD = Decimal(15_000)
# Prices must have been seen during the run (with some slack for clock differences).
OBSERVED_SLACK = timedelta(minutes=10)


class RunNotActive(Exception):
    """The run has finished (or never started), so it can't accept more data."""


def active_run(db: Session, run_id: UUID) -> Run:
    run = db.get(Run, run_id)
    if run is None or run.status != "running":
        raise RunNotActive(run_id)
    return run


PRIVATE_SUFFIXES = (".local", ".localhost", ".internal", ".lan", ".home.arpa")
# Second-level labels of country domains, as in airbnb.co.uk or airbnb.com.au.
COUNTRY_SECOND_LEVELS = frozenset({"co", "com", "net", "org", "ne", "or"})


def blocked_domain(host: str) -> str | None:
    """The blocked site a host belongs to, including its country sites (airbnb.fr, www.airbnb.co.uk)."""
    labels = host.lower().rstrip(".").split(".")
    for domain in BLOCKED_DOMAINS:
        brand = domain.split(".")[0]
        if brand not in labels[:-1]:
            continue
        suffix = labels[len(labels) - labels[::-1].index(brand) :]
        if len(suffix) == 1 or (len(suffix) == 2 and suffix[0] in COUNTRY_SECOND_LEVELS):
            return domain
    return None


def source_problem(url: str) -> str | None:
    """Why a link can't be cited as a source, or None. Sources must be public http(s) pages."""
    try:
        parts = urlsplit(url.strip())
        host = (parts.hostname or "").lower()
    except ValueError:
        return "isn't a valid link"
    if parts.scheme not in ("http", "https") or not host:
        return "must be an http(s) link to the page that showed it"
    if host == "localhost" or host.endswith(PRIVATE_SUFFIXES):
        return "must be a public website"
    try:
        if not ipaddress.ip_address(host).is_global:
            return "must be a public website"
    except ValueError:
        if "." not in host:
            return "must be a public website"
    if domain := blocked_domain(host):
        return f"is on {domain}, which agents must not use"
    return None


def _route_errors(route: FlightRoute | None, trip: Trip, q: AgentQuoteIn) -> list[FieldError]:
    if route is None or route.trip_id != trip.id or not route.active:
        return [FieldError(field="route_id", msg="isn't one of this trip's routes; use an id from get_task")]
    errors = []
    if q.origin not in route.origin_codes:
        errors.append(FieldError(field="origin", msg=f"must be one of {', '.join(route.origin_codes)}"))
    if q.destination not in route.destination_codes:
        errors.append(
            FieldError(field="destination", msg=f"must be one of {', '.join(route.destination_codes)}")
        )
    if not route.depart_from <= q.depart_date <= route.depart_to:
        errors.append(
            FieldError(field="depart_date", msg=f"must be {route.depart_from} to {route.depart_to}")
        )
    if route.trip_type == "one_way":
        if q.return_date is not None:
            errors.append(FieldError(field="return_date", msg="must be left out for a one-way route"))
        return errors
    if q.return_date is None:
        errors.append(FieldError(field="return_date", msg="is required for this round-trip route"))
    elif q.return_date <= q.depart_date:
        errors.append(FieldError(field="return_date", msg="must be after the departure date"))
    elif route.min_nights is not None and route.max_nights is not None:
        nights = (q.return_date - q.depart_date).days
        if not route.min_nights <= nights <= route.max_nights:
            errors.append(
                FieldError(
                    field="return_date",
                    msg=f"gives {nights} nights; the route wants {route.min_nights}–{route.max_nights}",
                )
            )
    elif route.return_from and route.return_to and not route.return_from <= q.return_date <= route.return_to:
        errors.append(
            FieldError(field="return_date", msg=f"must be {route.return_from} to {route.return_to}")
        )
    return errors


def _price_bounds(db: Session, currency: str) -> tuple[Decimal, Decimal]:
    low = fx.convert(db, MIN_PER_PERSON_USD, "USD", currency)
    high = fx.convert(db, MAX_PER_PERSON_USD, "USD", currency)
    return low or MIN_PER_PERSON_USD, high or MAX_PER_PERSON_USD


def _check_quote(
    db: Session, run: Run, trip: Trip, q: AgentQuoteIn, now: datetime
) -> tuple[list[FieldError], FlightRoute | None, datetime]:
    route = db.get(FlightRoute, q.route_id)
    errors = _route_errors(route, trip, q)
    if q.depart_date < now.date():
        errors.append(FieldError(field="depart_date", msg="is in the past"))
    if problem := source_problem(q.source_url):
        errors.append(FieldError(field="source_url", msg=problem))

    observed = q.observed_at or now
    if observed.tzinfo is None:
        observed = observed.replace(tzinfo=UTC)
    started = run.started_at or now
    if not started - OBSERVED_SLACK <= observed <= now + OBSERVED_SLACK:
        errors.append(FieldError(field="observed_at", msg="must be during this run, when you saw the price"))

    if route is not None:
        party = route.adults + route.children
        if q.passengers not in (party, 1):
            errors.append(
                FieldError(field="passengers", msg=f"must be {party} (whole party) or 1 (per-person price)")
            )
    return errors, route, observed


def submit_quotes(
    db: Session, run: Run, items: list[dict[str, Any]], now: datetime | None = None
) -> QuoteBatchResult:
    """Validate each item on its own; store the good ones and record why the others failed."""
    now = now or datetime.now(UTC)
    trip = db.get(Trip, run.trip_id)
    assert trip is not None
    low, high = _price_bounds(db, trip.home_currency)
    result = QuoteBatchResult(accepted=[], rejected=[], duplicates=[])

    for index, raw in enumerate(items):
        try:
            q = AgentQuoteIn.model_validate(raw)
        except ValidationError as exc:
            errors = [
                FieldError(field=".".join(map(str, e["loc"])) or "item", msg=e["msg"]) for e in exc.errors()
            ]
            result.rejected.append(RejectedItem(index=index, errors=errors))
            continue

        errors, route, observed = _check_quote(db, run, trip, q, now)
        flags: list[str] = []
        price_total, passengers = q.price_total, q.passengers
        if route is not None and not errors:
            party = route.adults + route.children
            if passengers == 1 and party > 1:
                price_total, passengers = q.price_total * party, party
                flags.append("per_person_price_scaled")
            price_home = fx.convert(db, price_total, q.currency, trip.home_currency)
            if price_home is None:
                errors.append(
                    FieldError(field="currency", msg=f"can't be converted to {trip.home_currency} right now")
                )
            elif not low <= price_home / passengers <= high:
                errors.append(
                    FieldError(field="price_total", msg="is outside the believable range for a flight")
                )

        if errors:
            result.rejected.append(RejectedItem(index=index, errors=errors))
            continue

        assert route is not None
        quote = add_quote(
            db,
            route,
            NewQuote(
                source="agent",
                confidence="indicative",
                origin=q.origin,
                destination=q.destination,
                depart_date=q.depart_date,
                return_date=q.return_date,
                price_total=price_total,
                currency=q.currency,
                passengers=passengers,
                observed_at=observed,
                airlines=q.airlines,
                stops_out=q.stops_outbound,
                stops_back=q.stops_return,
                duration_out_min=q.duration_outbound_min,
                booking_url=q.source_url,
                source_url=q.source_url,
                raw={"seen_on": q.seen_on, "notes": q.notes, "submitted": q.model_dump(mode="json")},
            ),
            trip.home_currency,
            run_id=run.id,
        )
        if quote is None:
            result.duplicates.append(index)
            continue
        if quote.suspect:
            flags.append("suspect")
        result.accepted.append(AcceptedItem(index=index, id=quote.id, flags=flags))

    for item in result.rejected:
        raw = items[item.index]
        db.add(
            IngestRejection(
                run_id=run.id,
                entity="flight_quote",
                item=raw if isinstance(raw, dict) else {"value": raw},
                errors=[e.model_dump() for e in item.errors],
            )
        )
    run.accepted_count += len(result.accepted)
    run.rejected_count += len(result.rejected)
    db.commit()
    return result


def add_note(db: Session, run: Run, note: NoteIn) -> AgentNote:
    """Save a finding. Raises ValueError (after logging the rejection) if a link isn't usable."""
    problems = [f"{u} {p}" for u in note.urls if (p := source_problem(u))]
    if problems:
        db.add(
            IngestRejection(
                run_id=run.id,
                entity="note",
                item=note.model_dump(),
                errors=[{"field": "urls", "msg": p} for p in problems],
            )
        )
        run.rejected_count += 1
        db.commit()
        raise ValueError("; ".join(problems))
    row = AgentNote(trip_id=run.trip_id, run_id=run.id, title=note.title, body=note.body, urls=note.urls)
    db.add(row)
    run.accepted_count += 1
    db.commit()
    return row


def record_finish(db: Session, run: Run, report: FinishIn) -> None:
    """Keep the agent's own account of the run; the runner sets the final status when Claude exits."""
    run.report = report.model_dump()
    run.summary = report.summary
    db.commit()
