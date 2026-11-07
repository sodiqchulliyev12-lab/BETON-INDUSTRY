from typing import Annotated

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import InputModel, clean_text, validate_person_name
from app.utils.phone import normalize_phone

_ALLOWED_PAGES = {"home", "products", "calculator", "order", "projects", "about", "contact"}


class CallbackCreate(InputModel):
    name: Annotated[str, Field(max_length=100)]
    phone: Annotated[str, Field(max_length=30)]
    message: Annotated[str | None, Field(default=None, max_length=1000)]
    source_page: Annotated[str | None, Field(default=None, max_length=30)]
    website: Annotated[str, Field(default="", max_length=200)]  # honeypot

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return validate_person_name(value)

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str) -> str:
        return normalize_phone(value)

    @field_validator("message")
    @classmethod
    def _message(cls, value: str | None) -> str | None:
        return clean_text(value)

    @field_validator("source_page")
    @classmethod
    def _page(cls, value: str | None) -> str | None:
        return value if value in _ALLOWED_PAGES else None


class CallbackCreated(BaseModel):
    id: int
    detail: str = "So‘rovingiz qabul qilindi."
