---
paths:
  - "backend/tripplanner/worker/**"
  - "backend/tripplanner/agent_bridge/**"
  - "backend/tripplanner/api/agent.py"
  - "backend/tripplanner/api/runs.py"
  - "backend/tripplanner/schemas/agent.py"
  - "backend/tripplanner/services/agent_*.py"
  - "backend/tests/test_agent_*.py"
  - "backend/tests/fake_claude.py"
---

# Agent routines

- Agent runs (`claude -p`) must always run on Sonnet 5.5, pinned as `--model claude-sonnet-5-5`
  (`runner.MODEL`; the CLI's `sonnet` alias lagged at Sonnet 5), with no fallback model.
  Agents never touch the database; they write only through the ingest API (`/api/agent/v1`),
  which requires the API key and a localhost client. The whole `claude` command line lives in
  `backend/tripplanner/worker/agents/runner.py`; agents reach the API through the stdio MCP
  bridge in `backend/tripplanner/agent_bridge/`. Pipeline tests use `backend/tests/fake_claude.py`,
  never the real CLI.
