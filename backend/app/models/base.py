"""SQLAlchemy asosiy klassi va umumiy yordamchilar."""
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, Enum, MetaData, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Cheklovlar (index, FK, unique, check) uchun barqaror nomlar — Alembic migratsiyalari aniq bo'ladi
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class CreatedAtMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


def pg_enum(enum_cls: type[StrEnum], name: str) -> Enum:
    """PostgreSQL ENUM turi; bazada enum qiymatlari (kichik harf) saqlanadi."""
    return Enum(
        enum_cls,
        name=name,
        values_callable=lambda cls: [member.value for member in cls],
        validate_strings=True,
    )
