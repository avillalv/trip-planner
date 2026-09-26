"""Application settings, loaded from environment variables and the repo-root .env file."""

from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from tripplanner.paths import ENV_FILE


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
    log_level: str = "INFO"

    session_secret: SecretStr | None = None
    agent_ingest_api_key: SecretStr | None = None
    app_passcode: SecretStr | None = None

    geoapify_api_key: SecretStr | None = None
    serpapi_api_key: SecretStr | None = None
    travelpayouts_token: SecretStr | None = None

    home_currency: str = "USD"
    # Full path to the Claude Code CLI; leave unset to find `claude` on PATH.
    claude_path: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
