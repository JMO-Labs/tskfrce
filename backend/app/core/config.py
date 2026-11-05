"""
Application configuration settings.

This module contains all configuration settings for the t@sk4ce application,
including database, authentication, and external service configurations.
"""

import ipaddress
from pathlib import Path
from typing import Any

from pydantic import ConfigDict, field_validator, model_validator, validator
from pydantic_settings import BaseSettings

from app.core.secrets import load_or_create_secrets


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    """

    # Application settings
    APP_NAME: str = "t@sk4ce"
    DEBUG: bool = False
    ENVIRONMENT: str = "development"

    # API settings
    # Generated at first boot into DATA_DIR/secrets.json unless set via env
    SECRET_KEY: str | None = None
    JWT_SECRET_KEY: str | None = None
    INTERNAL_TOKEN: str | None = None
    BOX_URL: str | None = None  # e.g. http://192.168.1.20:3000, used in reset links
    NTFY_URL: str | None = None  # internal backend -> ntfy, e.g. http://ntfy:80
    NTFY_PUBLIC_URL: str | None = None  # what phones use
    NTFY_PORT: str = "2586"  # host port mapping ("2586" or "0.0.0.0:2586"); builds the phone URL
    NTFY_CONF_FILE: str | None = None  # shared server.yml the ntfy container reads
    BLOCKER_URL: str = "http://127.0.0.1:7777"
    LOCK_INTERVAL_SECONDS: int = 30
    LOCK_LOOP_ENABLED: bool = True
    INTEGRATIONS_LOOP_ENABLED: bool = True
    REGISTRY_URL: str = "https://taskfrce.jmolabs.dev"
    # Peers allowed to set X-Real-IP (our frontend proxy); comma list
    TRUSTED_PROXY_IPS: str = "127.0.0.1,::1,::ffff:127.0.0.1"
    # Local push keys (integration-local): client IPs allowed, minus the exclude list.
    # Exclude wins; it covers loopback, link-local and our Docker bridges (host tunnels via
    # docker-proxy arrive from the bridge gateway, so they must not count as the LAN).
    LOCAL_PUSH_CIDRS: str = "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fd00::/8"
    LOCAL_PUSH_EXCLUDE_CIDRS: str = (
        "127.0.0.0/8,::1/128,169.254.0.0/16,fe80::/10,"
        "172.17.0.0/16,172.29.40.0/24,172.29.50.0/24,fd00:4ce::/64"
    )
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    REFRESH_TOKEN_REMEMBER_DAYS: int = 30  # 'Keep me logged in'

    # Database settings
    DATABASE_URL: str | None = None  # default: sqlite:///{DATA_DIR}/task4ce.db

    # CORS settings
    BACKEND_CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:8000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:8000",
    ]

    @model_validator(mode="after")
    def fill_data_dir_defaults(self) -> "Settings":
        """Create DATA_DIR, derive DATABASE_URL, fill unset secrets."""
        self.DATA_DIR.mkdir(parents=True, exist_ok=True)
        if not self.DATABASE_URL:
            self.DATABASE_URL = f"sqlite:///{self.DATA_DIR}/task4ce.db"
        generated = load_or_create_secrets(self.DATA_DIR)
        for name, value in generated.items():
            if not getattr(self, name):
                setattr(self, name, value)
        return self

    @validator("BACKEND_CORS_ORIGINS", pre=True)
    def assemble_cors_origins(cls, v: str | list[str]) -> list[str] | str:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, (list, str)):
            return v
        raise ValueError(v)

    @field_validator("LOCAL_PUSH_CIDRS", "LOCAL_PUSH_EXCLUDE_CIDRS")
    @classmethod
    def _cidrs(cls, v: str, info) -> str:
        """Fail at startup on a bad range rather than 500 on every push."""
        parts = [p.strip() for p in v.split(",")]
        if info.field_name == "LOCAL_PUSH_CIDRS" and not any(parts):
            raise ValueError("LOCAL_PUSH_CIDRS must list at least one range")
        for p in parts:
            try:
                ipaddress.ip_network(p, strict=False)
            except ValueError as e:
                raise ValueError(f"{info.field_name}: {p!r} is not a CIDR range ({e})") from e
        return ",".join(parts)

    # Email settings

    # File upload settings
    DATA_DIR: Path = Path("./data")
    MAX_UPLOAD_SIZE: int = 10 * 1024 * 1024  # 10MB

    # WebSocket settings

    # Rate limiting settings

    # Logging settings
    LOG_LEVEL: str = "INFO"

    # Security settings

    # Session settings

    # Notification settings

    # Feature flags

    # Performance settings

    # Cache settings

    # Pagination settings

    # Search settings

    # Backup settings

    # Monitoring settings

    # External service settings

    model_config = ConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="ignore",  # Allow extra environment variables to be ignored
    )


# Global settings instance
settings = Settings()


def get_settings() -> Settings:
    """
    Get application settings.
    """
    return settings


def update_settings(**kwargs) -> None:
    """
    Update application settings.
    """
    global settings
    for key, value in kwargs.items():
        if hasattr(settings, key):
            setattr(settings, key, value)


def get_database_url() -> str:
    """
    Get database URL with proper formatting.
    """
    return settings.DATABASE_URL


def is_development() -> bool:
    """
    Check if running in development environment.
    """
    return settings.ENVIRONMENT.lower() in ["development", "dev", "local"]


def is_production() -> bool:
    """
    Check if running in production environment.
    """
    return settings.ENVIRONMENT.lower() in ["production", "prod"]


def is_testing() -> bool:
    """
    Check if running in testing environment.
    """
    return settings.ENVIRONMENT.lower() in ["testing", "test"]


def get_cors_origins() -> list[str]:
    """
    Get CORS origins list.
    """
    return settings.BACKEND_CORS_ORIGINS


def validate_settings() -> dict[str, Any]:
    """
    Validate all settings and return validation results.
    """
    results = {"valid": True, "errors": [], "warnings": []}

    # Check required settings
    if not settings.SECRET_KEY:
        results["errors"].append("SECRET_KEY must be set to a secure value")
        results["valid"] = False

    if not settings.DATABASE_URL:
        results["errors"].append("DATABASE_URL must be set")
        results["valid"] = False

    # Check optional but recommended settings
    if is_production() and settings.DEBUG:
        results["warnings"].append("DEBUG should be False in production")

    if is_production() and not settings.SMTP_HOST:
        results["warnings"].append("Email settings should be configured in production")

    return results
