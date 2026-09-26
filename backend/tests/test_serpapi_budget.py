from datetime import UTC, datetime, timedelta

import httpx
import respx
from sqlalchemy.orm import Session

from tripplanner.models import ApiCall, AppSetting
from tripplanner.providers import serpapi
from tripplanner.services import serpapi_budget

# September has 30 days, so on the 26th there are 5 days left including today.
NOW = datetime(2026, 9, 26, 15, tzinfo=UTC)


def searches(db: Session, count: int, at: datetime, **fields: object) -> None:
    values = {"provider": "serpapi", "endpoint": "google_flights", "ok": True, "created_at": at, **fields}
    for _ in range(count):
        db.add(ApiCall(**values))
    db.flush()


def test_daily_share_is_what_is_left_over_the_remaining_days(db_session: Session) -> None:
    searches(db_session, 190, NOW - timedelta(days=3))  # earlier this month
    searches(db_session, 4, NOW - timedelta(hours=2))  # today
    searches(db_session, 3, NOW - timedelta(hours=1), ok=False)  # failures don't count

    usage = serpapi_budget.usage(db_session, NOW)

    assert (usage.monthly_cap, usage.used_this_month, usage.used_today) == (240, 194, 4)
    # (240 - 194 + 4) // 5 = 10 per day, 4 already used today.
    assert (usage.daily_allowance, usage.remaining_today) == (10, 6)


def test_each_run_gets_a_slice_of_today(db_session: Session) -> None:
    searches(db_session, 190, NOW - timedelta(days=3))

    assert serpapi_budget.run_allowance(db_session, runs_per_day=2, now=NOW) == 5


def test_nothing_left_means_no_live_searches(db_session: Session) -> None:
    db_session.add(AppSetting(key=serpapi_budget.CAP_KEY, value=10))
    searches(db_session, 10, NOW - timedelta(days=1))

    assert serpapi_budget.run_allowance(db_session, runs_per_day=2, now=NOW) == 0


def test_account_api_limits_the_budget(db_session: Session, no_real_network: respx.MockRouter) -> None:
    no_real_network.get(serpapi.ACCOUNT_URL).mock(
        return_value=httpx.Response(200, json={"plan_searches_left": 15, "this_month_usage": 235})
    )
    with httpx.Client() as client:
        serpapi_budget.sync_account(db_session, client, "key", NOW - timedelta(hours=1))

    usage = serpapi_budget.usage(db_session, NOW)

    assert usage.plan_searches_left == 15
    assert usage.daily_allowance == 3  # 15 left across 5 days, even though our own count is 0
