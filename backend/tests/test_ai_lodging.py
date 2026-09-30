"""AI lodging picks: asking (one paid search), the plan a run works from, and what agents may save."""

import json
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from tests.factories import add_lodging_run, add_run, add_trip
from tripplanner.models import (
    Activity,
    IngestRejection,
    LodgingOption,
    PlaceCacheEntry,
    Run,
    Trip,
    TripDestination,
)
from tripplanner.providers import link_preview, serpapi_rentals
from tripplanner.schemas.lodging import RentalSearchIn
from tripplanner.services import agent_plan, lodging, serpapi_budget, suggestions
from tripplanner.services.agent_context import PLANNER_RULES, build_context
from tripplanner.worker.agents.prompts import system_prompt, task_prompt

FIXTURES = Path(__file__).parent / "fixtures"
AGENT = {"Authorization": "Bearer test-agent-key"}
TODAY = date(2026, 9, 29)
ASK = {"check_in": "2026-11-09", "check_out": "2026-11-12"}
STAY_INN = "https://voyabay.com/rentals/lpcf1e4"


def fixture(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def rentals() -> dict[str, Any]:
    return fixture("serpapi_vacation_rentals.json")


def hotels() -> dict[str, Any]:
    return fixture("serpapi_hotels.json")


@pytest.fixture(autouse=True)
def claude_installed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(suggestions, "find_claude", lambda _settings: ["claude"])


@pytest.fixture
def trip(db_session: Session) -> Trip:
    """Nov 5-15 in Kyoto, who like temples and food."""
    trip = add_trip(db_session, "Japan")
    trip.start_date, trip.end_date = date(2026, 11, 5), date(2026, 11, 15)
    trip.interests = ["temples", "food"]
    trip.destinations = [
        TripDestination(
            position=0, name="Kyoto", country="Japan", lat=35.01, lon=135.77, info_status="skipped"
        )
    ]
    db_session.flush()
    return trip


@pytest.fixture
def run(db_session: Session, trip: Trip) -> Run:
    return add_lodging_run(db_session, trip, rentals())


def mock_search(router: respx.MockRouter, data: dict[str, Any]) -> respx.Route:
    return router.get(serpapi_rentals.SEARCH_URL).mock(return_value=httpx.Response(200, json=data))


def ask(client: TestClient, trip: Trip, **body: Any) -> httpx.Response:
    return client.post(f"/api/v1/trips/{trip.id}/ai/lodging", json={**ASK, **body})


@pytest.fixture
def searching(use_settings, no_real_network: respx.MockRouter) -> respx.Route:
    """A SerpApi key, and a search that finds the rentals fixture."""
    use_settings(serpapi_api_key="test-serp-key")
    return mock_search(no_real_network, rentals())


# --- Asking -------------------------------------------------------------------------------------


def test_asking_searches_once_and_queues_a_lodging_run(
    client: TestClient, db_session: Session, trip: Trip, searching: respx.Route
) -> None:
    response = ask(client, trip, guests=3, message="  Near a subway station  ")

    assert response.status_code == 202
    out = response.json()
    assert (out["kind"], out["status"], out["trigger"], out["routine_id"]) == (
        "lodging_agent",
        "queued",
        "manual",
        None,
    )
    assert out["params"] == {
        "place": "Kyoto, Japan",
        "check_in": "2026-11-09",
        "check_out": "2026-11-12",
        "guests": 3,
        "kind": "rentals",
        "message": "Near a subway station",
    }
    assert db_session.get(Run, out["id"]) is not None
    assert searching.call_count == 1
    sent = searching.calls[0].request.url.params
    assert (sent["q"], sent["vacation_rentals"], sent["adults"], sent["children"]) == (
        "Kyoto, Japan",
        "true",
        "3",
        "0",
    )
    assert (sent["check_in_date"], sent["check_out_date"]) == ("2026-11-09", "2026-11-12")
    assert serpapi_budget.usage(db_session).used_this_month == 1


def test_hotels_are_searched_without_the_rentals_switch_and_cached_apart(
    client: TestClient, db_session: Session, trip: Trip, use_settings, no_real_network: respx.MockRouter
) -> None:
    use_settings(serpapi_api_key="test-serp-key")
    route = mock_search(no_real_network, hotels())

    def finish_runs() -> None:
        db_session.execute(update(Run).values(status="succeeded"))  # so the next ask isn't turned away

    first = ask(client, trip, kind="hotels")
    finish_runs()
    again = ask(client, trip, kind="hotels")
    finish_runs()
    rental = ask(client, trip, kind="rentals")

    assert (first.status_code, again.status_code, rental.status_code) == (202, 202, 202)
    assert first.json()["params"]["kind"] == "hotels"
    hotel_params = route.calls[0].request.url.params
    assert "vacation_rentals" not in hotel_params and hotel_params["q"] == "Kyoto, Japan"
    # The repeat hotel search was free; the rentals search for the same dates is a search of its own.
    assert route.call_count == 2
    assert route.calls[1].request.url.params["vacation_rentals"] == "true"


def test_a_place_can_be_given(client: TestClient, searching: respx.Route, trip: Trip) -> None:
    out = ask(client, trip, place="  Nara, Japan ").json()

    assert out["params"]["place"] == "Nara, Japan"
    assert searching.calls[0].request.url.params["q"] == "Nara, Japan"


def test_the_last_night_can_end_on_the_trips_last_day(
    client: TestClient, searching: respx.Route, trip: Trip
) -> None:
    response = ask(client, trip, check_in="2026-11-05", check_out="2026-11-15")

    assert response.status_code == 202


@pytest.mark.parametrize(
    "dates",
    [
        {"check_in": "2026-11-04", "check_out": "2026-11-07"},
        {"check_in": "2026-11-13", "check_out": "2026-11-16"},
        {"check_in": "2026-12-01", "check_out": "2026-12-03"},
    ],
)
def test_the_stay_must_fit_the_trip_and_costs_no_search(
    client: TestClient, searching: respx.Route, trip: Trip, dates: dict[str, str]
) -> None:
    response = ask(client, trip, **dates)

    assert response.status_code == 422
    assert "Nov 5 and Nov 15" in response.json()["detail"]
    assert searching.call_count == 0


@pytest.mark.parametrize(
    "dates",
    [
        {"check_in": "2026-11-09", "check_out": "2026-11-09"},
        {"check_in": "2026-11-12", "check_out": "2026-11-09"},
    ],
)
def test_check_out_must_be_after_check_in(
    client: TestClient, searching: respx.Route, trip: Trip, dates: dict[str, str]
) -> None:
    assert ask(client, trip, **dates).status_code == 422
    assert searching.call_count == 0


def test_a_trip_without_dates_cannot_ask(
    client: TestClient, db_session: Session, searching: respx.Route
) -> None:
    undated = add_trip(db_session, "Someday")

    response = ask(client, undated)

    assert response.status_code == 422
    assert "dates" in response.json()["detail"] and searching.call_count == 0


def test_a_trip_needs_a_destination_or_a_place(
    client: TestClient, db_session: Session, searching: respx.Route
) -> None:
    lost = add_trip(db_session, "Lost")
    lost.start_date, lost.end_date = date(2026, 11, 5), date(2026, 11, 15)
    db_session.flush()

    assert ask(client, lost).status_code == 422
    assert ask(client, lost, place="Kyoto, Japan").status_code == 202


def test_unknown_trips_and_bad_bodies(client: TestClient, trip: Trip, searching: respx.Route) -> None:
    assert client.post("/api/v1/trips/999999/ai/lodging", json=ASK).status_code == 404
    assert ask(client, trip, guests=0).status_code == 422
    assert ask(client, trip, guests=17).status_code == 422
    assert ask(client, trip, kind="hostels").status_code == 422
    assert ask(client, trip, message="x" * 1001).status_code == 422
    assert ask(client, trip, place="x" * 121).status_code == 422
    assert searching.call_count == 0


@pytest.mark.parametrize("state", ["queued", "running"])
def test_one_lodging_request_at_a_time(
    client: TestClient, db_session: Session, trip: Trip, searching: respx.Route, state: str
) -> None:
    add_run(db_session, trip, "lodging_agent", status=state)

    response = ask(client, trip)

    assert response.status_code == 409
    assert (
        response.json()["detail"] == "Claude is still picking places to stay. Wait for it or stop it first."
    )
    assert searching.call_count == 0


def test_other_runs_and_other_trips_do_not_block(
    client: TestClient, db_session: Session, trip: Trip, searching: respx.Route
) -> None:
    add_run(db_session, trip, "itinerary_agent", status="running")
    add_run(db_session, trip, "lodging_agent", status="succeeded")
    add_run(db_session, add_trip(db_session, "Iceland"), "lodging_agent", status="running")

    assert ask(client, trip).status_code == 202


def test_asking_needs_the_agent_key_and_claude_code(
    client: TestClient,
    use_settings,
    monkeypatch: pytest.MonkeyPatch,
    trip: Trip,
    no_real_network: respx.MockRouter,
) -> None:
    use_settings(serpapi_api_key="test-serp-key", agent_ingest_api_key=None)
    route = mock_search(no_real_network, rentals())

    no_key = ask(client, trip)
    use_settings(serpapi_api_key="test-serp-key")
    monkeypatch.setattr(suggestions, "find_claude", lambda _settings: None)
    no_claude = ask(client, trip)

    assert no_key.status_code == 503 and "AGENT_INGEST_API_KEY" in no_key.json()["detail"]
    assert no_claude.status_code == 503 and "Claude Code wasn't found" in no_claude.json()["detail"]
    assert route.call_count == 0


def test_asking_needs_a_serpapi_key(client: TestClient, trip: Trip) -> None:
    response = ask(client, trip)

    assert response.status_code == 503
    assert "SERPAPI_API_KEY" in response.json()["detail"]


def test_asking_stops_when_the_month_is_used_up(
    client: TestClient,
    db_session: Session,
    trip: Trip,
    searching: respx.Route,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(serpapi_budget, "monthly_cap", lambda _db: 0)

    response = ask(client, trip)

    assert response.status_code == 429
    assert "used up" in response.json()["detail"]
    assert searching.call_count == 0
    assert db_session.scalars(select(Run).where(Run.kind == "lodging_agent")).all() == []


def test_a_search_that_finds_nothing_queues_no_run(
    client: TestClient, db_session: Session, trip: Trip, use_settings, no_real_network: respx.MockRouter
) -> None:
    use_settings(serpapi_api_key="test-serp-key")
    mock_search(no_real_network, {"properties": []})

    response = ask(client, trip)

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "Nothing came back for Kyoto, Japan on those dates. Try a nearby town or other dates."
    )
    assert db_session.scalars(select(Run).where(Run.kind == "lodging_agent")).all() == []


def test_a_search_that_fails_is_a_bad_gateway(
    client: TestClient, trip: Trip, use_settings, no_real_network: respx.MockRouter
) -> None:
    use_settings(serpapi_api_key="test-serp-key")
    no_real_network.get(serpapi_rentals.SEARCH_URL).mock(return_value=httpx.Response(500, json={}))

    assert ask(client, trip).status_code == 502


# --- Hotels and rentals parse alike -------------------------------------------------------------


def test_hotel_results_are_parsed() -> None:
    [kanra, backpackers, nanba, ryokan] = serpapi_rentals.parse(hotels(), "USD")

    assert (kanra.title, kanra.kind, kanra.price_total, kanra.price_per_night) == (
        "Hotel Kanra Kyoto",
        "4-star hotel",
        630,
        210,
    )
    assert (kanra.rating, kanra.review_count, kanra.link) == (
        Decimal("4.6"),
        1210,
        "https://www.hotelkanra.jp/kyoto/",
    )
    assert kanra.photos[0] == "https://www.hotelkanra.jp/photos/lobby.jpg" and len(kanra.photos) == 2
    assert (kanra.sleeps, kanra.bedrooms, kanra.details) == (None, None, [])
    assert backpackers.kind == "hotel"  # no star rating and nothing else to go on
    assert nanba.kind == "3-star hotel"  # from extracted_hotel_class alone
    assert nanba.details == ["Free breakfast"]
    assert (ryokan.kind, ryokan.price_total, ryokan.price_per_night, ryokan.link) == (
        "3-star hotel",
        None,
        None,
        None,
    )
    assert ryokan.lat == 35.0102


def test_hotels_are_searched_without_the_rentals_parameter() -> None:
    hotel = serpapi_rentals.request_params(
        "Kyoto", date(2026, 11, 9), date(2026, 11, 12), 2, 0, "usd", vacation_rentals=False
    )
    rental = serpapi_rentals.request_params("Kyoto", date(2026, 11, 9), date(2026, 11, 12), 2, 0, "usd")

    assert "vacation_rentals" not in hotel
    assert rental == {**hotel, "vacation_rentals": "true"}


def test_the_cache_reader_never_searches(
    db_session: Session, trip: Trip, no_real_network: respx.MockRouter
) -> None:
    search = RentalSearchIn(check_in=date(2026, 11, 9), check_out=date(2026, 11, 12))

    assert lodging.cached_offers(db_session, trip, search) is None
    add_lodging_run(db_session, trip, rentals())
    found = lodging.cached_offers(db_session, trip, search)
    hotel_search = lodging.cached_offers(db_session, trip, search, vacation_rentals=False)

    assert found is not None and found[0].title == "Stay Inn KOTO"
    assert hotel_search is None  # hotels are cached apart from rentals
    assert len(no_real_network.calls) == 0


# --- The plan -----------------------------------------------------------------------------------


def plan_for(db: Session, run: Run) -> dict[str, Any]:
    plan = agent_plan.build_plan(db, run, TODAY)
    assert plan is not None
    return plan


def test_the_plan_numbers_the_offers_from_the_cache_and_never_searches(
    db_session: Session, trip: Trip, run: Run, no_real_network: respx.MockRouter
) -> None:
    searches = mock_search(no_real_network, rentals())
    no_real_network.get("https://archive-api.open-meteo.com/v1/archive").mock(
        return_value=httpx.Response(500)
    )
    run.params = {**run.params, "guests": 2, "message": "Somewhere quiet"}
    db_session.add_all(
        [
            LodgingOption(
                trip_id=trip.id,
                title="Machiya near Gion",
                url="https://x.example.com/a",
                added_via="paste",
                site="x.example.com",
            ),
            Activity(
                trip_id=trip.id,
                day=date(2026, 11, 10),
                title="Fushimi Inari",
                category="sights",
                status="planned",
            ),
            Activity(
                trip_id=trip.id,
                day=date(2026, 11, 8),
                title="Before the stay",
                category="other",
                status="planned",
            ),
        ]
    )
    db_session.flush()

    plan = plan_for(db_session, run)

    assert plan["request"] == {
        "place": "Kyoto, Japan",
        "check_in": "2026-11-09",
        "check_out": "2026-11-12",
        "nights": 3,
        "guests": 2,
        "kind": "rentals",
        "message": "Somewhere quiet",
    }
    assert (plan["interests"], plan["party_size"]) == (["temples", "food"], 2)
    assert [d["date"] for d in plan["days"]] == ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]
    assert plan["days"][1]["destination"] == "Kyoto, Japan"
    assert [p["title"] for p in plan["days"][1]["plans"]] == ["Fushimi Inari"]
    assert plan["already_saved"] == [
        {"title": "Machiya near Gion", "site": "x.example.com", "status": "candidate"}
    ]
    assert [o["index"] for o in plan["offers"]] == [1, 2, 3, 4, 5, 6]
    first, second, third = plan["offers"][:3]
    assert first == {
        "index": 1,
        "title": "Stay Inn KOTO",
        "site": "Voyabay",
        "kind": "vacation rental",
        "price_total": 275,
        "price_per_night": 92,
        "currency": "USD",
        "rating": 4.4,
        "review_count": 245,
        "sleeps": 3,
        "bedrooms": None,
        "beds": None,
        "baths": None,
        "lat": 34.969764709472656,
        "lon": 135.7684783935547,
        "details": ["Sleeps 3"],
    }
    assert (second["kind"], second["sleeps"], second["bedrooms"], second["beds"]) == (
        "Entire cottage",
        6,
        3,
        5,
    )
    assert third["baths"] == 1 and "link" not in third and "photos" not in third
    assert searches.call_count == 0  # the plan came from the cache


def test_offer_details_are_capped(db_session: Session, trip: Trip) -> None:
    data = rentals()
    data["properties"][0]["essential_info"] = [f"Detail {n}" for n in range(12)]

    plan = plan_for(db_session, add_lodging_run(db_session, trip, data))

    assert len(plan["offers"][0]["details"]) == 8


def test_hotel_runs_read_the_hotel_search(db_session: Session, trip: Trip) -> None:
    run = add_lodging_run(db_session, trip, hotels(), kind="hotels", guests=4)

    plan = plan_for(db_session, run)

    assert plan["request"]["kind"] == "hotels" and plan["request"]["guests"] == 4
    assert [o["title"] for o in plan["offers"]][:2] == ["Hotel Kanra Kyoto", "Kyoto Backpackers Inn"]
    assert plan["offers"][0]["kind"] == "4-star hotel"
    assert plan["offers"][3]["price_total"] is None


def test_the_offers_are_empty_once_the_cache_is_gone(db_session: Session, run: Run) -> None:
    db_session.execute(delete(PlaceCacheEntry))
    db_session.flush()

    plan = plan_for(db_session, run)

    assert plan["offers"] == [] and plan["request"]["place"] == "Kyoto, Japan"


def test_a_run_without_a_request_still_has_a_plan(db_session: Session, trip: Trip) -> None:
    plan = plan_for(db_session, add_run(db_session, trip, "lodging_agent"))

    assert plan["offers"] == [] and len(plan["days"]) == 11


def test_get_task_gives_a_lodging_run_its_plan_and_planner_rules(client: TestClient, run: Run) -> None:
    body = client.get(f"/api/agent/v1/runs/{run.id}/context", headers=AGENT).json()

    assert body["kind"] == "lodging_agent" and body["routes"] == [] and body["rules"] == PLANNER_RULES
    assert [o["title"] for o in body["plan"]["offers"]][:2] == [
        "Stay Inn KOTO",
        "Guest House CHALET SIELU - Up to 4 of SIELU & 5-6 of SAN-CASHEW or with dogs- Vacation STAY 68051v",
    ]


def test_the_task_prompt_lists_the_numbered_offers(db_session: Session, run: Run) -> None:
    run.params = {**run.params, "message": "We want a kitchen"}

    prompt = task_prompt(build_context(db_session, run))

    assert prompt.startswith("# Task: the best places to stay in Kyoto, Japan, 2026-11-09 to 2026-11-12\n")
    assert "searched Google's vacation rentals for these dates for 2 guests" in prompt
    assert "You can't check Airbnb." in prompt
    assert "<request>We want a kitchen</request>" in prompt
    assert '"title": "Stay Inn KOTO"' in prompt and '"index": 6' in prompt
    assert '"routes"' not in prompt and "voyabay.com" not in prompt  # no links to go and open
    hotel_prompt = task_prompt(
        build_context(
            db_session,
            add_lodging_run(db_session, db_session.get(Trip, run.trip_id), hotels(), kind="hotels"),
        )
    )
    assert "searched Google's hotels" in hotel_prompt and "They also said" not in hotel_prompt


def test_the_lodging_system_prompt_is_about_lodging() -> None:
    prompt = system_prompt("lodging_agent")

    assert "- suggest_lodging:" in prompt and "recent guest reviews" in prompt and "{" not in prompt
    assert "ATV tour" not in prompt and "timing_note" not in prompt
    assert "ATV tour" in system_prompt("itinerary_agent")


# --- What agents may save -----------------------------------------------------------------------


def pick(index: int = 1, rank: int = 1, **overrides: Any) -> dict[str, Any]:
    item: dict[str, Any] = {
        "index": index,
        "rank": rank,
        "why": "A short walk to Fushimi Inari, which you both want to see.",
        "pros": "Quiet street; guests praise the host.",
        "cons": "Small rooms.",
    }
    item.update(overrides)
    return {k: v for k, v in item.items() if v != "<drop>"}


def submit(client: TestClient, run: Run, *items: dict[str, Any]) -> dict[str, Any]:
    response = client.post(
        f"/api/agent/v1/runs/{run.id}/lodging-picks", json={"picks": list(items)}, headers=AGENT
    )
    assert response.status_code == 200, response.text
    return response.json()


def saved(db: Session) -> list[LodgingOption]:
    return list(db.scalars(select(LodgingOption).order_by(LodgingOption.id)))


def test_picks_become_agent_lodging_options(
    client: TestClient, db_session: Session, trip: Trip, run: Run, no_real_network: respx.MockRouter
) -> None:
    result = submit(client, run, pick(1, 2), pick(2, 1, why="Room for six.", pros="<drop>", cons="<drop>"))

    assert [a["index"] for a in result["accepted"]] == [1, 2]
    assert result["rejected"] == [] and result["duplicates"] == []
    first, second = (db_session.get(LodgingOption, a["id"]) for a in result["accepted"])
    assert (first.trip_id, first.run_id, first.added_via, first.status, first.favorite) == (
        trip.id,
        run.id,
        "agent",
        "candidate",
        False,
    )
    assert first.title == "Stay Inn KOTO" and first.url == STAY_INN
    assert first.site == link_preview.site_name(STAY_INN)
    assert first.notes == "AI pick #2: A short walk to Fushimi Inari, which you both want to see."
    assert (first.pros, first.cons) == ("Quiet street; guests praise the host.", "Small rooms.")
    assert (first.check_in, first.check_out, first.guests) == (date(2026, 11, 9), date(2026, 11, 12), 2)
    assert (str(first.price_total), str(first.price_per_night), first.currency) == ("275.00", "91.67", "USD")
    assert (str(first.rating), first.review_count) == ("4.40", 245)
    assert (first.lat, first.lon) == (34.969764709472656, 135.7684783935547)
    assert first.photos and all(p.startswith("https://") for p in first.photos)
    assert first.raw is not None and first.raw["title"] == "Stay Inn KOTO"
    assert first.raw["pick"] == {"index": 1, "rank": 2}
    # A Booking.com partner link is kept as a link, and nothing but the one search ever went out.
    assert second.url is not None and second.url.startswith("https://www.booking.com/hotel/jp/")
    assert (second.bedrooms, second.beds, (second.pros, second.cons)) == (3, 5, ("", ""))
    assert second.notes == "AI pick #1: Room for six."
    assert len(no_real_network.calls) == 0
    db_session.refresh(run)
    assert (run.accepted_count, run.rejected_count) == (2, 0)


def test_a_pick_without_a_link_or_total_is_still_saved(
    client: TestClient, db_session: Session, trip: Trip
) -> None:
    data = rentals()
    del data["properties"][4]["total_rate"]
    run = add_lodging_run(db_session, trip, data)

    [accepted] = submit(client, run, pick(5))["accepted"]

    option = db_session.get(LodgingOption, accepted["id"])
    assert option.url is None and option.url_normalized is None
    assert (str(option.price_per_night), str(option.price_total)) == ("88.00", "264.00")


def test_hotel_picks_are_saved_too(client: TestClient, db_session: Session, trip: Trip) -> None:
    run = add_lodging_run(db_session, trip, hotels(), kind="hotels")

    result = submit(client, run, pick(1), pick(4, 2))

    assert [a["index"] for a in result["accepted"]] == [1, 4]
    kanra, ryokan = saved(db_session)
    assert (kanra.title, kanra.url) == ("Hotel Kanra Kyoto", "https://www.hotelkanra.jp/kyoto/")
    assert (ryokan.title, ryokan.price_total, ryokan.price_per_night, ryokan.url) == (
        "Machiya Ryokan Sakura",
        None,
        None,
        None,
    )


REJECTIONS = [
    (pick(99), "index", "No offer 99 in this run's search results."),
    (pick(7), "index", "No offer 7 in this run's search results."),
    (pick(0), "index", None),
    (pick(1, 0), "rank", None),
    (pick(1, 11), "rank", None),
    (pick(1, why="<drop>"), "why", None),
    (pick(1, why="w" * 601), "why", None),
    (pick(1, pros="p" * 401), "pros", None),
    (pick(1, cons="c" * 401), "cons", None),
    (pick(1, price=1), "price", None),
]


@pytest.mark.parametrize(("item", "field", "message"), REJECTIONS)
def test_bad_picks_are_rejected_with_reasons(
    client: TestClient, db_session: Session, run: Run, item: dict[str, Any], field: str, message: str | None
) -> None:
    result = submit(client, run, item)

    assert result["accepted"] == [] and result["duplicates"] == []
    [rejected] = result["rejected"]
    errors = {e["field"]: e["msg"] for e in rejected["errors"]}
    assert field in errors, rejected
    if message:
        assert errors[field] == message
    assert saved(db_session) == []
    [logged] = db_session.scalars(select(IngestRejection).where(IngestRejection.run_id == run.id)).all()
    assert (logged.entity, logged.item) == ("lodging_pick", item)
    db_session.refresh(run)
    assert (run.accepted_count, run.rejected_count) == (0, 1)


def test_each_pick_needs_its_own_rank_and_offer(client: TestClient, db_session: Session, run: Run) -> None:
    result = submit(client, run, pick(1, 1), pick(2, 1), pick(1, 2), pick(3, 3))

    assert [a["index"] for a in result["accepted"]] == [1, 3]
    assert [r["index"] for r in result["rejected"]] == [2, 1]
    assert "already used" in result["rejected"][0]["errors"][0]["msg"]
    assert "already picked" in result["rejected"][1]["errors"][0]["msg"]
    # ...and across separate calls in the same run.
    later = submit(client, run, pick(4, 3), pick(4, 4))
    assert [a["index"] for a in later["accepted"]] == [4] and len(later["rejected"]) == 1
    assert len(saved(db_session)) == 3
    assert len(db_session.scalars(select(IngestRejection)).all()) == 3


def test_one_bad_pick_does_not_block_the_rest(client: TestClient, run: Run) -> None:
    result = submit(client, run, pick(1, 1), pick(50, 2), pick(2, 3))

    assert [a["index"] for a in result["accepted"]] == [1, 2]
    assert [r["index"] for r in result["rejected"]] == [50]


def test_a_run_saves_at_most_eight(client: TestClient, db_session: Session, trip: Trip) -> None:
    data = rentals()
    template = data["properties"][0]
    data["properties"] = [
        {**template, "name": f"Place {n}", "link": f"https://example.com/stay/{n}"} for n in range(1, 11)
    ]
    run = add_lodging_run(db_session, trip, data)

    first = submit(client, run, *[pick(n, n) for n in range(1, 9)])
    over = submit(client, run, pick(9, 9))

    assert len(first["accepted"]) == 8 and over["accepted"] == []
    [rejected] = over["rejected"]
    assert "limit" in rejected["errors"][0]["msg"]
    assert len(saved(db_session)) == 8
    too_many = client.post(
        f"/api/agent/v1/runs/{run.id}/lodging-picks",
        json={"picks": [pick(n, n) for n in range(1, 10)]},
        headers=AGENT,
    )
    assert too_many.status_code == 422


def test_a_listing_the_trip_already_has_is_a_duplicate(
    client: TestClient, db_session: Session, trip: Trip, run: Run
) -> None:
    db_session.add(
        LodgingOption(
            trip_id=trip.id,
            title="Stay Inn",
            url=f"{STAY_INN}?check_in=2026-11-09",
            url_normalized=link_preview.normalize_url(STAY_INN),
            added_via="paste",
        )
    )
    db_session.commit()

    result = submit(client, run, pick(1, 1), pick(2, 2), pick(3, 3))

    assert result["duplicates"] == [1]
    assert [a["index"] for a in result["accepted"]] == [2, 3]
    assert result["rejected"] == []
    assert len(saved(db_session)) == 3
    db_session.refresh(run)
    assert (run.accepted_count, run.rejected_count) == (2, 0)
    # The duplicate didn't use up its rank: another place can still take rank 1.
    assert [a["index"] for a in submit(client, run, pick(4, 1))["accepted"]] == [4]


def test_picks_need_the_cached_search(client: TestClient, db_session: Session, run: Run) -> None:
    db_session.execute(delete(PlaceCacheEntry))
    db_session.flush()

    result = submit(client, run, pick(1))

    assert result["accepted"] == []
    assert result["rejected"][0]["errors"][0]["msg"] == "No offer 1 in this run's search results."


def test_picks_never_start_a_search(
    client: TestClient, db_session: Session, run: Run, no_real_network: respx.MockRouter
) -> None:
    searches = mock_search(no_real_network, rentals())
    db_session.execute(delete(PlaceCacheEntry))
    db_session.flush()

    submit(client, run, pick(1))

    assert searches.call_count == 0 and len(no_real_network.calls) == 0


@pytest.mark.parametrize("kind", ["itinerary_agent", "flight_agent", "research_agent"])
def test_only_lodging_runs_can_pick_places(
    client: TestClient, db_session: Session, trip: Trip, kind: str
) -> None:
    other = add_run(db_session, trip, kind)

    response = client.post(
        f"/api/agent/v1/runs/{other.id}/lodging-picks", json={"picks": [pick()]}, headers=AGENT
    )

    assert response.status_code == 422
    assert "Only lodging runs" in response.json()["detail"]
    assert saved(db_session) == []


@pytest.mark.parametrize("state", ["queued", "succeeded", "cancelled"])
def test_only_running_runs_take_picks(client: TestClient, db_session: Session, run: Run, state: str) -> None:
    run.status = state
    db_session.flush()

    response = client.post(
        f"/api/agent/v1/runs/{run.id}/lodging-picks", json={"picks": [pick()]}, headers=AGENT
    )

    assert response.status_code == 409


def test_picks_need_the_agent_key(client: TestClient, run: Run) -> None:
    assert (
        client.post(f"/api/agent/v1/runs/{run.id}/lodging-picks", json={"picks": [pick()]}).status_code == 401
    )


def test_a_run_lists_its_picks_best_first_in_its_outputs(
    client: TestClient, db_session: Session, trip: Trip, run: Run
) -> None:
    submit(client, run, pick(1, 3), pick(2, 1), pick(3, 2))
    db_session.add(LodgingOption(trip_id=trip.id, title="Not from this run", added_via="manual"))
    db_session.flush()

    outputs = client.get(f"/api/v1/runs/{run.id}/outputs").json()

    assert [o["notes"][:11] for o in outputs["lodging"]] == ["AI pick #1:", "AI pick #2:", "AI pick #3:"]
    assert [o["title"][:10] for o in outputs["lodging"]] == ["Guest Hous", "familie - ", "Stay Inn K"]
    assert outputs["lodging"][0]["added_via"] == "agent" and outputs["lodging"][0]["home_currency"] == "USD"
    assert client.get(f"/api/v1/runs/{add_run(db_session, trip).id}/outputs").json()["lodging"] == []
