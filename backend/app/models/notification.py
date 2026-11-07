from datetime import datetime

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAtMixin


class NotificationLog(CreatedAtMixin, Base):
    """Yuborilgan xabarnomalar jurnali: nima, kimga, yuborildimi yoki nima xato bo'ldi."""

    __tablename__ = "notification_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    channel: Mapped[str] = mapped_column(String(20), nullable=False)        # telegram
    event: Mapped[str] = mapped_column(String(30), index=True, nullable=False)  # new_order, status_change, callback, test
    recipient: Mapped[str] = mapped_column(String(100), nullable=False)     # chat_id
    status: Mapped[str] = mapped_column(String(10), nullable=False)         # sent | failed
    error: Mapped[str | None] = mapped_column(Text)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), index=True)
