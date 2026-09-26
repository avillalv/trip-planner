"""Runs one agent routine: `claude -p` on Sonnet, with only web tools and the trip bridge.

The whole Claude Code command line lives in this module, so a change in the CLI's flags is a
one-file fix. Agents write nothing directly: the bridge sends their results to the ingest API.
"""

import contextlib
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import IO, Any
from uuid import UUID

import psutil
from sqlalchemy.orm import Session

from tripplanner.config import Settings, get_settings
from tripplanner.db import new_session
from tripplanner.models import Routine, Run
from tripplanner.paths import default_agent_runs_dir
from tripplanner.services.agent_context import BLOCKED_DOMAINS, build_context, routine_config
from tripplanner.services.runs import RunLog, cancel_requested
from tripplanner.worker.agents.prompts import SYSTEM_PROMPT, task_prompt
from tripplanner.worker.agents.stream import StreamParser, StreamState

# Every agent run uses Sonnet. There is deliberately no --fallback-model.
MODEL = "sonnet"
WEB_TOOLS = ("WebSearch", "WebFetch")
MCP_SERVER = "trip"
# (max turns, timeout in minutes) when the routine doesn't set them.
DEFAULT_LIMITS = {"flight_agent": (40, 20), "research_agent": (30, 15)}
KEEP_RUN_DIRS = 30
WATCH_SECONDS = 2
SECONDS_PER_MINUTE = 60  # tests shrink this to exercise timeouts quickly
# A few popular Airbnb country sites, on top of the bare and www hosts of each blocked domain.
AIRBNB_COUNTRY_TLDS = ("co.uk", "ca", "com.au", "fr", "de", "es", "it", "mx", "jp")

# Variables that could move a run off the subscription or off Sonnet, plus the app's own secrets.
STRIPPED_ENV = frozenset(
    {
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "ANTHROPIC_SMALL_FAST_MODEL",
        "CLAUDE_CODE_SUBAGENT_MODEL",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
        "CLAUDECODE",
        "CLAUDE_CODE_ENTRYPOINT",
        "DATABASE_URL",
        "TEST_DATABASE_URL",
        "SESSION_SECRET",
        "AGENT_INGEST_API_KEY",
        "APP_PASSCODE",
        "GEOAPIFY_API_KEY",
        "SERPAPI_API_KEY",
        "TRAVELPAYOUTS_TOKEN",
    }
)

NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# Set when the worker stops; running agents are killed and their runs marked interrupted.
shutting_down = threading.Event()

log = logging.getLogger(__name__)


@dataclass
class AgentOutcome:
    status: str
    summary: str | None = None
    error: str | None = None


# --- Command line ---------------------------------------------------------------------------


def blocked_fetch_rules() -> list[str]:
    hosts = [h for d in BLOCKED_DOMAINS for h in (d, f"www.{d}")]
    hosts += [f"{w}airbnb.{tld}" for tld in AIRBNB_COUNTRY_TLDS for w in ("", "www.")]
    return [f"WebFetch(domain:{h})" for h in hosts]


def build_command(claude: list[str], run_dir: Path, max_turns: int) -> list[str]:
    return [
        *claude,
        "-p",
        "--model",
        MODEL,
        "--output-format",
        "stream-json",
        "--verbose",
        # Ignores user/project settings, hooks, and CLAUDE.md; only the tools below exist.
        "--restricted",
        "--tools",
        ",".join(WEB_TOOLS),
        "--mcp-config",
        str(run_dir / "mcp.json"),
        "--strict-mcp-config",
        "--allowedTools",
        ",".join([*WEB_TOOLS, f"mcp__{MCP_SERVER}"]),
        "--disallowedTools",
        ",".join(blocked_fetch_rules()),
        "--permission-mode",
        "dontAsk",
        "--permission-prompts",
        "none",
        "--append-system-prompt-file",
        str(run_dir / "system.md"),
        "--max-turns",
        str(max_turns),
        "--no-session-persistence",
        "--disable-slash-commands",
    ]


def mcp_config(run_id: UUID, api_url: str) -> dict[str, Any]:
    """Claude starts the bridge with this. No secrets: the bridge reads the API key from .env."""
    return {
        "mcpServers": {
            MCP_SERVER: {
                "type": "stdio",
                "command": sys.executable,
                "args": ["-m", "tripplanner.agent_bridge", "--run-id", str(run_id), "--api-url", api_url],
                "env": {"PYTHONUTF8": "1"},
            }
        }
    }


def agent_env(base: Mapping[str, str]) -> dict[str, str]:
    return {k: v for k, v in base.items() if k.upper() not in STRIPPED_ENV}


def redact(argv: list[str], settings: Settings) -> list[str]:
    secrets = [
        s.get_secret_value()
        for s in (settings.agent_ingest_api_key, settings.serpapi_api_key, settings.geoapify_api_key)
        if s and s.get_secret_value()
    ]
    out = []
    for arg in argv:
        for secret in secrets:
            arg = arg.replace(secret, "***")
        out.append(arg)
    return out


def find_claude(settings: Settings) -> list[str] | None:
    path = shutil.which(settings.claude_path or "claude")
    return [path] if path else None


# --- Files and processes --------------------------------------------------------------------


def prepare_run_dir(root: Path, run_id: UUID) -> Path:
    """A fresh scratch folder for the run; only the most recent ones are kept."""
    root.mkdir(parents=True, exist_ok=True)
    folders = sorted((p for p in root.iterdir() if p.is_dir()), key=lambda p: p.stat().st_mtime, reverse=True)
    for stale in folders[KEEP_RUN_DIRS - 1 :]:
        shutil.rmtree(stale, ignore_errors=True)
    run_dir = root / str(run_id)
    run_dir.mkdir(exist_ok=True)
    return run_dir


def kill_tree(pid: int) -> None:
    try:
        parent = psutil.Process(pid)
        procs = [*parent.children(recursive=True), parent]
    except psutil.NoSuchProcess:
        return
    for proc in procs:
        with contextlib.suppress(psutil.NoSuchProcess):
            proc.terminate()
    _, alive = psutil.wait_procs(procs, timeout=5)
    for proc in alive:
        with contextlib.suppress(psutil.NoSuchProcess):
            proc.kill()


def kill_orphan(pid: int | None) -> bool:
    """Stop a Claude process left behind by a worker that crashed (only if it still looks like one)."""
    if not pid:
        return False
    try:
        name = psutil.Process(pid).name().lower()
    except psutil.Error:
        return False
    if not name.startswith("claude"):
        return False
    kill_tree(pid)
    return True


class Watchdog(threading.Thread):
    """Stops the Claude process on timeout, on Cancel, or when the worker shuts down."""

    def __init__(
        self, proc: subprocess.Popen[str], deadline: float, is_cancelled: Callable[[], bool]
    ) -> None:
        super().__init__(daemon=True, name="agent-watchdog")
        self.proc = proc
        self.deadline = deadline
        self.is_cancelled = is_cancelled
        self.reason: str | None = None
        self.finished = threading.Event()

    def stop(self, reason: str) -> None:
        if self.reason is None:
            self.reason = reason
        kill_tree(self.proc.pid)

    def run(self) -> None:
        while not self.finished.wait(WATCH_SECONDS):
            if self.proc.poll() is not None:
                return
            if shutting_down.is_set():
                self.stop("shutdown")
            elif time.monotonic() >= self.deadline:
                self.stop("timeout")
            else:
                try:
                    if self.is_cancelled():
                        self.stop("cancelled")
                except Exception:
                    log.warning("Couldn't check whether the run was cancelled", exc_info=True)


class StderrDrain(threading.Thread):
    """Reads stderr so the pipe never fills, saving it to a file and keeping the last lines."""

    def __init__(self, stream: IO[str], path: Path) -> None:
        super().__init__(daemon=True, name="agent-stderr")
        self.stream = stream
        self.path = path
        self.lines: deque[str] = deque(maxlen=15)

    def run(self) -> None:
        with self.path.open("w", encoding="utf-8") as out:
            for line in self.stream:
                out.write(line)
                if line.strip():
                    self.lines.append(line.strip())

    def tail(self) -> str:
        return " ".join(self.lines)[-600:]


def _send_prompt(stdin: IO[str], prompt: str) -> None:
    with contextlib.suppress(OSError, ValueError):
        stdin.write(prompt)
        stdin.close()


def _db_cancel_check(run_id: UUID) -> Callable[[], bool]:
    def check() -> bool:
        with new_session() as db:
            return cancel_requested(db, run_id)

    return check


# --- Outcome --------------------------------------------------------------------------------


def explain_failure(text: str) -> str:
    lower = text.lower()
    if any(k in lower for k in ("authenticat", "oauth", "/login", "not logged in", "log in")):
        return (
            "Claude Code isn't signed in, or its sign-in expired. Open a terminal, run `claude`, "
            "type /login, and then run the routine again."
        )
    if "usage limit" in lower or "rate limit" in lower or "limit reached" in lower:
        return "Your Claude usage limit was reached. The routine will try again at its next scheduled time."
    if "overloaded" in lower:
        return "Claude was overloaded. The routine will try again at its next scheduled time."
    return text or "Claude Code reported an error."


def guard_problem(state: StreamState) -> str | None:
    """Stop runs that aren't on Sonnet or can't reach the trip tools."""
    for model in filter(None, [state.model, *state.models_seen]):
        if "sonnet" not in model.lower():
            return f"Claude started with {model} instead of Sonnet, so the run was stopped."
    if state.model is not None and state.mcp_servers.get(MCP_SERVER) != "connected":
        status = state.mcp_servers.get(MCP_SERVER, "missing")
        return f"The trip tools didn't start ({status}), so nothing could be saved. The run was stopped."
    return None


def _record_usage(run: Run, result: dict[str, Any], exit_code: int | None) -> None:
    usage = result.get("usage") or {}
    keys = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")
    run.input_tokens = sum(int(usage.get(k) or 0) for k in keys) or None
    run.output_tokens = usage.get("output_tokens")
    cost = result.get("total_cost_usd")
    run.cost_usd_est = Decimal(str(cost)) if cost is not None else None
    run.exit_code = exit_code


REPORT_STATUS = {"ok": "succeeded", "partial": "partial", "failed": "failed"}


def _outcome_from_result(run: Run, result: dict[str, Any], max_turns: int) -> AgentOutcome:
    subtype = str(result.get("subtype") or "")
    text = str(result.get("result") or "")
    report = run.report or {}
    reported = REPORT_STATUS.get(str(report.get("status")))
    if subtype == "error_max_turns":
        status = "failed" if reported == "failed" else "partial"
        return AgentOutcome(status, error=f"Reached the {max_turns}-turn limit before finishing.")
    if result.get("is_error") or subtype.startswith("error"):
        return AgentOutcome("failed", error=explain_failure(text or subtype))
    if reported is None:
        return AgentOutcome(
            "partial",
            summary=run.summary or (text[:1000] or None),
            error="The agent stopped without reporting how the run went.",
        )
    error = "The agent reported that it couldn't do the task." if reported == "failed" else None
    return AgentOutcome(reported, error=error)


# --- Run ------------------------------------------------------------------------------------


def run_agent(
    db: Session,
    run: Run,
    run_log: RunLog,
    settings: Settings | None = None,
    *,
    is_cancelled: Callable[[], bool] | None = None,
) -> AgentOutcome:
    settings = settings or get_settings()

    def fail(message: str) -> AgentOutcome:
        run_log.error(message)
        return AgentOutcome("failed", error=message)

    claude = find_claude(settings)
    if claude is None:
        return fail(
            "Claude Code wasn't found. Install it, or set CLAUDE_PATH in .env to claude.exe's full path."
        )
    if not (settings.agent_ingest_api_key and settings.agent_ingest_api_key.get_secret_value()):
        return fail("AGENT_INGEST_API_KEY isn't set in .env, so the agent couldn't save anything.")

    context = build_context(db, run)
    if run.kind == "flight_agent" and not context.routes:
        return fail("This trip has no active flight routes to search. Add one on the Flights page.")
    config = routine_config(db, run)
    default_turns, default_timeout = DEFAULT_LIMITS[run.kind]
    max_turns = int(config.get("max_turns") or default_turns)
    timeout_min = int(config.get("timeout_min") or default_timeout)
    routine = db.get(Routine, run.routine_id) if run.routine_id else None

    run_dir = prepare_run_dir(settings.agent_runs_dir or default_agent_runs_dir(), run.id)
    prompt = task_prompt(context, routine.name if routine else None)
    api_url = f"http://127.0.0.1:{settings.port}"
    (run_dir / "system.md").write_text(SYSTEM_PROMPT, encoding="utf-8")
    (run_dir / "mcp.json").write_text(json.dumps(mcp_config(run.id, api_url), indent=2), encoding="utf-8")
    (run_dir / "prompt.md").write_text(prompt, encoding="utf-8")
    argv = build_command(claude, run_dir, max_turns)

    run.prompt = prompt
    run.argv_redacted = redact(argv, settings)
    run.log_path = str(run_dir)
    db.commit()
    run_log.info(f"Starting Claude ({MODEL}) with up to {max_turns} turns and a {timeout_min}-minute limit.")

    try:
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=run_dir,
            env=agent_env(os.environ),
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=NO_WINDOW,
        )
    except OSError as exc:
        return fail(f"Couldn't start Claude Code: {exc}")
    assert proc.stdin and proc.stdout and proc.stderr
    run.pid = proc.pid
    db.commit()

    watchdog = Watchdog(
        proc, time.monotonic() + timeout_min * SECONDS_PER_MINUTE, is_cancelled or _db_cancel_check(run.id)
    )
    stderr = StderrDrain(proc.stderr, run_dir / "stderr.log")
    watchdog.start()
    stderr.start()
    # Written from a thread: if Claude fills stdout before reading its prompt, neither side blocks.
    threading.Thread(target=_send_prompt, args=(proc.stdin, prompt), daemon=True).start()

    parser = StreamParser()
    problem: str | None = None
    with (run_dir / "stream.jsonl").open("w", encoding="utf-8") as raw:
        for line in proc.stdout:
            raw.write(line)
            for event in parser.feed(line):
                run_log.add(event.type, event.summary, event.payload, tool_name=event.tool_name)
            if problem is None and (problem := guard_problem(parser.state)):
                run_log.error(problem)
                watchdog.stop("guard")
    try:
        exit_code = proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        kill_tree(proc.pid)
        exit_code = proc.wait()
    watchdog.finished.set()
    stderr.join(timeout=5)

    # Counts and the agent's own report were written by the web process while this ran.
    db.refresh(run)
    result = parser.state.result
    if result is not None:
        _record_usage(run, result, exit_code)
        extra = [m for m in (result.get("modelUsage") or {}) if "sonnet" not in m.lower()]
        if extra:
            run_log.warning(f"Claude Code also used {', '.join(extra)} for background work.")
    else:
        run.exit_code = exit_code

    match watchdog.reason:
        case "cancelled":
            return AgentOutcome("cancelled", summary=run.summary or "Cancelled while running.")
        case "timeout":
            return AgentOutcome(
                "timed_out", error=f"Stopped after {timeout_min} minutes. Anything saved so far was kept."
            )
        case "shutdown":
            return AgentOutcome("interrupted", error="The app stopped before this run finished.")
        case "guard":
            return AgentOutcome("failed", error=problem)
    if result is None:
        detail = stderr.tail()
        message = f"Claude Code exited (code {exit_code}) without finishing."
        return fail(f"{message} {explain_failure(detail)}" if detail else message)
    return _outcome_from_result(run, result, max_turns)
