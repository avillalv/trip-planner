"""`npm start` brings the database up to date first, with a backup taken before any change."""

from pathlib import Path

import pytest
from sqlalchemy.exc import OperationalError

from tripplanner import supervisor
from tripplanner.config import get_settings
from tripplanner.migrate import pending_migrations
from tripplanner.services import backups


def test_the_test_database_is_up_to_date(db_engine) -> None:
    assert pending_migrations(get_settings().test_database_url) == []


@pytest.fixture
def steps(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    done: list[str] = []
    monkeypatch.setattr(
        backups, "run_backup", lambda: done.append("backup") or backups.BackupInfo(Path("b.dump"), None, 1)
    )
    monkeypatch.setattr("tripplanner.migrate.upgrade", lambda: done.append("upgrade"))
    return done


def test_updates_are_applied_after_a_backup(steps: list[str], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("tripplanner.migrate.pending_migrations", lambda: ["0006", "0007"])

    supervisor.prepare_database()

    assert steps == ["backup", "upgrade"]


def test_nothing_happens_when_the_database_is_current(
    steps: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("tripplanner.migrate.pending_migrations", lambda: [])

    supervisor.prepare_database()

    assert steps == []


def test_a_failed_backup_doesnt_block_the_update(steps: list[str], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("tripplanner.migrate.pending_migrations", lambda: ["0007"])

    def no_pg_dump():
        raise backups.BackupError("Couldn't find pg_dump")

    monkeypatch.setattr(backups, "run_backup", no_pg_dump)

    supervisor.prepare_database()

    assert steps == ["upgrade"]


def test_a_failed_update_stops_the_start(steps: list[str], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("tripplanner.migrate.pending_migrations", lambda: ["0007"])

    def broken():
        raise RuntimeError("column already exists")

    monkeypatch.setattr("tripplanner.migrate.upgrade", broken)

    with pytest.raises(SystemExit):
        supervisor.prepare_database()


def test_it_waits_for_the_database_to_come_up(steps: list[str], monkeypatch: pytest.MonkeyPatch) -> None:
    calls = iter([OperationalError("connect", {}, Exception("starting up")), ["0007"]])

    def pending():
        result = next(calls)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr("tripplanner.migrate.pending_migrations", pending)

    supervisor.prepare_database(wait_seconds=0)

    assert steps == ["backup", "upgrade"]
