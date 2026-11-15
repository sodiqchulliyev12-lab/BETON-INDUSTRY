"""Sotuv: mijoz olmagan (qaytgan) beton — boshqa mijozga sotiladi yoki brak bo'ladi."""
from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

RETURN_OUTCOMES = ("pending", "resold", "brak")


class ConcreteReturn(TimestampMixin, Base):
    """Mijoz olmagan yoki qaytargan beton. Natija: kutilmoqda / boshqa mijozga sotildi / brak (yaroqsiz)."""

    __tablename__ = "concrete_returns"
    __table_args__ = (
        CheckConstraint("volume_m3 > 0", name="volume_positive"),
        CheckConstraint("outcome IN ('pending', 'resold', 'brak')", name="outcome_valid"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    returned_on: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), index=True)  # kim olmadi
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id", ondelete="SET NULL"))
    product_id: Mapped[int | None] = mapped_column(ForeignKey("concrete_products.id", ondelete="SET NULL"))
    volume_m3: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    outcome: Mapped[str] = mapped_column(String(10), server_default="pending", nullable=False)
    resold_order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"))  # kimga sotildi
    note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
