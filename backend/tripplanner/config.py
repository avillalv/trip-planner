"""Application settings, loaded from environment variables and the repo-root .env file."""

from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from tripplanner.paths import ENV_FILE

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://tripplanner@localhost:5432/tripplanner"
    test_database_url: str | None = None
    postgres_superuser: str = "postgres"

    host: str = "127.0.0.1"
    port: int = 8000
    # Extra host names allowed in the Host header, comma-separated (LAN IPs and this PC's name
    # are allowed automatically when HOST opens the app to the network).
    allowed_hosts: str = ""
    log_level: str = "INFO"

    session_secret: SecretStr | None = None
    agent_ingest_api_key: SecretStr | None = None
    app_passcode: SecretStr | None = None

    geoapify_api_key: SecretStr | None = None
    serpapi_api_key: SecretStr | None = None
    travelpayouts_token: SecretStr | None = None

    # Wikipedia requires API clients to identify a contact (email or URL) in the User-Agent.
    wikimedia_contact: str | None = None

    home_currency: str = "USD"
    # Full path to the Claude Code CLI; leave unset to find `claude` on PATH.
    claude_path: str | None = None

    @property
    def open_to_network(self) -> bool:
        return self.host not in LOOPBACK_HOSTS

    @property
    def extra_allowed_hosts(self) -> set[str]:
        return {h.strip().lower() for h in self.allowed_hosts.split(",") if h.strip()}


_override: Settings | None = None


@lru_cache
def _load_settings() -> Settings:
    return Settings()


def get_settings() -> Settings:
    return _override or _load_settings()


def override_settings(settings: Settings | None) -> None:
    """Swap in explicit settings (tests); pass None to go back to the environment."""
    global _override
    _override = settings
