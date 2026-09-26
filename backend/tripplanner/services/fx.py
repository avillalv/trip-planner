"""Currency conversion with cached reference rates (refreshed at most every 12 hours)."""

import logging
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

import httpx
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from tripplanner.models import FxRate
from tripplanner.providers import ProviderError
from tripplanner.providers.frankfurter import latest_rates_per_eur

REFRESH_AFTER = timedelta(hours=12)
CENT = Decimal("0.01")

log = logging.getLogger(__name__)


def refresh_rates(db: Session, client: httpx.Client, now: datetime | None = None) -> bool:
    """Fetch new rates if the cached ones are old. Returns False if rates are unavailable."""
    now = now or datetime.now(UTC)
    newest = db.scalar(select(func.max(FxRate.fetched_at)))
    if newest is not None and now - newest < REFRESH_AFTER:
        return True
    try:
        rates = latest_rates_per_eur(client)
    except ProviderError as exc:
        log.warning("%s", exc)
        return newest is not None
    rows = [{"currency": c, "per_eur": r, "rate_date": d, "fetched_at": now} for c, (r, d) in rates.items()]
    stmt = insert(FxRate).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=[FxRate.currency],
        set_={"per_eur": stmt.excluded.per_eur, "rate_date": stmt.excluded.rate_date, "fetched_at": now},
    )
    db.execute(stmt)
    db.commit()
    return True


def convert(db: Session, amount: Decimal, from_currency: str, to_currency: str) -> Decimal | None:
    """Convert through EUR cross rates; None when either currency has no rate."""
    if from_currency == to_currency:
        return amount.quantize(CENT, ROUND_HALF_UP)
    rates = dict(
        db.execute(
            select(FxRate.currency, FxRate.per_eur).where(FxRate.currency.in_([from_currency, to_currency]))
        ).all()
    )
    if from_currency not in rates or to_currency not in rates or rates[from_currency] == 0:
        return None
    return (amount * rates[to_currency] / rates[from_currency]).quantize(CENT, ROUND_HALF_UP)
