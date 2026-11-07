"""Mijozlar, foydalanuvchilar va qayta qo'ng'iroq so'rovlari."""
import re
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

from app.auth import password_problems
from app.models.enums import CallbackStatus, UserRole
from app.schemas.common import InputModel, JsonDecimal, OrmModel, clean_text, validate_person_name
from app.utils.phone import normalize_phone

_USERNAME = re.compile(r"^[a-z0-9_.]{3,50}$")


# --- Mijozlar --------------------------------------------------------------

class CustomerListItem(BaseModel):
    id: int
    full_name: str
    phone: str
    company_name: str | None
    orders_count: int
    total_volume_m3: JsonDecimal
    last_order_at: datetime | None
    created_at: datetime


class CustomerDetail(OrmModel):
    id: int
    full_name: str
    phone: str
    company_name: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class CustomerIn(InputModel):
    full_name: Annotated[str, Field(max_length=150)]
    phone: Annotated[str, Field(max_length=30)]
    company_name: Annotated[str | None, Field(default=None, max_length=200)]
    notes: Annotated[str | None, Field(default=None, max_length=2000)]

    @field_validator("full_name")
    @classmethod
    def _name(cls, value: str) -> str:
        return validate_person_name(value)

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str) -> str:
        return normalize_phone(value)

    @field_validator("company_name", "notes")
    @classmethod
    def _clean(cls, value: str | None) -> str | None:
        return clean_text(value)


# --- Foydalanuvchilar ------------------------------------------------------

def _check_password(value: str) -> str:
    problems = password_problems(value)
    if problems:
        raise ValueError("Parol talabga javob bermaydi: " + ", ".join(problems) + ".")
    return value


class UserCreate(InputModel):
    username: Annotated[str, Field(max_length=50)]
    full_name: Annotated[str, Field(max_length=150)]
    role: UserRole
    password: Annotated[str, Field(max_length=200)]

    @field_validator("username")
    @classmethod
    def _username(cls, value: str) -> str:
        value = value.strip().lower()
        if not _USERNAME.match(value):
            raise ValueError("Login 3–50 belgi: lotin kichik harflari, raqamlar, '_' yoki '.'.")
        return value

    @field_validator("full_name")
    @classmethod
    def _name(cls, value: str) -> str:
        return validate_person_name(value)

    @field_validator("password")
    @classmethod
    def _password(cls, value: str) -> str:
        return _check_password(value)


class UserUpdate(InputModel):
    full_name: Annotated[str | None, Field(default=None, max_length=150)]
    role: UserRole | None = None
    is_active: bool | None = None

    @field_validator("full_name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        return validate_person_name(value) if value is not None else None


class PasswordReset(InputModel):
    password: Annotated[str, Field(max_length=200)]

    @field_validator("password")
    @classmethod
    def _password(cls, value: str) -> str:
        return _check_password(value)


# --- Qayta qo'ng'iroq so'rovlari -------------------------------------------

class CallbackOut(OrmModel):
    id: int
    name: str
    phone: str
    message: str | None
    source_page: str | None
    status: CallbackStatus
    customer_id: int | None
    created_at: datetime
    processed_at: datetime | None


class CallbackStatusIn(InputModel):
    status: CallbackStatus
