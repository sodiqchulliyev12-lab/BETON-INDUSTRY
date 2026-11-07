"""Tizim va Telegram sozlamalari."""
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, String, Text, false, func, text, true
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SystemSetting(Base):
    """Kalit-qiymat sozlamalar: telefon, manzil, ish vaqti, ishlab chiqarish quvvati va h.k.

    value = NULL — "kiritilmagan". Faqat is_public=true kalitlar saytga chiqadi.
    """

    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[Any | None] = mapped_column(JSONB)
    is_public: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class TelegramSettings(Base):
    """Yagona qatorli jadval (id=1). Bot tokeni maxfiy — u .env faylida, bu yerda emas."""

    __tablename__ = "telegram_settings"
    __table_args__ = (CheckConstraint("id = 1", name="single_row"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)
    chat_ids: Mapped[list[str]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"), nullable=False)
    notify_new_order: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False)
    notify_status_change: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)
    notify_callback: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False)
    message_template: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
