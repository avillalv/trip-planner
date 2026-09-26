"""`trip-planner agent-smoke`: one real flight-agent run against a throwaway trip in the TEST database.

It starts its own web server on a free local port (the agent's tools save through it), runs Claude
exactly as a routine would, and prints what happened. It uses your Claude subscription for one run.
"""

import socket
import threading
import time
from datetime import UTC, date, datetime, timedelta

import httpx
import uvicorn
from sqlalchemy import select

from tripplanner import __version__
from tripplanner.config import get_settings, override_settings
from tripplanner.db import new_session
from tripplanner.migrate import upgrade
from tripplanner.models import FlightQuote, FlightRoute, Run, Trip, TripDestination
from tripplanner.services import fx
from tripplanner.services.runs import RunLog, finish
from tripplanner.worker.agents.runner import run_agent


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start_server(port: int) -> tuple[uvicorn.Server, threading.Thread]:
    from tripplanner.main import create_app

    config = uvicorn.Config(
        create_app(), host="127.0.0.1", port=port, log_level="warning", proxy_headers=False
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True, name="smoke-web")
    thread.start()
    deadline = time.monotonic() + 20
    while not server.started:
        if time.monotonic() > deadline or not thread.is_alive():
            raise RuntimeError("The temporary web server didn't start.")
        time.sleep(0.1)
    return server, thread


def _smoke_trip(today: date) -> tuple[int, int]:
    """A trip about six weeks out with one flexible route, so the agent has real dates to search."""
    depart = today + timedelta(days=42)
    with new_session() as db:
        trip = Trip(
            name="Agent smoke test",
            start_date=depart,
            end_date=depart + timedelta(days=8),
            home_currency="USD",
            travelers=[],
            destinations=[
                TripDestination(
                    position=0,
                    name="Tokyo",
                    country="Japan",
                    country_code="JP",
                    lat=35.68,
                    lon=139.69,
                    timezone="Asia/Tokyo",
                    info_status="skipped",
                )
            ],
        )
        db.add(trip)
        db.flush()
        route = FlightRoute(
            trip_id=trip.id,
            label="Smoke test",
            origin_codes=["LAX"],
            destination_codes=["HND", "NRT"],
            trip_type="round_trip",
            depart_from=depart,
            depart_to=depart + timedelta(days=2),
            min_nights=7,
            max_nights=9,
            adults=2,
            children=0,
            cabin="economy",
            sources=[],
            active=True,
        )
        db.add(route)
        db.commit()
        return trip.id, route.id


def run_smoke() -> int:
    settings = get_settings()
    if not settings.test_database_url:
        print("TEST_DATABASE_URL isn't set in .env, so there's nowhere safe to run the smoke test.")
        return 1
    port = _free_port()
    override_settings(settings.model_copy(update={"database_url": settings.test_database_url, "port": port}))
    upgrade(settings.test_database_url)
    print("Using the TEST database (pytest wipes it) and a temporary server on port", port)

    server, thread = _start_server(port)
    try:
        trip_id, route_id = _smoke_trip(datetime.now(UTC).date())
        with new_session() as db:
            with httpx.Client(timeout=30, headers={"User-Agent": f"TripPlanner/{__version__}"}) as http:
                fx.refresh_rates(db, http)
            run = Run(
                trip_id=trip_id,
                kind="flight_agent",
                trigger="manual",
                status="running",
                params={"route_ids": [route_id]},
                started_at=datetime.now(UTC),
            )
            db.add(run)
            db.commit()
            print(f"Run {run.id}: starting Claude. This takes a few minutes; Ctrl+C stops it.\n")
            log = RunLog(db, run)
            outcome = run_agent(db, run, log)
            finish(db, run, outcome.status, outcome.summary, outcome.error)
            db.refresh(run)

            print(f"Status:   {run.status}")
            if run.summary:
                print(f"Summary:  {run.summary}")
            if run.error:
                print(f"Problem:  {run.error}")
            print(f"Saved:    {run.accepted_count}   Rejected: {run.rejected_count}")
            if run.input_tokens:
                tokens = run.input_tokens + (run.output_tokens or 0)
                print(f"Tokens:   {tokens:,}   ~${run.cost_usd_est} at API prices")
            print(f"Log:      {log.seq} events" + (f"; files in {run.log_path}" if run.log_path else ""))
            quotes = db.scalars(
                select(FlightQuote).where(FlightQuote.run_id == run.id).order_by(FlightQuote.price_home)
            )
            for q in quotes:
                dates = f"{q.depart_date} to {q.return_date}" if q.return_date else str(q.depart_date)
                print(f"  {q.origin}-{q.destination} {dates}: {q.currency} {q.price_total}  {q.source_url}")
            return 0 if run.status in ("succeeded", "partial") else 1
    finally:
        server.should_exit = True
        thread.join(timeout=10)
