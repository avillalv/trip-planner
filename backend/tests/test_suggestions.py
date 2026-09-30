"""AI ideas: asking for them, what agents may save, and adding the good ones to the itinerary."""

from datetime import UTC, date, datetime, time, timedelta
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tests.factories import add_person, add_route, add_run, add_trip
from tripplanner.models import (
    Activity,
    ActivitySuggestion,
    IngestRejection,
    ItineraryDay,
    Run,
    Trip,
    TripDestination,
)
from tripplanner.providers import open_meteo as meteo
from tripplanner.services import agent_plan, suggestions
from tripplanner.services.agent_context import PLANNER_RULES, build_context

AGENT = {"Authorization": "Bearer test-agent-key"}
TODAY = date(2026, 9, 29)


@pytest.fixture(autouse=True)
def claude_installed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(suggestions, "find_claude", lambda _settings: ["claude"])


@pytest.fixture
def trip(db_session: Session) -> Trip:
    """Nov 25-30 in Costa Rica, with a booked Copa flight on the 26th (13:28 to 13:51)."""
    trip = add_trip(db_session, "Costa Rica")
    trip.start_date, trip.end_date = date(2026, 11, 25), date(2026, 11, 30)
    trip.destinations = [
        TripDestination(
            position=0,
            name="San José",
            country="Costa Rica",
            lat=9.93,
            lon=-84.08,
            timezone="America/Costa_Rica",
            info_status="skipped",
        ),
        TripDestination(
            position=1, name="La Fortuna", country="Costa Rica", lat=10.47, lon=-84.64, info_status="skipped"
        ),
    ]
    db_session.add(
        Activity(
            trip_id=trip.id,
            day=date(2026, 11, 26),
            start_time=time(13, 28),
            end_time=time(13, 51),
            title="CM 342 · PTY → SJO",
            category="travel",
            status="booked",
            notes="Copa Airlines. Arrives 1:51 PM local time at SJO.",
        )
    )
    db_session.flush()
    return trip


@pytest.fixture
def run(db_session: Session, trip: Trip) -> Run:
    return add_run(db_session, trip, "itinerary_agent", params={"mode": "brainstorm", "message": None})


def idea(**overrides: Any) -> dict[str, Any]:
    item: dict[str, Any] = {
        "title": "Arenal Volcano hot springs",
        "category": "nature",
        "description": "Soak in thermal pools fed by the volcano.",
        "why": "You both like hot springs, and it rains most afternoons.",
        "timing_note": "Go in the evening; the pools are open until 10 pm.",
        "day": "2026-11-28",
        "start_time": "17:00",
        "duration_min": 150,
        "location_name": "Tabacón",
        "url": "https://www.tabacon.com/",
        "sources": ["https://www.tabacon.com/hot-springs/"],
    }
    item.update(overrides)
    return {k: v for k, v in item.items() if v != "<drop>"}


def suggest(client: TestClient, run: Run, *items: dict[str, Any]) -> dict[str, Any]:
    response = client.post(
        f"/api/agent/v1/runs/{run.id}/activity-suggestions", json={"suggestions": list(items)}, headers=AGENT
    )
    assert response.status_code == 200, response.text
    return response.json()


def add_suggestion(db: Session, trip: Trip, **overrides: Any) -> ActivitySuggestion:
    values: dict[str, Any] = {
        "trip_id": trip.id,
        "mode": "brainstorm",
        "title": "Coffee farm tour",
        "category": "food",
        "description": "See how coffee is made.",
        "why": "You like coffee.",
        "timing_note": "",
        "sources": [],
    }
    values.update(overrides)
    row = ActivitySuggestion(**values)
    db.add(row)
    db.flush()
    return row


# --- Asking for ideas ---------------------------------------------------------------------------


def test_asking_queues_an_itinerary_run(client: TestClient, db_session: Session, trip: Trip) -> None:
    body = {"mode": "surprise", "message": "  Waterfalls, please  ", "day": "2026-11-27"}

    response = client.post(f"/api/v1/trips/{trip.id}/ai/ideas", json=body)

    assert response.status_code == 202
    out = response.json()
    assert (out["kind"], out["status"], out["trigger"], out["routine_id"]) == (
        "itinerary_agent",
        "queued",
        "manual",
        None,
    )
    assert out["params"] == {"mode": "surprise", "message": "Waterfalls, please", "day": "2026-11-27"}
    assert db_session.get(Run, out["id"]) is not None


def test_an_empty_request_means_brainstorm_the_whole_trip(client: TestClient, trip: Trip) -> None:
    out = client.post(f"/api/v1/trips/{trip.id}/ai/ideas", json={}).json()

    assert out["params"] == {"mode": "brainstorm", "message": None, "day": None}


@pytest.mark.parametrize("state", ["queued", "running"])
def test_one_request_at_a_time(client: TestClient, db_session: Session, trip: Trip, state: str) -> None:
    add_run(db_session, trip, "itinerary_agent", status=state)

    response = client.post(f"/api/v1/trips/{trip.id}/ai/ideas", json={})

    assert response.status_code == 409
    assert "still working on your last request" in response.json()["detail"]


def test_finished_runs_and_other_trips_do_not_block(
    client: TestClient, db_session: Session, trip: Trip
) -> None:
    add_run(db_session, trip, "itinerary_agent", status="succeeded")
    add_run(db_session, add_trip(db_session, "Iceland"), "itinerary_agent", status="running")

    assert client.post(f"/api/v1/trips/{trip.id}/ai/ideas", json={}).status_code == 202


def test_a_trip_without_dates_cannot_get_ideas(client: TestClient, db_session: Session) -> None:
    undated = add_trip(db_session, "Someday")

    response = client.post(f"/api/v1/trips/{undated.id}/ai/ideas", json={})

    assert response.status_code == 422
    assert response.json()["detail"] == "Add the trip's dates first so ideas can be placed on days."


def test_the_day_must_be_inside_the_trip(client: TestClient, trip: Trip) -> None:
    response = client.post(f"/api/v1/trips/{trip.id}/ai/ideas", json={"day": "2026-12-01"})

    assert response.status_code == 422
    assert "Nov 25 and Nov 30" in response.json()["detail"]


def test_unknown_trips_and_bad_bodies(client: TestClient, trip: Trip) -> None:
    assert client.post("/api/v1/trips/999999/ai/ideas", json={}).status_code == 404
    assert client.post(f"/api/v1/trips/{trip.id}/ai/ideas", json={"mode": "chaos"}).status_code == 422
    assert client.post(f"/api/v1/trips/{trip.id}/ai/ideas", json={"message": "x" * 1001}).status_code == 422


def test_asking_needs_the_agent_key(client: TestClient, use_settings, trip: Trip) -> None:
    use_settings(agent_ingest_api_key=None)

    response = client.post(f"/api/v1/trips/{trip.id}/ai/ideas", json={})

    assert response.status_code == 503
    assert "AGENT_INGEST_API_KEY" in response.json()["detail"]


def test_asking_needs_claude_code(client: TestClient, monkeypatch: pytest.MonkeyPatch, trip: Trip) -> None:
    monkeypatch.setattr(suggestions, "find_claude", lambda _settings: None)

    response = client.post(f"/api/v1/trips/{trip.id}/ai/ideas", json={})

    assert response.status_code == 503
    assert "Claude Code wasn't found" in response.json()["detail"]


# --- What agents may save -------------------------------------------------------------------------


def test_good_suggestions_are_saved_as_new(
    client: TestClient, db_session: Session, trip: Trip, run: Run
) -> None:
    run.params = {"mode": "surprise"}
    db_session.flush()

    result = suggest(
        client, run, idea(), idea(title="Sunrise at the lake", day="<drop>", start_time="<drop>")
    )

    assert [a["index"] for a in result["accepted"]] == [0, 1]
    assert result["rejected"] == [] and result["duplicates"] == []
    first, second = (db_session.get(ActivitySuggestion, a["id"]) for a in result["accepted"])
    assert (first.status, first.mode, first.run_id, first.trip_id) == ("new", "surprise", run.id, trip.id)
    assert (first.day, first.start_time, first.duration_min) == (date(2026, 11, 28), time(17), 150)
    assert first.sources == ["https://www.tabacon.com/hot-springs/"]
    assert (second.day, second.start_time, second.duration_min) == (None, None, 150)
    db_session.refresh(run)
    assert (run.accepted_count, run.rejected_count) == (2, 0)


def test_the_mode_comes_from_the_request(client: TestClient, db_session: Session, run: Run) -> None:
    [accepted] = suggest(client, run, idea())["accepted"]

    assert db_session.get(ActivitySuggestion, accepted["id"]).mode == "brainstorm"


REJECTIONS = [
    ({"day": "2026-12-25"}, "day", "must be 2026-11-25 to 2026-11-30"),
    ({"day": "<drop>"}, "start_time", "needs a day"),
    ({"duration_min": 10}, "duration_min", None),
    ({"duration_min": 721}, "duration_min", None),
    (
        {"start_time": "13:00", "day": "2026-11-26", "duration_min": 60},
        "start_time",
        "overlaps CM 342 · PTY → SJO (13:28–13:51)",
    ),
    ({"start_time": "13:00", "day": "2026-11-26", "duration_min": 120}, "start_time", "overlaps CM 342"),
    ({"start_time": "13:40", "day": "2026-11-26", "duration_min": 30}, "start_time", "overlaps CM 342"),
    ({"url": "https://www.airbnb.com/rooms/42"}, "url", "airbnb.com"),
    ({"url": "http://localhost:8000/x"}, "url", "public website"),
    ({"sources": ["https://ok.example.com/a", "https://www.vrbo.com/9"]}, "sources.1", "vrbo.com"),
    ({"category": "spa"}, "category", None),
    ({"why": "<drop>"}, "why", None),
    ({"title": "  "}, "title", None),
    ({"mood": "lazy"}, "mood", None),
    ({"sources": ["https://a.example.com"] * 7}, "sources", None),
]


@pytest.mark.parametrize(("changes", "field", "message"), REJECTIONS)
def test_bad_suggestions_are_rejected_with_reasons(
    client: TestClient,
    db_session: Session,
    run: Run,
    changes: dict[str, Any],
    field: str,
    message: str | None,
) -> None:
    result = suggest(client, run, idea(**changes))

    assert result["accepted"] == []
    [rejected] = result["rejected"]
    errors = {e["field"]: e["msg"] for e in rejected["errors"]}
    assert field in errors, rejected
    if message:
        assert message in errors[field]
    assert db_session.scalars(select(ActivitySuggestion)).all() == []
    [logged] = db_session.scalars(select(IngestRejection).where(IngestRejection.run_id == run.id)).all()
    assert logged.entity == "activity_suggestion"
    db_session.refresh(run)
    assert (run.accepted_count, run.rejected_count) == (0, 1)


def test_one_bad_suggestion_does_not_block_the_rest(client: TestClient, run: Run) -> None:
    result = suggest(
        client, run, idea(), idea(title="Lava walk", day="2027-01-01"), idea(title="Night market")
    )

    assert [a["index"] for a in result["accepted"]] == [0, 2]
    assert [r["index"] for r in result["rejected"]] == [1]


def test_touching_a_booked_plan_is_fine(client: TestClient, run: Run) -> None:
    # The flight lands at 13:51; a walk from 13:51 and another ending exactly at 13:28 don't overlap it.
    after = idea(title="Walk after landing", day="2026-11-26", start_time="13:51", duration_min=30)
    before = idea(title="Coffee before the flight", day="2026-11-26", start_time="12:58", duration_min=30)
    other_day = idea(title="Museum", day="2026-11-27", start_time="13:30", duration_min=60)

    result = suggest(client, run, after, before, other_day)

    assert len(result["accepted"]) == 3 and result["rejected"] == []


def test_an_unfinished_slot_is_not_checked_against_flights(client: TestClient, run: Run) -> None:
    # Without a duration there is nothing to compare, so the agent's timing_note has to carry the buffer.
    result = suggest(client, run, idea(day="2026-11-26", start_time="13:30", duration_min="<drop>"))

    assert len(result["accepted"]) == 1


def test_booked_plans_that_run_past_midnight_or_have_no_end(
    client: TestClient, db_session: Session, trip: Trip, run: Run
) -> None:
    late = dict(trip_id=trip.id, category="travel", status="booked")
    db_session.add_all(
        [
            Activity(
                title="Night bus", day=date(2026, 11, 27), start_time=time(22), end_time=time(1), **late
            ),
            Activity(title="Ferry", day=date(2026, 11, 29), start_time=time(9), **late),
        ]
    )
    db_session.flush()
    at = lambda title, day, start: idea(title=title, day=day, start_time=start, duration_min=30)  # noqa: E731

    result = suggest(
        client,
        run,
        at("Late dinner", "2026-11-27", "23:00"),
        at("Early dinner", "2026-11-27", "21:15"),
        at("Ferry harbour walk", "2026-11-29", "09:30"),
        at("After the ferry", "2026-11-29", "10:00"),
    )

    assert [r["index"] for r in result["rejected"]] == [0, 2]
    assert "overlaps Night bus (22:00–01:00)" in result["rejected"][0]["errors"][0]["msg"]
    assert "overlaps Ferry (09:00)" in result["rejected"][1]["errors"][0]["msg"]


def test_planned_and_idea_activities_do_not_block_times(
    client: TestClient, db_session: Session, trip: Trip, run: Run
) -> None:
    db_session.add(
        Activity(
            trip_id=trip.id, title="Lunch", day=date(2026, 11, 28), start_time=time(17), status="planned"
        )
    )
    db_session.flush()

    assert len(suggest(client, run, idea())["accepted"]) == 1


def test_titles_the_trip_already_has_are_duplicates(
    client: TestClient, db_session: Session, trip: Trip, run: Run
) -> None:
    add_suggestion(db_session, trip, title="Coffee farm tour", status="dismissed")
    db_session.add(Activity(trip_id=trip.id, title="Visit the Post Office", status="idea"))
    db_session.flush()

    result = suggest(
        client,
        run,
        idea(title="  coffee FARM tour "),
        idea(title="Visit the post office"),
        idea(title="Zip lining"),
        idea(title="ZIP LINING"),
    )

    assert [a["index"] for a in result["accepted"]] == [2]
    assert result["duplicates"] == [0, 1, 3] and result["rejected"] == []
    db_session.refresh(run)
    assert (run.accepted_count, run.rejected_count) == (1, 0)


def test_a_run_saves_at_most_forty(client: TestClient, db_session: Session, run: Run) -> None:
    for batch in range(2):
        result = suggest(client, run, *[idea(title=f"Idea {batch}-{i}") for i in range(20)])
        assert len(result["accepted"]) == 20

    result = suggest(client, run, idea(title="One too many"), idea(title="Idea 0-0"))

    assert result["accepted"] == [] and result["duplicates"] == [1]
    [rejected] = result["rejected"]
    assert "limit" in rejected["errors"][0]["msg"]
    assert len(db_session.scalars(select(ActivitySuggestion)).all()) == 40


def test_only_itinerary_runs_can_suggest_activities(
    client: TestClient, db_session: Session, trip: Trip
) -> None:
    other = add_run(db_session, trip, "research_agent")

    response = client.post(
        f"/api/agent/v1/runs/{other.id}/activity-suggestions", json={"suggestions": [idea()]}, headers=AGENT
    )

    assert response.status_code == 422
    assert "Only itinerary runs" in response.json()["detail"]
    assert db_session.scalars(select(ActivitySuggestion)).all() == []


@pytest.mark.parametrize("state", ["queued", "succeeded", "cancelled"])
def test_only_running_runs_take_suggestions(
    client: TestClient, db_session: Session, run: Run, state: str
) -> None:
    run.status = state
    db_session.flush()

    response = client.post(
        f"/api/agent/v1/runs/{run.id}/activity-suggestions", json={"suggestions": [idea()]}, headers=AGENT
    )

    assert response.status_code == 409


def test_suggestions_need_the_agent_key(client: TestClient, run: Run) -> None:
    url = f"/api/agent/v1/runs/{run.id}/activity-suggestions"

    assert client.post(url, json={"suggestions": [idea()]}).status_code == 401


# --- Reading and deciding -------------------------------------------------------------------------


def test_listing_shows_new_and_added_by_default(client: TestClient, db_session: Session, trip: Trip) -> None:
    add_suggestion(db_session, trip, title="New one")
    add_suggestion(db_session, trip, title="Added one", status="added")
    add_suggestion(db_session, trip, title="Dismissed one", status="dismissed")
    add_suggestion(db_session, add_trip(db_session, "Iceland"), title="Other trip")

    default = client.get(f"/api/v1/trips/{trip.id}/suggestions").json()
    dismissed = client.get(f"/api/v1/trips/{trip.id}/suggestions", params={"status": "dismissed"}).json()
    both = client.get(
        f"/api/v1/trips/{trip.id}/suggestions", params=[("status", "new"), ("status", "dismissed")]
    ).json()

    assert sorted(s["title"] for s in default) == ["Added one", "New one"]
    assert [s["title"] for s in dismissed] == ["Dismissed one"]
    assert sorted(s["title"] for s in both) == ["Dismissed one", "New one"]
    assert client.get("/api/v1/trips/999999/suggestions").status_code == 404
    assert client.get(f"/api/v1/trips/{trip.id}/suggestions", params={"status": "maybe"}).status_code == 422


def test_listing_puts_the_newest_run_first_then_day_and_time(
    client: TestClient, db_session: Session, trip: Trip
) -> None:
    older = add_run(db_session, trip, "itinerary_agent", queued_at=datetime.now(UTC) - timedelta(hours=2))
    newer = add_run(db_session, trip, "itinerary_agent", queued_at=datetime.now(UTC) - timedelta(hours=1))
    add_suggestion(db_session, trip, title="Old, late", run_id=older.id, day=date(2026, 11, 29))
    add_suggestion(db_session, trip, title="New, undated", run_id=newer.id)
    add_suggestion(
        db_session, trip, title="New, evening", run_id=newer.id, day=date(2026, 11, 27), start_time=time(19)
    )
    add_suggestion(
        db_session, trip, title="New, morning", run_id=newer.id, day=date(2026, 11, 27), start_time=time(8)
    )
    add_suggestion(db_session, trip, title="Old, early", run_id=older.id, day=date(2026, 11, 26))

    titles = [s["title"] for s in client.get(f"/api/v1/trips/{trip.id}/suggestions").json()]

    assert titles == ["New, morning", "New, evening", "New, undated", "Old, early", "Old, late"]


def test_the_end_time_is_start_plus_duration(client: TestClient, db_session: Session, trip: Trip) -> None:
    add_suggestion(
        db_session, trip, title="Tour", day=date(2026, 11, 27), start_time=time(9, 30), duration_min=90
    )
    add_suggestion(
        db_session, trip, title="Show", day=date(2026, 11, 27), start_time=time(23), duration_min=120
    )
    add_suggestion(db_session, trip, title="Wander", day=date(2026, 11, 27), start_time=time(12))
    add_suggestion(db_session, trip, title="Idea", duration_min=60)

    ends = {s["title"]: s["end_time"] for s in client.get(f"/api/v1/trips/{trip.id}/suggestions").json()}

    assert ends == {"Tour": "11:00:00", "Show": "01:00:00", "Wander": None, "Idea": None}


def test_dismissing_and_restoring(client: TestClient, db_session: Session, trip: Trip) -> None:
    row = add_suggestion(db_session, trip)

    gone = client.patch(f"/api/v1/suggestions/{row.id}", json={"status": "dismissed"})
    back = client.patch(f"/api/v1/suggestions/{row.id}", json={"status": "new"})

    assert (gone.status_code, gone.json()["status"]) == (200, "dismissed")
    assert (back.status_code, back.json()["status"]) == (200, "new")
    assert client.patch(f"/api/v1/suggestions/{row.id}", json={"status": "added"}).status_code == 422
    assert client.patch("/api/v1/suggestions/999999", json={"status": "new"}).status_code == 404


def test_an_added_suggestion_cannot_be_dismissed(client: TestClient, db_session: Session, trip: Trip) -> None:
    row = add_suggestion(db_session, trip)
    assert client.post(f"/api/v1/suggestions/{row.id}/add").status_code == 201

    response = client.patch(f"/api/v1/suggestions/{row.id}", json={"status": "dismissed"})

    assert response.status_code == 409


def test_adding_plans_the_activity_at_its_slot(
    client: TestClient, db_session: Session, trip: Trip, run: Run
) -> None:
    [accepted] = suggest(client, run, idea())["accepted"]

    response = client.post(f"/api/v1/suggestions/{accepted['id']}/add", json={})

    assert response.status_code == 201
    activity = response.json()
    assert (activity["title"], activity["category"], activity["status"]) == (
        "Arenal Volcano hot springs",
        "nature",
        "planned",
    )
    assert (activity["day"], activity["start_time"], activity["end_time"]) == (
        "2026-11-28",
        "17:00:00",
        "19:30:00",
    )
    assert (activity["location_name"], activity["url"]) == ("Tabacón", "https://www.tabacon.com/")
    assert activity["notes"] == (
        "Soak in thermal pools fed by the volcano.\n\n"
        "Why: You both like hot springs, and it rains most afternoons.\n"
        "Timing: Go in the evening; the pools are open until 10 pm.\n"
        "Sources: https://www.tabacon.com/hot-springs/"
    )
    row = db_session.get(ActivitySuggestion, accepted["id"])
    assert (row.status, row.activity_id) == ("added", activity["id"])
    assert db_session.get(Activity, activity["id"]).trip_id == trip.id


def test_adding_as_an_idea_leaves_out_the_day_and_times(client: TestClient, run: Run) -> None:
    [accepted] = suggest(client, run, idea())["accepted"]

    activity = client.post(f"/api/v1/suggestions/{accepted['id']}/add", json={"as_idea": True}).json()

    assert (activity["status"], activity["day"], activity["start_time"], activity["end_time"]) == (
        "idea",
        None,
        None,
        None,
    )


def test_a_suggestion_without_a_day_is_added_as_an_idea(
    client: TestClient, db_session: Session, trip: Trip
) -> None:
    row = add_suggestion(
        db_session, trip, url=None, sources=["https://a.example.com/x", "https://b.example.com"]
    )

    activity = client.post(f"/api/v1/suggestions/{row.id}/add").json()

    assert (activity["status"], activity["day"]) == ("idea", None)
    assert activity["url"] == "https://a.example.com/x"
    assert activity["notes"].endswith("Sources: https://a.example.com/x https://b.example.com")


def test_a_day_without_a_time_is_planned_for_any_time(
    client: TestClient, db_session: Session, trip: Trip
) -> None:
    row = add_suggestion(db_session, trip, day=date(2026, 11, 27), duration_min=90)

    activity = client.post(f"/api/v1/suggestions/{row.id}/add").json()

    assert (activity["status"], activity["day"], activity["start_time"], activity["end_time"]) == (
        "planned",
        "2026-11-27",
        None,
        None,
    )


def test_notes_are_cut_to_the_activity_limit(client: TestClient, db_session: Session, trip: Trip) -> None:
    row = add_suggestion(
        db_session, trip, description="d" * 1500, sources=[f"https://x.example.com/{'p' * 1900}"] * 3
    )

    activity = client.post(f"/api/v1/suggestions/{row.id}/add").json()

    assert len(activity["notes"]) == 4000


def test_adding_twice_is_refused_until_the_activity_is_deleted(
    client: TestClient, db_session: Session, trip: Trip
) -> None:
    row = add_suggestion(db_session, trip)
    first = client.post(f"/api/v1/suggestions/{row.id}/add").json()

    again = client.post(f"/api/v1/suggestions/{row.id}/add")
    client.delete(f"/api/v1/activities/{first['id']}", params={"version": first["version"]})
    third = client.post(f"/api/v1/suggestions/{row.id}/add")

    assert again.status_code == 409
    assert third.status_code == 201 and third.json()["id"] != first["id"]
    assert client.patch(f"/api/v1/suggestions/{row.id}", json={"status": "dismissed"}).status_code == 409
    assert client.post("/api/v1/suggestions/999999/add").status_code == 404


def test_a_deleted_activity_frees_its_suggestion_to_be_dismissed(
    client: TestClient, db_session: Session, trip: Trip
) -> None:
    row = add_suggestion(db_session, trip)
    added = client.post(f"/api/v1/suggestions/{row.id}/add").json()
    client.delete(f"/api/v1/activities/{added['id']}", params={"version": added["version"]})

    response = client.patch(f"/api/v1/suggestions/{row.id}", json={"status": "dismissed"})

    assert response.status_code == 200 and response.json()["activity_id"] is None


def test_a_run_lists_its_suggestions_in_its_outputs(
    client: TestClient, db_session: Session, trip: Trip, run: Run
) -> None:
    suggest(client, run, idea(), idea(title="Sunrise walk", day="2026-11-27", start_time="06:00"))
    add_suggestion(db_session, trip, title="From another run")

    outputs = client.get(f"/api/v1/runs/{run.id}/outputs").json()

    assert [s["title"] for s in outputs["suggestions"]] == ["Sunrise walk", "Arenal Volcano hot springs"]
    assert outputs["suggestions"][0]["end_time"] == "08:30:00"


# --- The task an itinerary run works from ---------------------------------------------------------


def forecast(request: httpx.Request) -> httpx.Response:
    p = request.url.params
    first, last = date.fromisoformat(p["start_date"]), date.fromisoformat(p["end_date"])
    days = [first + timedelta(days=i) for i in range((last - first).days + 1)]
    daily = {
        "time": [d.isoformat() for d in days],
        "temperature_2m_max": [80.4] * len(days),
        "temperature_2m_min": [70.2] * len(days),
        "precipitation_sum": [0.2] * len(days),
    }
    if "precipitation_probability_max" in p["daily"]:
        daily["precipitation_probability_max"] = [45] * len(days)
    return httpx.Response(200, json={"daily": daily})


def plan_for(db: Session, run: Run) -> dict[str, Any]:
    plan = agent_plan.build_plan(db, run, TODAY)
    assert plan is not None
    return plan


def test_the_plan_lists_days_with_place_weather_and_fixed_plans(
    db_session: Session, trip: Trip, run: Run, no_real_network: respx.MockRouter
) -> None:
    no_real_network.get(meteo.ARCHIVE_URL).mock(side_effect=forecast)
    trip.interests = ["hot springs", "street art"]
    add = lambda **v: db_session.add(Activity(trip_id=trip.id, **v))  # noqa: E731
    add(
        title="Zip line",
        day=date(2026, 11, 26),
        start_time=time(9),
        end_time=time(11),
        category="nature",
        status="planned",
    )
    add(title="Buy a SIM card", day=date(2026, 11, 26), category="other", status="planned")
    add(title="Mercado Central", category="shopping", status="idea")
    add_suggestion(db_session, trip, title="Old idea", day=date(2026, 11, 27), status="dismissed")
    add_suggestion(db_session, trip, title="Undated idea")
    db_session.flush()
    run.params = {"mode": "brainstorm", "message": "Something relaxing", "day": "2026-11-26"}

    plan = plan_for(db_session, run)

    assert (plan["mode"], plan["request"], plan["focus_day"]) == (
        "brainstorm",
        "Something relaxing",
        "2026-11-26",
    )
    assert plan["interests"] == ["hot springs", "street art"]
    assert [d["date"] for d in plan["days"]] == [f"2026-11-{n}" for n in range(25, 31)]
    day = plan["days"][1]
    assert (day["weekday"], day["destination"]) == ("Thursday", "San José, Costa Rica")
    assert day["weather"] == {"kind": "typical", "high_f": 80, "low_f": 70, "wet_days_pct": 100}
    assert [(p["title"], p["start"], p["end"], p["status"]) for p in day["plans"]] == [
        ("Zip line", "09:00", "11:00", "planned"),
        ("CM 342 · PTY → SJO", "13:28", "13:51", "booked"),
        ("Buy a SIM card", None, None, "planned"),
    ]
    assert day["plans"][1]["category"] == "travel"
    assert plan["ideas"] == ["Mercado Central"]
    assert plan["already_suggested"] == [
        {"title": "Undated idea", "day": None, "status": "new"},
        {"title": "Old idea", "day": "2026-11-27", "status": "dismissed"},
    ]


def test_forecast_days_carry_the_rain_chance(
    db_session: Session, trip: Trip, run: Run, no_real_network: respx.MockRouter
) -> None:
    no_real_network.get(meteo.FORECAST_URL).mock(side_effect=forecast)
    trip.start_date, trip.end_date = date(2026, 10, 1), date(2026, 10, 2)
    db_session.flush()

    [first, _] = plan_for(db_session, run)["days"]

    assert first["weather"] == {"kind": "forecast", "high_f": 80, "low_f": 70, "rain_chance": 45}


def test_a_day_the_traveler_moved_uses_that_destination(db_session: Session, trip: Trip, run: Run) -> None:
    fortuna = trip.destinations[1]
    db_session.add(ItineraryDay(trip_id=trip.id, day=date(2026, 11, 27), destination_id=fortuna.id))
    db_session.flush()

    days = plan_for(db_session, run)["days"]

    assert [d["destination"] for d in days[:3]] == [
        "San José, Costa Rica",
        "San José, Costa Rica",
        "La Fortuna, Costa Rica",
    ]


def test_weather_trouble_leaves_the_weather_out_without_stopping_the_plan(
    db_session: Session,
    trip: Trip,
    run: Run,
    no_real_network: respx.MockRouter,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    no_real_network.get(meteo.ARCHIVE_URL).mock(return_value=httpx.Response(500))
    assert {d["weather"] for d in plan_for(db_session, run)["days"]} == {None}

    def explode(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("weather is down")

    monkeypatch.setattr(agent_plan.weather, "trip_weather", explode)
    days = plan_for(db_session, run)["days"]

    assert {d["weather"] for d in days} == {None}
    assert days[1]["plans"][0]["title"] == "CM 342 · PTY → SJO"


def test_earlier_requests_are_the_last_five_typed_messages_of_other_runs(
    db_session: Session, trip: Trip, run: Run
) -> None:
    now = datetime.now(UTC)
    for hours, message in enumerate(["oldest", "no one reads this", None, "", "b", "c", "d", "e"], start=1):
        add_run(
            db_session,
            trip,
            "itinerary_agent",
            status="succeeded",
            params={"mode": "brainstorm", "message": message},
            queued_at=now - timedelta(hours=10 - hours),
        )
    add_run(db_session, trip, "flight_agent", params={"message": "not an itinerary run"})

    earlier = plan_for(db_session, run)["earlier_requests"]

    assert earlier == ["e", "d", "c", "b"]  # newest first; the last five runs, blanks dropped


@pytest.mark.parametrize(
    ("travelers", "routes", "expected"), [(2, [(3, 1)], 2), (0, [(2, 1), (2, 2)], 4), (0, [], 2)]
)
def test_party_size(
    db_session: Session, trip: Trip, run: Run, travelers: int, routes: list, expected: int
) -> None:
    trip.travelers = [add_person(db_session, f"Traveler {n}") for n in range(travelers)]
    for adults, children in routes:
        add_route(db_session, trip, adults=adults, children=children)
    db_session.expire(trip, ["routes"])

    assert plan_for(db_session, run)["party_size"] == expected


def test_the_plan_keeps_notes_and_traveler_names_out(db_session: Session, trip: Trip, run: Run) -> None:
    trip.travelers = [add_person(db_session, "Marisol Quintanilla")]
    trip.notes = "Anniversary surprise: don't tell Marisol"
    db_session.add(
        Activity(
            trip_id=trip.id,
            title="Dinner",
            day=date(2026, 11, 27),
            notes="Reservation under Quintanilla, code 8841",
        )
    )
    db_session.flush()

    context = build_context(db_session, run)

    text = context.model_dump_json()
    assert context.plan is not None and context.trip["travelers"] == 1
    for private in ("Marisol", "Quintanilla", "Anniversary", "8841", "Arrives 1:51 PM"):
        assert private not in text


def test_itinerary_runs_get_planner_rules_and_no_routes(db_session: Session, trip: Trip, run: Run) -> None:
    add_route(db_session, trip)

    context = build_context(db_session, run)

    assert context.routes == [] and context.rules == PLANNER_RULES
    assert context.plan is not None and context.blocked_domains


def test_flight_runs_have_no_plan(db_session: Session, trip: Trip) -> None:
    add_route(db_session, trip)

    context = build_context(db_session, add_run(db_session, trip, "flight_agent"))

    assert context.plan is None and len(context.routes) == 1


def test_get_task_returns_the_plan(client: TestClient, run: Run) -> None:
    body = client.get(f"/api/agent/v1/runs/{run.id}/context", headers=AGENT).json()

    assert body["kind"] == "itinerary_agent" and body["routes"] == []
    assert body["plan"]["mode"] == "brainstorm" and len(body["plan"]["days"]) == 6
