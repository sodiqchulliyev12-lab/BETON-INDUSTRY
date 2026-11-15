"""Yaxshilash choralari rejasi (Analiz bo'limi)."""
from datetime import date

from sqlalchemy import Date, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

ACTION_STATUSES = ("planned", "in_progress", "waiting", "done")


class ImprovementAction(TimestampMixin, Base):
    __tablename__ = "improvement_actions"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    assignee: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(12), server_default="planned", nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
