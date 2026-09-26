"""Nightly backups: finding pg_dump, keeping 14, catching up a missed night, and a real dump."""

import os
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tripplanner.api import system as system_api
from tripplanner.config import get_settings
from tripplanner.schemas.system import ClaudeCliStatus
from tripplanner.services import backups
from tripplanner.services.backups import BackupError, BackupInfo

EXE = "pg_dump.exe" if os.name == "nt" else "pg_dump"


def make_tool(folder: Path) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    tool = folder / EXE
    tool.write_text("")
    return tool


def test_pg_bin_dir_wins(tmp_path: Path, use_settings) -> None:
    tool = make_tool(tmp_path / "bin")
    use_settings(pg_bin_dir=str(tmp_path / "bin"))

    assert backups.find_tool("pg_dump") == tool


def test_a_wrong_pg_bin_dir_says_so(tmp_path: Path, use_settings) -> None:
    use_settings(pg_bin_dir=str(tmp_path / "nowhere"))

    with pytest.raises(BackupError, match="PG_BIN_DIR is set"):
        backups.find_tool("pg_dump")


def test_the_newest_postgresql_install_is_used(
    tmp_path: Path, use_settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_settings(pg_bin_dir=None)
    monkeypatch.setattr(backups.shutil, "which", lambda _name: None)
    monkeypatch.setenv("PROGRAMFILES", str(tmp_path))
    make_tool(tmp_path / "PostgreSQL" / "9.6" / "bin")
    newest = make_tool(tmp_path / "PostgreSQL" / "18" / "bin")
    make_tool(tmp_path / "PostgreSQL" / "16" / "bin")

    assert backups.find_tool("pg_dump") == newest


def test_missing_pg_dump_explains_the_fix(
    tmp_path: Path, use_settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_settings(pg_bin_dir=None)
    monkeypatch.setattr(backups.shutil, "which", lambda _name: None)
    monkeypatch.setenv("PROGRAMFILES", str(tmp_path))

    with pytest.raises(BackupError, match="Set PG_BIN_DIR"):
        backups.find_tool("pg_dump")


@pytest.fixture
def fake_pg_dump(tmp_path: Path, use_settings, monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    """Stands in for pg_dump: writes the file it's asked for and records how it was called."""
    use_settings(backup_dir=tmp_path / "backups", pg_bin_dir=str(tmp_path / "bin"))
    make_tool(tmp_path / "bin")
    calls: list[dict] = []

    def run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
        calls.append({"command": command, "env": kwargs["env"]})
        target = next(arg.removeprefix("--file=") for arg in command if arg.startswith("--file="))
        Path(target).write_bytes(b"PGDMP")
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(backups.subprocess, "run", run)
    return calls


def test_a_backup_keeps_the_password_off_the_command_line(fake_pg_dump: list[dict]) -> None:
    info = backups.run_backup("postgresql+psycopg://trips:s3cret@localhost:5433/tripplanner")

    [call] = fake_pg_dump
    assert "s3cret" not in " ".join(call["command"])
    assert (call["env"]["PGPASSWORD"], call["env"]["PGPORT"], call["env"]["PGDATABASE"]) == (
        "s3cret",
        "5433",
        "tripplanner",
    )
    assert info.path.name.startswith("tripplanner-") and info.path.suffix == ".dump"
    assert info.size == 5
    assert not list(info.path.parent.glob("*.partial"))


def test_only_the_newest_14_are_kept(fake_pg_dump: list[dict]) -> None:
    start = datetime(2026, 9, 1, 3, 30, tzinfo=UTC)
    for day in range(16):
        info = backups.run_backup(get_settings().database_url, now=start + timedelta(days=day))
        stamp = (start + timedelta(days=day)).timestamp()
        os.utime(info.path, (stamp, stamp))

    kept = backups.list_backups()
    assert len(kept) == 14
    assert kept[0].created_at == start + timedelta(days=15)
    assert kept[-1].created_at == start + timedelta(days=2)


def test_a_failed_dump_leaves_no_partial_file(
    tmp_path: Path, use_settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_settings(backup_dir=tmp_path / "backups", pg_bin_dir=str(tmp_path / "bin"))
    make_tool(tmp_path / "bin")

    def fail(command: list[str], **_kwargs) -> subprocess.CompletedProcess:
        target = next(arg.removeprefix("--file=") for arg in command if arg.startswith("--file="))
        Path(target).write_bytes(b"half")
        raise subprocess.CalledProcessError(
            1, command, "", "connection to server failed: password authentication failed"
        )

    monkeypatch.setattr(backups.subprocess, "run", fail)

    with pytest.raises(BackupError, match="password authentication failed"):
        backups.run_backup(get_settings().database_url)
    assert list((tmp_path / "backups").iterdir()) == []


def local(*args: int) -> datetime:
    return datetime(*args).astimezone()


def backup_at(when: datetime) -> list[BackupInfo]:
    return [BackupInfo(Path("x.dump"), when, 1)]


def test_a_backup_is_due_each_night_and_after_a_missed_one() -> None:
    morning = local(2026, 9, 26, 10, 0)

    assert backups.is_due(morning, [])
    assert backups.is_due(morning, backup_at(local(2026, 9, 25, 3, 31)))  # the PC was off last night
    assert not backups.is_due(morning, backup_at(local(2026, 9, 26, 3, 31)))
    assert not backups.is_due(local(2026, 9, 26, 3, 0), backup_at(local(2026, 9, 25, 3, 31)))  # not 3:30 yet


def test_status_shows_the_newest_backup_and_any_problem(
    client: TestClient, db_session: Session, fake_pg_dump: list[dict], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(system_api, "claude_cli_status", lambda _s, fresh=False: ClaudeCliStatus(found=False))
    backups.record_error(db_session, "pg_dump failed: disk full")
    assert client.get("/api/v1/system/status").json()["backups"]["error"] == "pg_dump failed: disk full"

    status = client.post("/api/v1/system/backup").json()

    assert (status["count"], status["last_size"], status["error"]) == (1, 5, None)
    assert status["directory"].endswith("backups")


@pytest.mark.skipif(
    not os.environ.get("TRIPPLANNER_REAL_PG_DUMP"), reason="set TRIPPLANNER_REAL_PG_DUMP=1 to run"
)
def test_a_real_dump_of_the_test_database(tmp_path: Path, use_settings) -> None:
    use_settings(backup_dir=tmp_path)

    info = backups.run_backup(get_settings().test_database_url)

    assert info.size > 1000
    assert info.path.read_bytes().startswith(b"PGDMP")
