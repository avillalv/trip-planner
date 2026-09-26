from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, delete, select
from sqlalchemy.orm import Session

from tripplanner.api import system as system_api
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
    client: TestClient, monkeypatch: pytest.MonkeyPatch, use_settings
) -> None:
    use_settings(geoapify_api_key="geo-secret", wikimedia_contact="me@example.com")
    monkeypatch.setattr(
        system_api,
        "claude_cli_status",
        lambda _s: ClaudeCliStatus(found=True, path="claude", version="9.9.9"),
    )

    response = client.get("/api/v1/system/status")

    assert response.status_code == 200
    body = response.json()
    assert body["integrations"] == {
        "geoapify": True,
        "serpapi": False,
        "travelpayouts": False,
        "wikimedia": True,
    }
    assert body["claude"]["version"] == "9.9.9"
    assert body["access"] == {
        "other_devices": False,
        "passcode_configured": True,
        "port": 8000,
        "urls": [],
    }
    assert "geo-secret" not in response.text


def test_system_status_lists_phone_urls_when_open_to_the_network(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, use_settings
) -> None:
    use_settings(host="0.0.0.0", port=8123)
    monkeypatch.setattr(system_api, "lan_addresses", lambda: ["192.168.1.23"])
    monkeypatch.setattr(system_api, "claude_cli_status", lambda _s: ClaudeCliStatus(found=False))

    access = client.get("/api/v1/system/status").json()["access"]

    assert access == {
        "other_devices": True,
        "passcode_configured": True,
        "port": 8123,
        "urls": ["http://192.168.1.23:8123"],
    }
