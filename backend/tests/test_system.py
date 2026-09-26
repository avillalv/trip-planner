from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, delete, select
from sqlalchemy.orm import Session

from tripplanner.api import system as system_api
from tripplanner.config import Settings
from tripplanner.models import WorkerHeartbeat
from tripplanner.schemas.system import ClaudeCliStatus
from tripplanner.services.system_status import worker_status
from tripplanner.worker.main import beat


def test_health_reports_database_ok(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert body["worker"]["status"] == "never_started"


def _heartbeat(last_seen: datetime) -> WorkerHeartbeat:
    return WorkerHeartbeat(id=1, pid=123, version="test", started_at=last_seen, last_seen=last_seen)


def test_worker_status_is_ok_when_recent(db_session: Session) -> None:
    now = datetime.now(UTC)
    db_session.add(_heartbeat(now - timedelta(seconds=20)))
    db_session.flush()

    assert worker_status(db_session, now=now).status == "ok"


def test_worker_status_is_stale_after_missed_beats(db_session: Session) -> None:
    now = datetime.now(UTC)
    db_session.add(_heartbeat(now - timedelta(minutes=5)))
    db_session.flush()

    assert worker_status(db_session, now=now).status == "stale"


def test_beat_upserts_a_single_row(db_engine: Engine) -> None:
    started = datetime.now(UTC)
    try:
        beat(started, engine=db_engine)
        beat(started, engine=db_engine)
        with Session(db_engine) as session:
            rows = session.scalars(select(WorkerHeartbeat)).all()
        assert len(rows) == 1
        assert rows[0].started_at == started
    finally:
        with db_engine.begin() as conn:
            conn.execute(delete(WorkerHeartbeat))


def test_system_status_reports_key_presence_without_values(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = Settings(
        _env_file=None, geoapify_api_key="geo-secret", serpapi_api_key=None, home_currency="EUR"
    )
    monkeypatch.setattr(system_api, "get_settings", lambda: settings)
    monkeypatch.setattr(
        system_api,
        "claude_cli_status",
        lambda _s: ClaudeCliStatus(found=True, path="claude", version="9.9.9"),
    )

    response = client.get("/api/v1/system/status")

    assert response.status_code == 200
    body = response.json()
    assert body["integrations"] == {"geoapify": True, "serpapi": False, "travelpayouts": False}
    assert body["claude"]["version"] == "9.9.9"
    assert body["home_currency"] == "EUR"
    assert "geo-secret" not in response.text
