"""KPI: mijozdan tushgan to'lovlar va har bir mijoz bo'yicha kelishilgan bonus foizlari."""
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAtMixin, TimestampMixin


class OrderPayment(CreatedAtMixin, Base):
    """Buyurtma uchun mijozdan tushgan pul (bir buyurtmaga bir necha to'lov bo'lishi mumkin)."""

    __tablename__ = "order_payments"
    __table_args__ = (CheckConstraint("amount > 0", name="amount_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    paid_on: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class CustomerKpiRate(TimestampMixin, Base):
    """Mijoz bo'yicha kelishilgan foizlar: to'lov necha kun ichida kelganiga qarab (sotuvchi bonusi)."""

    __tablename__ = "customer_kpi_rates"
    __table_args__ = (
        CheckConstraint("pct_10 BETWEEN 0 AND 100 AND pct_20 BETWEEN 0 AND 100 AND pct_30 BETWEEN 0 AND 100 AND pct_over BETWEEN 0 AND 100", name="pct_range"),
    )

    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), primary_key=True)
    pct_10: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)    # 10 kun ichida
    pct_20: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)    # 11–20 kun
    pct_30: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)    # 21–30 kun
    pct_over: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)  # 30 kundan keyin


class CustomerKpiMonthRate(TimestampMixin, Base):
    """Oy bo'yicha belgilangan va tasdiqlangan foizlar: har oyda mijoz uchun foiz kelishiladi va tasdiqlanadi."""

    __tablename__ = "customer_kpi_month_rates"
    __table_args__ = (
        CheckConstraint("pct_10 BETWEEN 0 AND 100 AND pct_20 BETWEEN 0 AND 100 AND pct_30 BETWEEN 0 AND 100 AND pct_over BETWEEN 0 AND 100", name="pct_range"),
    )

    month: Mapped[date] = mapped_column(Date, primary_key=True)  # oyning 1-kuni
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), primary_key=True)
    pct_10: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    pct_20: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    pct_30: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    pct_over: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # NULL — hali tasdiqlanmagan
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
