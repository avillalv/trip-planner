"""Clients for external data sources. Each one maps provider responses into our own schemas."""


class ProviderError(RuntimeError):
    """An external service failed or returned something unusable."""


class ProviderNotConfigured(RuntimeError):
    """The API key or contact setting this provider needs is missing from .env."""
