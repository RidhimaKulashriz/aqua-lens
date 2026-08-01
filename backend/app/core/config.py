"""Application configuration loaded from environment variables."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]
ROOT_ENV_FILE = REPO_ROOT / ".env"


class Settings(BaseSettings):
    """Settings for the AquaLens backend.

    All values are loaded from environment variables. See
    ``/.env.example`` at the repository root for the canonical list.
    """

    model_config = SettingsConfigDict(
        env_file=str(ROOT_ENV_FILE),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    database_url: str = Field(
        default="sqlite:///./aqualens.db",
        description="SQLAlchemy connection URL.",
    )

    cors_allow_origins: str = Field(
        default="http://localhost:3000",
        description="Comma-separated list of origins allowed to call the API.",
    )

    google_api_key: str | None = Field(default=None)
    google_api_key_fallback: str | None = Field(
        default=None,
        description=(
            "Optional second Gemini API key. If set, the reasoning service "
            "automatically retries with this key when the primary key returns "
            "a quota / rate-limit error."
        ),
    )
    google_api_key_fallback_2: str | None = Field(
        default=None,
        description=(
            "Optional third Gemini API key. Used after GOOGLE_API_KEY and "
            "GOOGLE_API_KEY_FALLBACK when both hit quota / rate limits."
        ),
    )
    gemini_model: str = Field(default="gemini-2.0-flash")
    gemini_quota_retry_passes: int = Field(
        default=2,
        ge=1,
        le=5,
        description=(
            "How many full passes the agent runtime should make across configured "
            "Gemini API keys when quota errors occur. Pass #1 is immediate; later "
            "passes wait for a cooldown window before retrying."
        ),
    )
    gemini_quota_cooldown_seconds: float = Field(
        default=8.0,
        ge=0.0,
        le=120.0,
        description=(
            "Cooldown window (seconds) applied to quota-exhausted Gemini keys "
            "before they are retried."
        ),
    )

    @property
    def gemini_api_keys(self) -> list[str]:
        """Ordered list of Gemini API keys to try (primary first)."""
        keys: list[str] = []
        if self.google_api_key:
            keys.append(self.google_api_key)
        if self.google_api_key_fallback and self.google_api_key_fallback not in keys:
            keys.append(self.google_api_key_fallback)
        if self.google_api_key_fallback_2 and self.google_api_key_fallback_2 not in keys:
            keys.append(self.google_api_key_fallback_2)
        return keys

    pc_stac_url: str = Field(
        default="https://earth-search.aws.element84.com/v1",
        description="Microsoft Planetary Computer STAC API root.",
    )

    default_lookback_days: int = Field(default=30, ge=1, le=365)
    max_cloud_cover: float = Field(default=30.0, ge=0.0, le=100.0)

    upload_dir: Path = Field(default=Path("data/uploads"))
    report_dir: Path = Field(default=Path("data/reports"))

    # CI / test overrides.
    aqualens_use_sample_provider: bool = Field(default=False)
    aqualens_fake_gemini: bool = Field(default=False)

    # Multi-agent layer toggle. When True (the default in production),
    # session reasoning runs through the Coordinator → Scout / Historian /
    # Analyst / Reporter agent graph. When False, the pipeline falls
    # back to the single-call ``services/reasoning.py`` path. CI/test jobs
    # may run either mode depending on the suite (unit/API/e2e).
    aqualens_agentic_mode: bool = Field(default=True)
    aqualens_agent_step_delay_ms: int = Field(
        default=0,
        ge=0,
        le=5000,
        description=(
            "Optional UI pacing delay inserted between agent stages in the "
            "orchestrator. Set >0 to make stage transitions visibly sequential."
        ),
    )

    # Gemini embeddings model used by ``semantic_recall_notes`` to find
    # historian memories related to the current session.
    gemini_embedding_model: str = Field(default="text-embedding-004")

    @field_validator("upload_dir", "report_dir", mode="before")
    @classmethod
    def _coerce_path(cls, value: object) -> Path:
        return Path(value) if not isinstance(value, Path) else value

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allow_origins.split(",") if origin.strip()]

    def ensure_dirs(self) -> None:
        """Create local directories used for uploads and reports."""
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.report_dir.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings
