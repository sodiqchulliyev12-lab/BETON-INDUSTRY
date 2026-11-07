"""Transport: haydovchilar, mikser mashinalar va buyurtma qatnovlari.

Transport soni va sig'imi kodda belgilanmagan — hammasi admin paneldan kiritiladi.
"""
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, pg_enum
from app.models.enums import DriverEmployment, TripStatus, VehicleOwnership, VehicleStatus

if TYPE_CHECKING:
    from app.models.order import Order


class Driver(TimestampMixin, Base):
    __tablename__ = "drivers"

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    phone: Mapped[str] = mapped_column(String(13), nullable=False)
    license_number: Mapped[str | None] = mapped_column(String(30))
    employment: Mapped[DriverEmployment] = mapped_column(
        pg_enum(DriverEmployment, "driver_employment"),
        server_default=DriverEmployment.STAFF.value,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)


class Vehicle(TimestampMixin, Base):
    __tablename__ = "vehicles"
    __table_args__ = (
        CheckConstraint("capacity_m3 IS NULL OR capacity_m3 > 0", name="capacity_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    plate_number: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    vehicle_type: Mapped[str] = mapped_column(String(50), nullable=False)  # mikser, nasos, ...
    ownership: Mapped[VehicleOwnership] = mapped_column(
        pg_enum(VehicleOwnership, "vehicle_ownership"), nullable=False
    )
    capacity_m3: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))  # noma'lum bo'lsa NULL
    default_driver_id: Mapped[int | None] = mapped_column(ForeignKey("drivers.id", ondelete="SET NULL"))
    contact_phone: Mapped[str | None] = mapped_column(String(13))
    rental_company: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[VehicleStatus] = mapped_column(
        pg_enum(VehicleStatus, "vehicle_status"), server_default=VehicleStatus.FREE.value, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)

    default_driver: Mapped[Driver | None] = relationship()


class OrderTrip(TimestampMixin, Base):
    """Buyurtmaga biriktirilgan qatnov. Bitta buyurtmada bir nechta mashina/qatnov bo'lishi mumkin."""

    __tablename__ = "order_trips"
    __table_args__ = (
        UniqueConstraint("order_id", "trip_no", name="uq_order_trips_order_trip_no"),
        CheckConstraint("volume_m3 > 0", name="volume_positive"),
        CheckConstraint("rental_cost IS NULL OR rental_cost >= 0", name="rental_cost_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    vehicle_id: Mapped[int] = mapped_column(
        ForeignKey("vehicles.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    driver_id: Mapped[int | None] = mapped_column(ForeignKey("drivers.id", ondelete="SET NULL"))
    trip_no: Mapped[int] = mapped_column(Integer, nullable=False)
    volume_m3: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    status: Mapped[TripStatus] = mapped_column(
        pg_enum(TripStatus, "trip_status"), server_default=TripStatus.PLANNED.value, nullable=False
    )
    loaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    departed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rental_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))  # ijara transporti xarajati
    notes: Mapped[str | None] = mapped_column(Text)

    order: Mapped["Order"] = relationship(back_populates="trips")
    vehicle: Mapped[Vehicle] = relationship()
    driver: Mapped[Driver | None] = relationship()
