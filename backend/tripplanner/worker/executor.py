"""Run a claimed run to completion, whatever its kind, and record the outcome."""

import logging
from datetime import UTC, datetime
from uuid import UUID

import httpx

from tripplanner import __version__
from tripplanner.config import get_settings
from tripplanner.db import new_session
from tripplanner.models import Run, Trip
from tripplanner.services.runs import RunLog, finish
from tripplanner.worker.jobs.flight_prices import Cancelled, JobContext, run_flight_prices

log = logging.getLogger(__name__)


def execute_run(run_id: UUID) -> None:
    with new_session() as db:
        run = db.get(Run, run_id)
        if run is None:
            return
        run_log = RunLog(db, run)
        try:
            trip = db.get(Trip, run.trip_id)
            if trip is None:
                finish(db, run, "failed", error="The trip no longer exists.")
                return
            if run.kind != "flight_api":
                finish(db, run, "failed", error=f"Runs of kind '{run.kind}' aren't supported yet.")
                return
            with httpx.Client(timeout=60, headers={"User-Agent": f"TripPlanner/{__version__}"}) as http:
                ctx = JobContext(db, run, trip, run_log, http, get_settings(), datetime.now(UTC))
                status, summary = run_flight_prices(ctx)
            finish(db, run, status, summary)
        except Cancelled:
            db.rollback()
            run_log.warning("Stopped on request.")
            finish(db, run, "cancelled", summary="Cancelled while running; prices found so far were kept.")
        except Exception as exc:
            log.exception("Run %s failed", run_id)
            db.rollback()
            run_log.error(f"Unexpected error: {exc}")
            finish(db, run, "failed", error=str(exc))
