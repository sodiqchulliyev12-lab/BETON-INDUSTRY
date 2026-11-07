from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, text, true
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, pg_enum
from app.models.enums import UserRole


class User(TimestampMixin, Base):
    """Admin panel foydalanuvchilari (xodimlar)."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(pg_enum(UserRole, "user_role"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Parol almashtirilsa yoki foydalanuvchi bloklansa oshiriladi — eski tokenlar darhol yaroqsiz bo'ladi
    token_version: Mapped[int] = mapped_column(Integer, server_default=text("0"), nullable=False)

    def __repr__(self) -> str:
        return f"<User {self.username} ({self.role})>"
