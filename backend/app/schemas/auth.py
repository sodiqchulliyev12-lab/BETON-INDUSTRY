from datetime import datetime
from typing import Annotated

from pydantic import Field

from app.models.enums import UserRole
from app.schemas.common import InputModel, OrmModel


class LoginIn(InputModel):
    username: Annotated[str, Field(min_length=1, max_length=50)]
    password: Annotated[str, Field(min_length=1, max_length=200)]


class UserOut(OrmModel):
    id: int
    username: str
    full_name: str
    role: UserRole
    is_active: bool
    last_login_at: datetime | None
    created_at: datetime


class MeOut(UserOut):
    permissions: list[str]


class TokenOut(OrmModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: MeOut
