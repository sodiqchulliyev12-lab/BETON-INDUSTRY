"""Mahalliy vaqt (Asia/Tashkent). Sanalar shu zona bo'yicha tekshiriladi."""
from datetime import date, datetime
from functools import lru_cache
from zoneinfo import ZoneInfo

from app.config import settings


@lru_cache
def local_tz() -> ZoneInfo:
    return ZoneInfo(settings.TIMEZONE)


def now_local() -> datetime:
    return datetime.now(local_tz())


def today_local() -> date:
    return now_local().date()
