"""Ilova sozlamalari. Barcha maxfiy qiymatlar .env faylidan yoki muhit o'zgaruvchilaridan olinadi."""
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent

_WEAK_SECRETS = {"change-me-to-a-long-random-secret-at-least-32-chars"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    APP_NAME: str = "BETON INDUSTRY"
    APP_ENV: Literal["development", "production", "test"] = "development"

    DATABASE_URL: str
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10

    SECRET_KEY: str = Field(min_length=32)
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(default=30, ge=5, le=24 * 60)
    REFRESH_TOKEN_EXPIRE_DAYS: int = Field(default=7, ge=1, le=60)

    ALLOWED_ORIGINS: str = ""
    # Server qaysi domen nomlariga javob beradi (Host header). Bo'sh — cheklanmaydi.
    # Masalan: beton.uz,www.beton.uz,beton-industry.up.railway.app
    ALLOWED_HOSTS: str = ""
    # Bitta so'rov tanasining eng katta hajmi (rasm 5 MB + forma maydonlari)
    MAX_REQUEST_BYTES: int = 6 * 1024 * 1024
    TIMEZONE: str = "Asia/Tashkent"

    SERVE_FRONTEND: bool = True
    FRONTEND_DIR: Path = PROJECT_DIR / "frontend"
    UPLOAD_DIR: Path = BACKEND_DIR / "uploads"

    RATE_LIMIT_ENABLED: bool = True

    # Telegram: token faqat shu yerda (.env) saqlanadi, bazaga ham, frontendga ham chiqmaydi
    TELEGRAM_BOT_TOKEN: str | None = None
    TELEGRAM_API_BASE: str = "https://api.telegram.org"
    TELEGRAM_TIMEOUT_SECONDS: float = 10.0

    # Saytning ommaviy manzili (masalan https://beton.uz). Telegram xabarida admin havolasi uchun.
    PUBLIC_BASE_URL: str | None = None

    # Manzil qidirish (OpenStreetMap Nominatim). Brauzer to'g'ridan-to'g'ri emas, backend orqali murojaat qiladi.
    # Ommaviy Nominatim: sekundiga ko'pi bilan 1 so'rov. Ko'p trafik uchun o'z serveringiz yoki pullik provayder.
    GEOCODER_ENABLED: bool = True
    GEOCODER_URL: str = "https://nominatim.openstreetmap.org"
    GEOCODER_TIMEOUT_SECONDS: float = 8.0

    @field_validator("TELEGRAM_BOT_TOKEN", "PUBLIC_BASE_URL")
    @classmethod
    def _empty_to_none(cls, value: str | None) -> str | None:
        return value.strip().rstrip("/") or None if value else None

    # Bitta buyurtma hajmi chegaralari (m³) — frontend/js/config.js bilan bir xil
    MIN_ORDER_VOLUME_M3: Decimal = Decimal("0.5")
    MAX_ORDER_VOLUME_M3: Decimal = Decimal("1000")
    MAX_DELIVERY_DAYS_AHEAD: int = 365

    @field_validator("DATABASE_URL")
    @classmethod
    def _normalize_database_url(cls, value: str) -> str:
        # Railway/Heroku "postgres://" yoki "postgresql://" beradi — psycopg 3 drayverini aniq ko'rsatamiz
        if value.startswith("postgres://"):
            value = "postgresql://" + value[len("postgres://"):]
        if value.startswith("postgresql://"):
            value = "postgresql+psycopg://" + value[len("postgresql://"):]
        return value

    @model_validator(mode="after")
    def _check_production(self) -> "Settings":
        if self.APP_ENV == "production":
            if self.SECRET_KEY in _WEAK_SECRETS:
                raise ValueError("Production muhitida SECRET_KEY namunadagi qiymat bo'lishi mumkin emas.")
            if "*" in self.cors_origins:
                raise ValueError("Production muhitida ALLOWED_ORIGINS='*' ishlatib bo'lmaydi.")
        return self

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def allowed_hosts(self) -> list[str]:
        return [h.strip().lower() for h in self.ALLOWED_HOSTS.split(",") if h.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
