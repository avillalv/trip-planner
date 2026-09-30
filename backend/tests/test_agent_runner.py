"""The agent runner, driven by a fake `claude` so no subscription usage is spent."""

import json
import sys
import time
from collections.abc import Callable
from datetime import date
from pathlib import Path
from uuid import uuid4

import psutil
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from tests.conftest import make_settings
from tests.factories import add_route, add_run, add_trip
from tripplanner.config import Settings
from tripplanner.models import FlightRoute, Routine, Run, RunEvent, Trip
from tripplanner.services.claude_cli import agent_env
from tripplanner.services.runs import RunLog
from tripplanner.worker.agents import runner
from tripplanner.worker.agents.prompts import SYSTEM_PROMPT, system_prompt
from tripplanner.worker.agents.runner import (
    AgentOutcome,
    build_command,
    mcp_config,
    prepare_run_dir,
    run_agent,
)
from tripplanner.worker.agents.stream import StreamParser

FAKE_CLAUDE = Path(__file__).parent / "fake_claude.py"


def arg_after(argv: list[str], flag: str) -> str:
    return argv[argv.index(flag) + 1]


# --- Command line -----------------------------------------------------------------------------


def test_every_agent_command_uses_sonnet_without_a_fallback() -> None:
    argv = build_command(["claude"], Path("run"), max_turns=40)

    assert arg_after(argv, "--model") == "claude-sonnet-5-5"
    assert argv.count("--model") == 1
    assert not any(a.startswith("--fallback-model") for a in argv)


def test_agents_get_only_web_tools_and_the_trip_bridge() -> None:
    argv = build_command(["claude"], Path("run"), max_turns=40)

    assert arg_after(argv, "--tools") == "WebSearch,WebFetch"
    assert arg_after(argv, "--allowedTools") == "WebSearch,WebFetch,mcp__trip"
    assert {"--restricted", "--strict-mcp-config", "--no-session-persistence"} <= set(argv)
    assert arg_after(argv, "--permission-mode") == "dontAsk"
    assert "WebFetch(domain:www.airbnb.com)" in arg_after(argv, "--disallowedTools").split(",")
    assert not {"--bare", "--dangerously-skip-permissions", "--allow-dangerously-skip-permissions"} & set(
        argv
    )


def test_environment_keeps_runs_on_the_subscription_and_hides_app_secrets() -> None:
    env = agent_env(
        {
            "PATH": "C:/bin",
            "ANTHROPIC_API_KEY": "sk-1",
            "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-opus-5",
            "serpapi_api_key": "s",
            "Database_Url": "postgres://x",
        }
    )

    assert env == {"PATH": "C:/bin"}


def test_background_work_is_pinned_to_sonnet_too() -> None:
    env = runner.run_env({"PATH": "C:/bin", "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-5"})

    assert env["ANTHROPIC_DEFAULT_HAIKU_MODEL"] == runner.BACKGROUND_MODEL
    assert runner.BACKGROUND_MODEL == runner.MODEL == "claude-sonnet-5-5"


def test_mcp_config_holds_no_secrets(test_settings: Settings) -> None:
    run_id = uuid4()
    text = json.dumps(mcp_config(run_id, "http://127.0.0.1:8000"))

    assert str(run_id) in text and "127.0.0.1:8000" in text
    assert test_settings.agent_ingest_api_key.get_secret_value() not in text


def test_the_bridge_is_told_which_kind_of_run_it_serves() -> None:
    args = mcp_config(uuid4(), "http://127.0.0.1:8000", "itinerary_agent")["mcpServers"]["trip"]["args"]

    assert arg_after(args, "--kind") == "itinerary_agent"
    assert (
        arg_after(mcp_config(uuid4(), "http://x")["mcpServers"]["trip"]["args"], "--kind") == "flight_agent"
    )


def test_planning_tool_calls_are_summarized_for_the_log() -> None:
    parser = StreamParser()

    def summary(tool: str, args: dict) -> str:
        block = {"type": "tool_use", "id": "t1", "name": f"mcp__trip__{tool}", "input": args}
        [event] = parser.feed(json.dumps({"type": "assistant", "message": {"content": [block]}}))
        return event.summary

    assert summary("suggest_activities", {"suggestions": [{}, {}, {}]}) == "Suggested 3 things to do"
    assert summary("suggest_activities", {"suggestions": [{}]}) == "Suggested 1 thing to do"
    assert summary("suggest_lodging", {"places": [{}, {}]}) == "Picked 2 places to stay"
    assert summary("suggest_lodging", {"places": [{}]}) == "Picked 1 place to stay"


def test_house_rules_depend_on_the_kind_of_run() -> None:
    assert system_prompt("flight_agent") == SYSTEM_PROMPT == system_prompt("research_agent")
    planner = system_prompt("itinerary_agent")
    assert "planning assistant" in planner and "- suggest_activities:" in planner and "{" not in planner
    assert "suggest_lodging" in system_prompt("lodging_agent")
    assert runner.DEFAULT_LIMITS["itinerary_agent"] == (30, 12)
    assert runner.DEFAULT_LIMITS["lodging_agent"] == (25, 10)


def test_only_recent_run_folders_are_kept(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runner, "KEEP_RUN_DIRS", 3)
    for i in range(5):
        (tmp_path / f"old-{i}").mkdir()
        time.sleep(0.01)

    prepare_run_dir(tmp_path, uuid4())

    assert len(list(tmp_path.iterdir())) == 3


# --- Pipeline ----------------------------------------------------------------------------------


@pytest.fixture
def agent(db_session: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    trip = add_trip(db_session)
    add_route(db_session, trip)
    routine = Routine(
        trip_id=trip.id,
        name="Fare scout",
        kind="flight_agent",
        schedule_cron="0 8 * * *",
        timezone="UTC",
        config={"instructions": "Prefer nonstop flights."},
    )
    db_session.add(routine)
    db_session.flush()
    run = add_run(db_session, trip, routine_id=routine.id)

    monkeypatch.setattr(runner, "find_claude", lambda _settings: [sys.executable, str(FAKE_CLAUDE)])
    monkeypatch.setattr(runner, "WATCH_SECONDS", 0.05)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-must-not-reach-claude")
    record = tmp_path / "record.json"
    monkeypatch.setenv("FAKE_CLAUDE_RECORD", str(record))
    settings = make_settings(agent_runs_dir=tmp_path / "runs")

    def start(scenario: str, is_cancelled: Callable[[], bool] = lambda: False) -> AgentOutcome:
        monkeypatch.setenv("FAKE_CLAUDE_SCENARIO", scenario)
        return run_agent(db_session, run, RunLog(db_session, run), settings, is_cancelled=is_cancelled)

    start.run = run  # type: ignore[attr-defined]
    start.record = record  # type: ignore[attr-defined]
    return start


def events(db: Session, run: Run) -> list[RunEvent]:
    return list(db.scalars(select(RunEvent).where(RunEvent.run_id == run.id).order_by(RunEvent.seq)))


def test_a_successful_run_is_logged_and_measured(agent, db_session: Session) -> None:
    run: Run = agent.run
    run.report = {"status": "ok", "summary": "Two fares found.", "sources_checked": [], "issues": []}
    db_session.flush()

    outcome = agent("success")

    assert outcome == AgentOutcome("succeeded")
    log = events(db_session, run)
    assert [e.type for e in log] == [
        "info",  # starting
        "info",  # Claude's init
        "tool_use",
        "tool_result",
        "tool_use",
        "tool_result",
        "tool_use",
        "warning",  # the blocked fetch
        "text",
        "result",
    ]
    assert log[1].summary.startswith("Claude Code 2.1.283 started with claude-sonnet-5-5")
    assert log[2].summary == "Searched the web for “LAX to Tokyo fares November”"
    assert (log[4].tool_name, log[4].summary) == ("submit_flight_quotes", "Submitted 2 prices")
    assert log[5].summary.startswith("submit_flight_quotes: 2 accepted")
    assert (run.input_tokens, run.output_tokens, str(run.cost_usd_est)) == (33000, 1500, "0.1234")
    assert run.exit_code == 0


def test_the_prompt_command_and_environment_reach_claude(agent, db_session: Session) -> None:
    agent("success")
    seen = json.loads(agent.record.read_text(encoding="utf-8"))
    run: Run = agent.run

    assert arg_after(seen["argv"], "--model") == "claude-sonnet-5-5"
    assert not seen["api_key_leaked"]
    assert seen["background_model"] == runner.BACKGROUND_MODEL
    assert "Prefer nonstop flights." in seen["prompt"] and '"LAX"' in seen["prompt"]
    assert seen["prompt"] == run.prompt
    run_dir = Path(run.log_path)
    assert Path(seen["cwd"]) == run_dir
    assert {p.name for p in run_dir.iterdir()} >= {"system.md", "mcp.json", "prompt.md", "stream.jsonl"}
    assert "sk-must-not-reach-claude" not in json.dumps(run.argv_redacted)


def test_an_itinerary_run_gets_the_planner_prompt_and_tools(agent, db_session: Session) -> None:
    run: Run = agent.run
    run.kind, run.routine_id = "itinerary_agent", None
    run.params = {"mode": "surprise", "message": "We love waterfalls", "day": "2026-11-26"}
    trip = db_session.get(Trip, run.trip_id)
    trip.start_date, trip.end_date = date(2026, 11, 25), date(2026, 11, 27)
    trip.interests = ["waterfalls"]
    db_session.flush()

    outcome = agent("success")
    seen = json.loads(agent.record.read_text(encoding="utf-8"))
    run_dir = Path(run.log_path)

    assert outcome.status == "partial"  # the fake agent never calls finish_run
    assert (run_dir / "system.md").read_text(encoding="utf-8") == system_prompt("itinerary_agent")
    mcp = json.loads((run_dir / "mcp.json").read_text(encoding="utf-8"))
    assert arg_after(mcp["mcpServers"]["trip"]["args"], "--kind") == "itinerary_agent"
    assert arg_after(seen["argv"], "--max-turns") == "30"
    assert seen["prompt"] == run.prompt
    assert "# Task: surprise the travelers" in seen["prompt"]
    assert "<request>We love waterfalls</request>" in seen["prompt"]
    assert "Focus on Thursday, November 26." in seen["prompt"]
    assert '"interests"' in seen["prompt"] and '"waterfalls"' in seen["prompt"]
    assert '"plan"' in seen["prompt"] and '"routes"' not in seen["prompt"] and '"LAX"' not in seen["prompt"]


def test_itinerary_runs_do_not_need_flight_routes(agent, db_session: Session) -> None:
    run: Run = agent.run
    run.kind, run.routine_id = "itinerary_agent", None
    for route in db_session.scalars(select(FlightRoute).where(FlightRoute.trip_id == run.trip_id)):
        route.active = False
    db_session.flush()

    assert agent("success").status == "partial"


def test_a_run_without_a_report_is_partial(agent) -> None:
    outcome = agent("success")

    assert outcome.status == "partial"
    assert "without reporting" in outcome.error
    assert outcome.summary == "Found two fares."


def test_an_expired_sign_in_explains_how_to_fix_it(agent) -> None:
    outcome = agent("auth_error")

    assert outcome.status == "failed"
    assert "/login" in outcome.error


def test_hitting_the_turn_limit_is_partial(agent) -> None:
    outcome = agent("max_turns")

    assert outcome.status == "partial"
    assert "40-turn limit" in outcome.error


def test_a_crash_reports_the_exit_code_and_stderr(agent) -> None:
    outcome = agent("crash")

    assert outcome.status == "failed"
    assert "code 3" in outcome.error and "boom" in outcome.error


def child_pid(db: Session, run: Run) -> int:
    [pid] = [int(e.summary.split()[1]) for e in events(db, run) if e.summary.startswith("child ")]
    return pid


def assert_stopped(pid: int) -> None:
    deadline = time.monotonic() + 5
    while psutil.pid_exists(pid) and time.monotonic() < deadline:
        time.sleep(0.05)
    assert not psutil.pid_exists(pid)


def test_a_model_other_than_sonnet_stops_the_run(agent, db_session: Session) -> None:
    started = time.monotonic()
    outcome = agent("wrong_model")

    assert outcome.status == "failed"
    assert "instead of Sonnet" in outcome.error
    assert time.monotonic() - started < 30


def test_missing_trip_tools_stop_the_run(agent) -> None:
    outcome = agent("mcp_failed")

    assert outcome.status == "failed"
    assert "trip tools didn't start" in outcome.error


def test_timeouts_stop_claude_and_its_children(agent, db_session: Session, monkeypatch) -> None:
    monkeypatch.setattr(runner, "SECONDS_PER_MINUTE", 0.1)  # the default 20 minutes become 2 s

    outcome = agent("hang")

    assert outcome.status == "timed_out"
    assert_stopped(child_pid(db_session, agent.run))


def test_cancel_stops_the_run(agent, db_session: Session) -> None:
    requested = time.monotonic() + 1.0

    outcome = agent("hang", is_cancelled=lambda: time.monotonic() > requested)

    assert outcome.status == "cancelled"
    assert_stopped(child_pid(db_session, agent.run))


def test_worker_shutdown_interrupts_the_run(agent) -> None:
    runner.shutting_down.set()
    try:
        outcome = agent("hang")
    finally:
        runner.shutting_down.clear()

    assert outcome.status == "interrupted"


def test_claude_not_installed(agent, monkeypatch) -> None:
    monkeypatch.setattr(runner, "find_claude", lambda _settings: None)

    outcome = agent("success")

    assert outcome.status == "failed" and "wasn't found" in outcome.error


def test_flight_agents_need_a_route(agent, db_session: Session) -> None:
    run: Run = agent.run
    for route in db_session.scalars(select(FlightRoute).where(FlightRoute.trip_id == run.trip_id)):
        route.active = False
    db_session.flush()

    outcome = agent("success")

    assert outcome.status == "failed" and "no active flight routes" in outcome.error


def test_a_signed_out_claude_fails_before_starting(agent, db_session: Session) -> None:
    outcome = agent("signed_out")

    assert outcome.status == "failed"
    assert "/login" in outcome.error
    assert not agent.record.exists()  # Claude itself was never started
