"""Umumiy tiplar va yordamchilar."""
import re
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, PlainSerializer

# Decimal JSON'da raqam (float) bo'lib chiqadi — frontend uchun qulay.
# Bazada va hisob-kitoblarda esa aniq Decimal saqlanadi.
JsonDecimal = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]

_LETTER = re.compile(r"[^\W\d_]", re.UNICODE)
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class OrmModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class InputModel(BaseModel):
    """Kiruvchi so'rovlar: ortiqcha maydonlar rad etiladi, satrlar chetidagi bo'shliqlar olib tashlanadi."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def clean_text(value: str | None) -> str | None:
    """Boshqaruv belgilarini olib tashlaydi; bo'sh satr → None."""
    if value is None:
        return None
    value = _CONTROL_CHARS.sub("", value).strip()
    return value or None


def validate_person_name(value: str) -> str:
    value = clean_text(value) or ""
    if len(value) < 2:
        raise ValueError("Ism kamida 2 ta belgidan iborat bo‘lishi kerak.")
    if not _LETTER.search(value):
        raise ValueError("Ism harflardan iborat bo‘lishi kerak.")
    return value


class Message(BaseModel):
    detail: str


class Page[T](BaseModel):
    """Sahifalangan ro'yxat."""

    items: list[T]
    total: int
    page: int
    page_size: int


def like_pattern(value: str) -> str:
    """ILIKE uchun xavfsiz naqsh: foydalanuvchi kiritgan % va _ oddiy belgi sifatida qidiriladi."""
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"
