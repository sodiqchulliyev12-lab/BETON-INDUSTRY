from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAtMixin, pg_enum
from app.models.enums import CallbackStatus


class CallbackRequest(CreatedAtMixin, Base):
    """Saytdagi "Qayta qo'ng'iroq" / "Xabar qoldiring" so'rovlari."""

    __tablename__ = "callback_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[str] = mapped_column(String(13), index=True, nullable=False)
    message: Mapped[str | None] = mapped_column(Text)
    source_page: Mapped[str | None] = mapped_column(String(30))
    status: Mapped[CallbackStatus] = mapped_column(
        pg_enum(CallbackStatus, "callback_status"), server_default=CallbackStatus.NEW.value, nullable=False
    )
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id", ondelete="SET NULL"))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    processed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
