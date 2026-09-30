"""Finding the Claude Code CLI, the environment agent runs get, and whether Claude is signed in."""

import json
import shutil
import subprocess
from collections.abc import Mapping
from dataclasses import dataclass

from tripplanner.config import Settings

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

CLAUDE_MISSING = "Claude Code wasn't found. Install it, or set CLAUDE_PATH in .env to claude.exe's full path."
KEY_MISSING = "AGENT_INGEST_API_KEY isn't set in .env, so the agent couldn't save anything."

# Keeps a console window from flashing up when the app runs in the background on Windows.
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


@dataclass(frozen=True)
class ClaudeAuth:
    # None when the CLI couldn't say (old version, timeout, unexpected output).
    signed_in: bool | None
    method: str | None = None


def agent_env(base: Mapping[str, str]) -> dict[str, str]:
    return {k: v for k, v in base.items() if k.upper() not in STRIPPED_ENV}


def find_claude(settings: Settings) -> list[str] | None:
    path = shutil.which(settings.claude_path or "claude")
    return [path] if path else None


def auth_status(claude: list[str], env: Mapping[str, str]) -> ClaudeAuth:
    """Ask `claude auth status` (no model call) whether runs would be signed in."""
    try:
        out = subprocess.run(
            [*claude, "auth", "status"],
            capture_output=True,
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
            check=False,
            env=agent_env(env),
            creationflags=NO_WINDOW,
        )
        data = json.loads(out.stdout)
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return ClaudeAuth(signed_in=None)
    if not isinstance(data, dict) or "loggedIn" not in data:
        return ClaudeAuth(signed_in=None)
    return ClaudeAuth(signed_in=bool(data["loggedIn"]), method=data.get("authMethod"))
