"""Eval-kit settings (separate from app.core.config)."""

from pydantic_settings import BaseSettings, SettingsConfigDict

import app

APP_VERSION = f"{app.__version__}-eval"


class EvalSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=True)

    EVAL_UMAMI_URL: str = ""
    EVAL_UMAMI_WEBSITE_ID: str = ""
    EVAL_SUPABASE_URL: str = ""
    EVAL_SUPABASE_ANON_KEY: str = ""


eval_settings = EvalSettings()


def stats_on() -> bool:
    return bool(eval_settings.EVAL_UMAMI_URL and eval_settings.EVAL_UMAMI_WEBSITE_ID)


def feedback_on() -> bool:
    return bool(eval_settings.EVAL_SUPABASE_URL and eval_settings.EVAL_SUPABASE_ANON_KEY)


def any_on() -> bool:
    return stats_on() or feedback_on()
