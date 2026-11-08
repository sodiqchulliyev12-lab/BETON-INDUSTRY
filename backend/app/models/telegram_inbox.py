"""Telegram guruhlaridan keladigan xabarlar (ishlab chiqarish, kassa-bank, xomashyo kirimi).

1-bosqich: xabarlar o'zgartirilmasdan saqlanadi va Google Sheets'ga "xom" ko'rinishda yoziladi.
2-bosqich: haqiqiy namunalar asosida tahlil qilinib, `parsed` maydoni to'ldiriladi.
"""
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, true
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, CreatedAtMixin, TimestampMixin, pg_enum
from app.models.enums import ChatPurpose


class TelegramChat(TimestampMixin, Base):
    """Bot qo'shilgan guruh. Vazifasi (purpose) admin panelda belgilanadi."""

    __tablename__ = "telegram_chats"

    chat_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    title: Mapped[str | None] = mapped_column(String(255))
    chat_type: Mapped[str] = mapped_column(String(20), nullable=False)  # group, supergroup, channel
    # NULL — hali belgilanmagan: xabarlar saqlanadi, lekin Google Sheets'ga yuborilmaydi
    purpose: Mapped[ChatPurpose | None] = mapped_column(pg_enum(ChatPurpose, "chat_purpose"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False)

    messages: Mapped[list["TelegramMessage"]] = relationship(back_populates="chat")


class TelegramMessage(CreatedAtMixin, Base):
    __tablename__ = "telegram_messages"
    __table_args__ = (UniqueConstraint("chat_id", "message_id", name="uq_telegram_messages_chat_message"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    chat_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("telegram_chats.chat_id", ondelete="CASCADE"), index=True, nullable=False
    )
    message_id: Mapped[int] = mapped_column(Integer, nullable=False)
    from_user_id: Mapped[int | None] = mapped_column(BigInteger)
    from_name: Mapped[str | None] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(20), nullable=False)  # text, photo, document, ...
    text: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 2-bosqichda to'ldiriladi (marka, hajm, summa...)
    parsed: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # Google Sheets'ga yozilish holati: pending | sent | failed | skipped
    sheets_status: Mapped[str] = mapped_column(String(10), server_default="pending", nullable=False)
    sheets_error: Mapped[str | None] = mapped_column(String(500))

    chat: Mapped[TelegramChat] = relationship(back_populates="messages")
