from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

from app.schemas.admin_catalog import _check_slug
from app.schemas.common import InputModel, JsonDecimal, OrmModel, clean_text


class ProjectIn(InputModel):
    title: Annotated[str, Field(min_length=2, max_length=200)]
    slug: Annotated[str | None, Field(default=None, max_length=220)]
    description: Annotated[str | None, Field(default=None, max_length=5000)]
    location: Annotated[str | None, Field(default=None, max_length=255)]
    volume_m3: Annotated[Decimal | None, Field(default=None, gt=0, max_digits=12, decimal_places=2)]
    completed_at: date | None = None
    is_published: bool = False
    is_demo: bool = False
    sort_order: Annotated[int, Field(default=0, ge=0, le=10000)]

    @field_validator("description", "location")
    @classmethod
    def _clean(cls, v: str | None) -> str | None:
        return clean_text(v)

    @field_validator("slug")
    @classmethod
    def _slug(cls, v: str | None) -> str | None:
        return _check_slug(v)


class ImageOut(OrmModel):
    id: int
    file_path: str
    caption: str | None
    sort_order: int


class ImageUpdate(InputModel):
    caption: Annotated[str | None, Field(default=None, max_length=255)]
    sort_order: Annotated[int | None, Field(default=None, ge=0, le=10000)]

    @field_validator("caption")
    @classmethod
    def _clean(cls, v: str | None) -> str | None:
        return clean_text(v)


class CoverIn(InputModel):
    image_id: int | None  # None — muqovani olib tashlash


class ProjectAdmin(BaseModel):
    id: int
    title: str
    slug: str
    description: str | None
    location: str | None
    volume_m3: JsonDecimal | None
    completed_at: date | None
    cover_image: str | None
    is_published: bool
    is_demo: bool
    sort_order: int
    images: list[ImageOut]
    created_at: datetime
    updated_at: datetime
