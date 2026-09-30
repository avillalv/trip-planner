"""The ingest API that agent runs write through (via the MCP bridge, or curl for testing).

Only this PC may call it, with the AGENT_INGEST_API_KEY. Everything is validated before it's stored.
"""

import hmac
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from tripplanner.api.deps import DbSession
from tripplanner.config import get_settings
from tripplanner.models import Run
from tripplanner.schemas.agent import (
    AgentAck,
    FinishIn,
    LodgingPickBatchIn,
    LodgingPickBatchResult,
    NoteIn,
    NoteOut,
    QuoteBatchIn,
    QuoteBatchResult,
    RunContext,
    SuggestionBatchIn,
    SuggestionBatchResult,
)
from tripplanner.schemas.geo import AirportOut
from tripplanner.security import is_local_request
from tripplanner.services import agent_ingest
from tripplanner.services.agent_context import build_context
from tripplanner.services.airports import search_airports

MAX_BODY_BYTES = 2 * 1024 * 1024


def require_agent_key(request: Request) -> None:
    key = get_settings().agent_ingest_api_key
    expected = key.get_secret_value() if key else ""
    if not expected:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "The agent API is off: AGENT_INGEST_API_KEY isn't set in .env.",
        )
    if not is_local_request(request):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "The agent API only accepts requests from this computer."
        )
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(token.strip().encode(), expected.encode()):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Missing or wrong agent API key.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Request body is larger than 2 MB.")


router = APIRouter(prefix="/api/agent/v1", tags=["agent"], dependencies=[Depends(require_agent_key)])


def _active_run(db: DbSession, run_id: UUID) -> Run:
    try:
        return agent_ingest.active_run(db, run_id)
    except agent_ingest.RunNotActive as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This run isn't in progress, so it can't take more data."
        ) from exc


@router.get("/runs/{run_id}/context", response_model=RunContext)
def run_context(run_id: UUID, db: DbSession) -> RunContext:
    """The task: trip, routes with ids and date rules, cheapest known prices, and the rules."""
    return build_context(db, _active_run(db, run_id))


@router.get("/airports", response_model=list[AirportOut])
def lookup_airports(db: DbSession, q: str = Query(min_length=2, max_length=60)) -> list[AirportOut]:
    return [AirportOut.model_validate(a) for a in search_airports(db, q, limit=8)]


@router.post("/runs/{run_id}/flight-quotes", response_model=QuoteBatchResult)
def submit_flight_quotes(run_id: UUID, body: QuoteBatchIn, db: DbSession) -> QuoteBatchResult:
    """Up to 50 prices. Each is accepted, rejected with reasons, or reported as a duplicate."""
    return agent_ingest.submit_quotes(db, _active_run(db, run_id), body.quotes)


@router.post("/runs/{run_id}/activity-suggestions", response_model=SuggestionBatchResult)
def submit_activity_suggestions(
    run_id: UUID, body: SuggestionBatchIn, db: DbSession
) -> SuggestionBatchResult:
    """Up to 20 things to do. Each is accepted, rejected with reasons, or reported as a duplicate."""
    run = _active_run(db, run_id)
    if run.kind != "itinerary_agent":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Only itinerary runs can suggest activities. Save findings with add_note instead.",
        )
    return agent_ingest.submit_suggestions(db, run, body.suggestions)


@router.post("/runs/{run_id}/lodging-picks", response_model=LodgingPickBatchResult)
def submit_lodging_picks(run_id: UUID, body: LodgingPickBatchIn, db: DbSession) -> LodgingPickBatchResult:
    """Up to 8 ranked places to stay, each by its number in the search results. Each is accepted,
    rejected with reasons, or reported as a duplicate."""
    run = _active_run(db, run_id)
    if run.kind != "lodging_agent":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Only lodging runs can pick places to stay. Save findings with add_note instead.",
        )
    return agent_ingest.submit_lodging_picks(db, run, body.picks)


@router.post("/runs/{run_id}/notes", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def add_note(run_id: UUID, body: NoteIn, db: DbSession) -> NoteOut:
    run = _active_run(db, run_id)
    try:
        return NoteOut.model_validate(agent_ingest.add_note(db, run, body))
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.post("/runs/{run_id}/finish", response_model=AgentAck)
def finish_run(run_id: UUID, body: FinishIn, db: DbSession) -> AgentAck:
    agent_ingest.record_finish(db, _active_run(db, run_id), body)
    return AgentAck(ok=True, message="Report saved. You're done: stop now.")
