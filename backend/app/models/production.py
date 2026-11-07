"""Ishlab chiqarish rejalari va haqiqiy ishlab chiqarish yozuvlari.

Zavod quvvati bu yerda emas, system_settings'dagi "production.capacity_m3_per_day" kalitida
saqlanadi va belgilanmagan bo'lsa tizim uni taxmin qilmaydi.
"""
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, pg_enum
from app.models.enums import PlanStatus, QcStatus
from app.models.product import ConcreteProduct


class ProductionPlan(TimestampMixin, Base):
    __tablename__ = "production_plans"
    __table_args__ = (CheckConstraint("planned_volume_m3 > 0", name="volume_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("concrete_products.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    order_id: Mapped[int | None] = mapped_column(
        ForeignKey("orders.id", ondelete="SET NULL"), index=True
    )
    planned_volume_m3: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    status: Mapped[PlanStatus] = mapped_column(
        pg_enum(PlanStatus, "plan_status"), server_default=PlanStatus.PLANNED.value, nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    product: Mapped[ConcreteProduct] = relationship()


class ProductionRecord(TimestampMixin, Base):
    __tablename__ = "production_records"
    __table_args__ = (CheckConstraint("produced_volume_m3 > 0", name="volume_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int | None] = mapped_column(
        ForeignKey("production_plans.id", ondelete="SET NULL"), index=True
    )
    order_id: Mapped[int | None] = mapped_column(
        ForeignKey("orders.id", ondelete="SET NULL"), index=True
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("concrete_products.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    batch_number: Mapped[str | None] = mapped_column(String(50))
    produced_volume_m3: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    produced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    qc_status: Mapped[QcStatus] = mapped_column(
        pg_enum(QcStatus, "qc_status"), server_default=QcStatus.PENDING.value, nullable=False
    )
    qc_notes: Mapped[str | None] = mapped_column(Text)
    qc_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    qc_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    product: Mapped[ConcreteProduct] = relationship()
