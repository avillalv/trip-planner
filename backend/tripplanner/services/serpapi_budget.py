"""Keep live Google Flights searches inside the SerpApi monthly quota.

Each day may use its fair share of what's left this month; each scheduled run gets a slice of
that. SerpApi's free Account API is checked once a day so searches made elsewhere (for
example, the playground) are counted too.
"""

import calendar
import logging
import math
from datetime import UTC, date, datetime, timedelta

import httpx
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from tripplanner.models import ApiCall, AppSetting
from tripplanner.providers import ProviderError, serpapi

CAP_KEY = "serpapi_monthly_cap"
ACCOUNT_KEY = "serpapi_account"
DEFAULT_MONTHLY_CAP = 240  # of the free 250, leaving a little room for manual tests
ACCOUNT_SYNC_EVERY = timedelta(hours=20)

log = logging.getLogger(__name__)


class SerpApiUsage(BaseModel):
    monthly_cap: int
    used_this_month: int
    used_today: int
    daily_allowance: int
    remaining_today: int
    plan_searches_left: int | None
    account_synced_at: datetime | None


def _month_start(today: date) -> datetime:
    return datetime(today.year, today.month, 1, tzinfo=UTC)


def _count(db: Session, since: datetime) -> int:
    # Every SerpApi search counts: flight checks and rental searches share the plan's allowance.
    stmt = select(func.coalesce(func.sum(ApiCall.units), 0)).where(
        ApiCall.provider == "serpapi",
        ApiCall.endpoint != "account",
        ApiCall.ok.is_(True),
        ApiCall.cached.is_(False),
        ApiCall.created_at >= since,
    )
    return int(db.scalar(stmt) or 0)


def monthly_cap(db: Session) -> int:
    row = db.get(AppSetting, CAP_KEY)
    return int(row.value) if row else DEFAULT_MONTHLY_CAP


def usage(db: Session, now: datetime | None = None) -> SerpApiUsage:
    now = now or datetime.now(UTC)
    today = now.date()
    cap = monthly_cap(db)
    used_month = _count(db, _month_start(today))
    used_today = _count(db, datetime(today.year, today.month, today.day, tzinfo=UTC))

    remaining = cap - used_month
    account = db.get(AppSetting, ACCOUNT_KEY)
    plan_left = None
    synced_at = None
    if account:
        plan_left = account.value.get("plan_searches_left")
        synced_at = datetime.fromisoformat(account.value["synced_at"])
        if plan_left is not None and synced_at.month == now.month:
            # Searches made since the sync were already counted in used_month.
            since_sync = _count(db, synced_at)
            remaining = min(remaining, plan_left - since_sync)

    days_left = calendar.monthrange(today.year, today.month)[1] - today.day + 1
    # Today's share is based on what was left when the day started.
    daily = max(0, (remaining + used_today) // days_left)
    return SerpApiUsage(
        monthly_cap=cap,
        used_this_month=used_month,
        used_today=used_today,
        daily_allowance=daily,
        remaining_today=max(0, min(daily - used_today, remaining)),
        plan_searches_left=plan_left,
        account_synced_at=synced_at,
    )


def run_allowance(db: Session, runs_per_day: int, now: datetime | None = None) -> int:
    """Live searches one run may use: an even slice of today's allowance, at least one if any is left."""
    current = usage(db, now)
    if current.remaining_today <= 0:
        return 0
    per_run = max(1, math.ceil(current.daily_allowance / max(1, runs_per_day)))
    return min(per_run, current.remaining_today)


def sync_account(db: Session, client: httpx.Client, api_key: str, now: datetime | None = None) -> None:
    now = now or datetime.now(UTC)
    row = db.get(AppSetting, ACCOUNT_KEY)
    if row and now - datetime.fromisoformat(row.value["synced_at"]) < ACCOUNT_SYNC_EVERY:
        return
    try:
        info = serpapi.account(client, api_key)
    except ProviderError as exc:
        log.warning("%s", exc)
        return
    value = {
        "plan_searches_left": info.get("plan_searches_left"),
        "this_month_usage": info.get("this_month_usage"),
        "searches_per_month": info.get("searches_per_month"),
        "synced_at": now.isoformat(),
    }
    if row is None:
        db.add(AppSetting(key=ACCOUNT_KEY, value=value))
    else:
        row.value = value
    db.commit()
