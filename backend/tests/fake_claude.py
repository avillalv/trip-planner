"""Stand-in for the `claude` CLI in tests: prints canned stream-json for a scenario.

FAKE_CLAUDE_SCENARIO picks what happens. If FAKE_CLAUDE_RECORD is set, the arguments, prompt,
working directory, and whether an API key leaked into the environment are written there as JSON.
`auth status` reports signed in, except in the "signed_out" scenario.
"""

import json
import os
import subprocess
import sys
import time

TOOLS = [
    "WebFetch",
    "WebSearch",
    "mcp__trip__add_note",
    "mcp__trip__finish_run",
    "mcp__trip__get_task",
    "mcp__trip__lookup_airports",
    "mcp__trip__submit_flight_quotes",
]


def emit(event: dict) -> None:
    print(json.dumps(event), flush=True)


def assistant(*blocks: dict, model: str = "claude-sonnet-5-5") -> None:
    emit({"type": "assistant", "message": {"model": model, "role": "assistant", "content": list(blocks)}})


def tool_result(tool_use_id: str, text: str, is_error: bool = False) -> None:
    block = {"type": "tool_result", "tool_use_id": tool_use_id, "content": [{"type": "text", "text": text}]}
    if is_error:
        block["is_error"] = True
    emit({"type": "user", "message": {"role": "user", "content": [block]}})


def result(**overrides: object) -> None:
    event = {
        "type": "result",
        "subtype": "success",
        "is_error": False,
        "num_turns": 6,
        "duration_ms": 42000,
        "result": "Found two fares.",
        "total_cost_usd": 0.1234,
        "usage": {
            "input_tokens": 1000,
            "cache_creation_input_tokens": 2000,
            "cache_read_input_tokens": 30000,
            "output_tokens": 1500,
        },
        "modelUsage": {"claude-sonnet-5-5": {"costUSD": 0.1234}},
        "terminal_reason": "completed",
    }
    event.update(overrides)
    emit(event)


def main() -> None:
    scenario = os.environ.get("FAKE_CLAUDE_SCENARIO", "success")
    if sys.argv[1:3] == ["auth", "status"]:
        signed_in = scenario != "signed_out"
        print(json.dumps({"loggedIn": signed_in, "authMethod": "claude.ai" if signed_in else "none"}))
        sys.exit(0 if signed_in else 1)
    prompt = sys.stdin.read()
    if record := os.environ.get("FAKE_CLAUDE_RECORD"):
        with open(record, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "argv": sys.argv[1:],
                    "prompt": prompt,
                    "cwd": os.getcwd(),
                    "api_key_leaked": "ANTHROPIC_API_KEY" in os.environ,
                    "background_model": os.environ.get("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
                },
                f,
            )

    if scenario == "crash":
        print("boom: something broke", file=sys.stderr, flush=True)
        sys.exit(3)

    init = {
        "type": "system",
        "subtype": "init",
        "model": "claude-sonnet-5" if scenario == "wrong_model" else "claude-sonnet-5-5",
        "claude_code_version": "2.1.283",
        "tools": TOOLS,
        "mcp_servers": [{"name": "trip", "status": "failed" if scenario == "mcp_failed" else "connected"}],
        "permissionMode": "dontAsk",
        "session_id": "fake-session",
    }
    emit(init)

    if scenario in ("wrong_model", "mcp_failed", "hang"):
        # A child process, like the MCP bridge, so tests can check the whole tree is stopped.
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
        assistant({"type": "text", "text": f"child {child.pid}"})
        time.sleep(120)
        return

    if scenario == "auth_error":
        message = "Failed to authenticate: OAuth session expired and could not be refreshed"
        assistant({"type": "text", "text": message}, model="<synthetic>")
        result(is_error=True, result=message, num_turns=1, total_cost_usd=0, terminal_reason="api_error")
        sys.exit(1)

    assistant(
        {
            "type": "tool_use",
            "id": "t1",
            "name": "WebSearch",
            "input": {"query": "LAX to Tokyo fares November"},
        }
    )
    tool_result("t1", "Links: [ZIPAIR sale](https://zipair.net/en/sale)")
    quotes = [{"route_id": 1, "price_total": 1284}, {"route_id": 1, "price_total": 1302}]
    assistant(
        {
            "type": "tool_use",
            "id": "t2",
            "name": "mcp__trip__submit_flight_quotes",
            "input": {"quotes": quotes},
        }
    )
    tool_result("t2", '2 accepted, 0 rejected, 0 duplicates.\n{"accepted": []}')
    assistant(
        {"type": "tool_use", "id": "t3", "name": "WebFetch", "input": {"url": "https://www.kayak.com/x"}}
    )
    tool_result("t3", "Page blocked (403)", is_error=True)
    assistant({"type": "thinking", "thinking": "hmm"}, {"type": "text", "text": "I found two fares."})

    if scenario == "max_turns":
        result(subtype="error_max_turns", is_error=True, result="", terminal_reason="max_turns")
        return
    result()


if __name__ == "__main__":
    main()
