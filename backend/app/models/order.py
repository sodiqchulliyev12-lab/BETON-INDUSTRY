from datetime import date, time
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Numeric,
    Sequence,
    String,
    Text,
    Time,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, CreatedAtMixin, TimestampMixin, pg_enum
from app.models.enums import DeliveryPriceStatus, OrderSource, OrderStatus

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.fleet import OrderTrip
    from app.models.product import ConcreteProduct

# Buyurtma raqami uchun ketma-ketlik: BI-2026-000001
order_number_seq = Sequence("order_number_seq", metadata=Base.metadata)


class Order(TimestampMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("delivery_price IS NULL OR delivery_price >= 0", name="delivery_price_non_negative"),
        CheckConstraint(
            "NOT delivery_required OR delivery_address IS NOT NULL",
            name="delivery_address_required",
        ),
        CheckConstraint(
            "(delivery_lat IS NULL) = (delivery_lon IS NULL)"
            " AND (delivery_lat IS NULL OR delivery_lat BETWEEN -90 AND 90)"
            " AND (delivery_lon IS NULL OR delivery_lon BETWEEN -180 AND 180)",
            name="delivery_point_valid",
        ),
        Index("ix_orders_status_created_at", "status", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_number: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    customer_id: Mapped[int] = mapped_column(
        ForeignKey("customers.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    status: Mapped[OrderStatus] = mapped_column(
        pg_enum(OrderStatus, "order_status"), server_default=OrderStatus.NEW.value, nullable=False
    )
    source: Mapped[OrderSource] = mapped_column(
        pg_enum(OrderSource, "order_source"), server_default=OrderSource.WEBSITE.value, nullable=False
    )

    delivery_required: Mapped[bool] = mapped_column(Boolean, nullable=False)
    delivery_address: Mapped[str | None] = mapped_column(Text)
    # Xaritadan tanlangan nuqta (ixtiyoriy). Faqat ma'lumot uchun — narx avtomatik hisoblanmaydi.
    delivery_lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    delivery_lon: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    delivery_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    delivery_time: Mapped[time | None] = mapped_column(Time)
    comment: Mapped[str | None] = mapped_column(Text)

    # Summalar. NULL — "hali aniqlanmagan" degani (0 emas!)
    concrete_total: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    delivery_price: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    delivery_price_status: Mapped[DeliveryPriceStatus] = mapped_column(
        pg_enum(DeliveryPriceStatus, "delivery_price_status"), nullable=False
    )
    grand_total: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), server_default=text("'UZS'"), nullable=False)

    manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    cancel_reason: Mapped[str | None] = mapped_column(Text)

    customer: Mapped["Customer"] = relationship(back_populates="orders")
    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="OrderItem.id"
    )
    status_history: Mapped[list["OrderStatusHistory"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="OrderStatusHistory.id"
    )
    trips: Mapped[list["OrderTrip"]] = relationship(back_populates="order", order_by="OrderTrip.trip_no")


class OrderItem(Base):
    """Buyurtma tarkibi. Narx va marka nomi buyurtma paytidagi holatida saqlanadi."""

    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint("volume_m3 > 0", name="volume_positive"),
        CheckConstraint("unit_price IS NULL OR unit_price >= 0", name="unit_price_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("concrete_products.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    product_name: Mapped[str] = mapped_column(String(150), nullable=False)
    grade_class: Mapped[str] = mapped_column(String(20), nullable=False)
    volume_m3: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))  # NULL — narx belgilanmagan edi
    line_total: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))

    order: Mapped[Order] = relationship(back_populates="items")
    product: Mapped["ConcreteProduct"] = relationship()


class OrderStatusHistory(CreatedAtMixin, Base):
    """Kim, qachon, qaysi holatga o'tkazgani."""

    __tablename__ = "order_status_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    from_status: Mapped[OrderStatus | None] = mapped_column(pg_enum(OrderStatus, "order_status"))
    to_status: Mapped[OrderStatus] = mapped_column(pg_enum(OrderStatus, "order_status"), nullable=False)
    changed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(Text)

    order: Mapped[Order] = relationship(back_populates="status_history")
