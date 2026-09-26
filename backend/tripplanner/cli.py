"""`trip-planner` command-line entry point."""

import argparse
import json
import logging
import sys
from pathlib import Path

from tripplanner.config import get_settings, override_settings
from tripplanner.paths import PACKAGE_DIR
from tripplanner.process import configure_logging, start_parent_watchdog

log = logging.getLogger("tripplanner")


def _use_test_db() -> None:
    """Development convenience: run against the throwaway test database."""
    settings = get_settings()
    if not settings.test_database_url:
        sys.exit("TEST_DATABASE_URL is not set in .env.")
    override_settings(settings.model_copy(update={"database_url": settings.test_database_url}))
    log.warning("Using the TEST database; pytest runs wipe it.")


def _cmd_web(args: argparse.Namespace) -> None:
    import uvicorn

    if args.test_db:
        if args.reload:
            sys.exit("--test-db can't be combined with --reload.")
        _use_test_db()
    settings = get_settings()
    start_parent_watchdog()
    uvicorn.run(
        "tripplanner.main:app",
        host=args.host or settings.host,
        port=args.port or settings.port,
        reload=args.reload,
        reload_dirs=[str(PACKAGE_DIR)] if args.reload else None,
        log_level=settings.log_level.lower(),
        # Keep request.client as the real socket peer; the agent API trusts only localhost.
        proxy_headers=False,
    )


def _cmd_worker(args: argparse.Namespace) -> None:
    from tripplanner.worker.main import run_worker

    if args.test_db:
        _use_test_db()
    if args.port:
        # Agent tools call the web server's ingest API, so they need its port.
        override_settings(get_settings().model_copy(update={"port": args.port}))
    run_worker()


def _cmd_serve(_args: argparse.Namespace) -> None:
    from tripplanner.supervisor import serve

    settings = get_settings()
    log.info(
        "Trip Planner starting at http://%s:%s",
        "localhost" if settings.host in {"127.0.0.1", "0.0.0.0"} else settings.host,
        settings.port,
    )
    serve()


def _cmd_setup_db(args: argparse.Namespace) -> None:
    from tripplanner.setup_db import SetupError, setup_database

    try:
        setup_database(seed=not args.skip_seed)
    except SetupError as exc:
        log.error("%s", exc)
        sys.exit(1)


def _cmd_migrate(_args: argparse.Namespace) -> None:
    from tripplanner.migrate import upgrade

    upgrade()
    log.info("Database is up to date.")


def _cmd_seed_airports(args: argparse.Namespace) -> None:
    from tripplanner.seed.airports import seed_airports

    seed_airports(refresh=args.refresh)


def _cmd_agent_smoke(_args: argparse.Namespace) -> None:
    from tripplanner.worker.agents.smoke import run_smoke

    sys.exit(run_smoke())


def _cmd_openapi(args: argparse.Namespace) -> None:
    from tripplanner.main import create_app

    schema = create_app().openapi()
    out: Path = args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(schema, indent=2) + "\n", encoding="utf-8", newline="\n")
    log.info("Wrote OpenAPI schema to %s", out)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="trip-planner", description="Trip Planner backend")
    sub = parser.add_subparsers(dest="command", required=True)

    web = sub.add_parser("web", help="run the web server (API + built frontend)")
    web.add_argument("--host")
    web.add_argument("--port", type=int)
    web.add_argument("--reload", action="store_true", help="restart on code changes (development)")
    web.add_argument("--test-db", action="store_true", help="use TEST_DATABASE_URL (development)")
    web.set_defaults(func=_cmd_web)

    worker = sub.add_parser("worker", help="run the background worker")
    worker.add_argument("--test-db", action="store_true", help="use TEST_DATABASE_URL (development)")
    worker.add_argument("--port", type=int, help="the web server's port, if not PORT from .env")
    worker.set_defaults(func=_cmd_worker)
    sub.add_parser("serve", help="run web server and worker together").set_defaults(func=_cmd_serve)

    setup = sub.add_parser("setup-db", help="create the database role and databases, migrate, and seed")
    setup.add_argument("--skip-seed", action="store_true")
    setup.set_defaults(func=_cmd_setup_db)

    sub.add_parser("migrate", help="apply database migrations").set_defaults(func=_cmd_migrate)

    seed = sub.add_parser("seed-airports", help="load airports from OurAirports")
    seed.add_argument("--refresh", action="store_true", help="download a fresh copy instead of the cache")
    seed.set_defaults(func=_cmd_seed_airports)

    sub.add_parser(
        "agent-smoke", help="one real Claude flight-agent run against a throwaway trip in the test database"
    ).set_defaults(func=_cmd_agent_smoke)

    openapi = sub.add_parser("openapi", help="write the OpenAPI schema to a file")
    openapi.add_argument("--out", type=Path, required=True)
    openapi.set_defaults(func=_cmd_openapi)

    args = parser.parse_args(argv)
    configure_logging(get_settings().log_level)
    args.func(args)


if __name__ == "__main__":
    main()
