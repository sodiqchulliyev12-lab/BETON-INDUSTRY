import re
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import InputModel, JsonDecimal, OrmModel, clean_text
from app.schemas.product import PriceOut, SpecItem

_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _check_slug(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    value = value.strip().lower()
    if not _SLUG.match(value):
        raise ValueError("Faqat lotin kichik harflari, raqamlar va '-' ishlatiladi (masalan: b25-p3).")
    return value


class SpecIn(InputModel):
    label: Annotated[str, Field(min_length=1, max_length=80)]
    value: Annotated[str, Field(min_length=1, max_length=120)]


class ProductIn(InputModel):
    name: Annotated[str, Field(min_length=2, max_length=150)]
    grade_class: Annotated[str, Field(min_length=1, max_length=20)]
    slug: Annotated[str | None, Field(default=None, max_length=160)]
    description: Annotated[str | None, Field(default=None, max_length=2000)]
    specs: Annotated[list[SpecIn], Field(default_factory=list, max_length=30)]
    is_active: bool = True
    is_available: bool = True
    is_demo: bool = False
    sort_order: Annotated[int, Field(default=0, ge=0, le=10000)]

    @field_validator("description")
    @classmethod
    def _desc(cls, value: str | None) -> str | None:
        return clean_text(value)

    @field_validator("slug")
    @classmethod
    def _slug(cls, value: str | None) -> str | None:
        return _check_slug(value)


class ProductPatch(InputModel):
    """Qisman tahrir (masalan, faqat 'sotuvda' belgisini almashtirish)."""

    name: Annotated[str | None, Field(default=None, min_length=2, max_length=150)]
    grade_class: Annotated[str | None, Field(default=None, min_length=1, max_length=20)]
    slug: Annotated[str | None, Field(default=None, max_length=160)]
    description: Annotated[str | None, Field(default=None, max_length=2000)]
    specs: Annotated[list[SpecIn] | None, Field(default=None, max_length=30)]
    is_active: bool | None = None
    is_available: bool | None = None
    is_demo: bool | None = None
    sort_order: Annotated[int | None, Field(default=None, ge=0, le=10000)]

    @field_validator("description")
    @classmethod
    def _desc(cls, value: str | None) -> str | None:
        return clean_text(value)

    @field_validator("slug")
    @classmethod
    def _slug(cls, value: str | None) -> str | None:
        return _check_slug(value)


class ProductAdmin(BaseModel):
    id: int
    slug: str
    name: str
    grade_class: str
    description: str | None
    specs: list[SpecItem]
    is_active: bool
    is_available: bool
    is_demo: bool
    sort_order: int
    price: PriceOut | None
    price_updated_at: datetime | None
    orders_count: int
    created_at: datetime
    updated_at: datetime


class PriceIn(InputModel):
    price_per_m3: Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]
    note: Annotated[str | None, Field(default=None, max_length=255)]

    @field_validator("note")
    @classmethod
    def _note(cls, value: str | None) -> str | None:
        return clean_text(value)


class PriceHistoryItem(OrmModel):
    id: int
    price_per_m3: JsonDecimal
    currency: str
    valid_from: datetime
    valid_to: datetime | None
    note: str | None
    created_by: str | None = None
