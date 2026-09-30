"""Turns Claude Code's stream-json output into run log events."""

import json
from dataclasses import dataclass, field
from typing import Any

MCP_PREFIX = "mcp__trip__"
MAX_PAYLOAD_TEXT = 4000


@dataclass
class LogEvent:
    type: str  # info | warning | error | text | tool_use | tool_result | result
    summary: str
    tool_name: str | None = None
    payload: dict[str, Any] | None = None


@dataclass
class StreamState:
    version: str | None = None
    model: str | None = None
    tools: list[str] = field(default_factory=list)
    mcp_servers: dict[str, str] = field(default_factory=dict)
    models_seen: set[str] = field(default_factory=set)
    result: dict[str, Any] | None = None
    tool_names: dict[str, str] = field(default_factory=dict)


def tool_label(name: str) -> str:
    return name.removeprefix(MCP_PREFIX)


def _clip(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _tool_use_summary(name: str, args: dict[str, Any]) -> str:
    label = tool_label(name)
    match label:
        case "WebSearch":
            return f"Searched the web for “{_clip(str(args.get('query', '')), 200)}”"
        case "WebFetch":
            return f"Opened {_clip(str(args.get('url', '')), 300)}"
        case "get_task":
            return "Read the task"
        case "lookup_airports":
            return f"Looked up airports for “{_clip(str(args.get('query', '')), 80)}”"
        case "submit_flight_quotes":
            count = len(args.get("quotes") or [])
            return f"Submitted {count} price{'s' if count != 1 else ''}"
        case "suggest_activities":
            count = len(args.get("suggestions") or [])
            return f"Suggested {count} thing{'s' if count != 1 else ''} to do"
        case "suggest_lodging":
            count = len(args.get("picks") or [])
            return f"Picked {count} place{'s' if count != 1 else ''} to stay"
        case "add_note":
            return f"Saved a note: {_clip(str(args.get('title', '')), 160)}"
        case "finish_run":
            return f"Reported the run as {args.get('status', '?')}"
    return f"Used {label}"


def _result_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
        return "\n".join(parts)
    return ""


class StreamParser:
    """Feed it stdout lines; it returns log events and keeps what it learns in `state`."""

    def __init__(self) -> None:
        self.state = StreamState()

    def feed(self, line: str) -> list[LogEvent]:
        line = line.strip()
        if not line:
            return []
        try:
            event = json.loads(line)
        except ValueError:
            return [LogEvent("info", _clip(line, 500))]
        if not isinstance(event, dict):
            return []
        match event.get("type"):
            case "system":
                return self._system(event)
            case "assistant":
                return self._assistant(event)
            case "user":
                return self._user(event)
            case "result":
                return [self._result(event)]
        return []

    def _system(self, event: dict[str, Any]) -> list[LogEvent]:
        subtype = event.get("subtype")
        if subtype == "init":
            s = self.state
            s.version = event.get("claude_code_version")
            s.model = event.get("model")
            s.tools = list(event.get("tools") or [])
            s.mcp_servers = {m.get("name"): m.get("status") for m in event.get("mcp_servers") or []}
            tools = ", ".join(tool_label(t) for t in s.tools)
            return [
                LogEvent(
                    "info",
                    f"Claude Code {s.version or '?'} started with {s.model or '?'}. Tools: {tools}.",
                    payload={
                        "model": s.model,
                        "version": s.version,
                        "tools": s.tools,
                        "mcp_servers": event.get("mcp_servers"),
                        "permission_mode": event.get("permissionMode"),
                        "session_id": event.get("session_id"),
                    },
                )
            ]
        if subtype and ("retry" in subtype or "error" in subtype):
            detail = event.get("error") or event.get("message") or ""
            return [LogEvent("warning", _clip(f"Claude: {subtype} {detail}", 500), payload=event)]
        return []

    def _assistant(self, event: dict[str, Any]) -> list[LogEvent]:
        message = event.get("message") or {}
        model = message.get("model")
        if model and model != "<synthetic>":
            self.state.models_seen.add(model)
        events = []
        for block in message.get("content") or []:
            kind = block.get("type")
            if kind == "text" and block.get("text", "").strip():
                events.append(LogEvent("text", block["text"].strip()[:2000]))
            elif kind == "tool_use":
                name = str(block.get("name", "?"))
                self.state.tool_names[block.get("id", "")] = name
                args = block.get("input") or {}
                events.append(
                    LogEvent(
                        "tool_use",
                        _tool_use_summary(name, args),
                        tool_name=tool_label(name),
                        payload={"input": _truncate_json(args)},
                    )
                )
        return events

    def _user(self, event: dict[str, Any]) -> list[LogEvent]:
        events = []
        content = (event.get("message") or {}).get("content")
        if not isinstance(content, list):
            return []
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_result":
                continue
            name = tool_label(self.state.tool_names.get(block.get("tool_use_id", ""), "tool"))
            text = _result_text(block.get("content"))
            is_error = bool(block.get("is_error"))
            first_line = _clip(text.split("\n", 1)[0] if text else "(no output)", 300)
            summary = f"{name} failed: {first_line}" if is_error else f"{name}: {first_line}"
            events.append(
                LogEvent(
                    "warning" if is_error else "tool_result",
                    summary,
                    tool_name=name,
                    payload={"is_error": is_error, "content": text[:MAX_PAYLOAD_TEXT]},
                )
            )
        return events

    def _result(self, event: dict[str, Any]) -> LogEvent:
        self.state.result = event
        turns = event.get("num_turns")
        is_error = bool(event.get("is_error")) or str(event.get("subtype", "")).startswith("error")
        text = str(event.get("result") or "")
        summary = f"Claude finished after {turns} turn{'s' if turns != 1 else ''}"
        summary += f" with an error: {_clip(text, 300)}" if is_error and text else "."
        return LogEvent(
            "error" if is_error else "result",
            summary,
            payload={
                "subtype": event.get("subtype"),
                "is_error": event.get("is_error"),
                "terminal_reason": event.get("terminal_reason"),
                "num_turns": turns,
                "duration_ms": event.get("duration_ms"),
                "total_cost_usd": event.get("total_cost_usd"),
                "usage": event.get("usage"),
                "models": sorted((event.get("modelUsage") or {}).keys()),
                "result": text[:2000],
            },
        )


def _truncate_json(value: Any) -> Any:
    text = json.dumps(value, ensure_ascii=False, default=str)
    return value if len(text) <= MAX_PAYLOAD_TEXT else {"truncated": text[:MAX_PAYLOAD_TEXT]}
