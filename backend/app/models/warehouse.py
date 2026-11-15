"""Ombor: xomashyo, ta'minotchilar va qoldiq harakatlari.

Qoldiq saqlanmaydi — u harakatlar yig'indisidan hisoblanadi (stock_movements.quantity ishorali):
kirim (+), chiqim (−), ishlab chiqarishga berish (−), omborlar aro ko'chirish (−/+), inventarizatsiya tuzatishi (±).
"""
from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKey, Index, Numeric, String, Text, true
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAtMixin, TimestampMixin

MATERIAL_CATEGORIES = ("cement", "sand", "gravel", "crushed_stone", "water", "additive", "other")
MATERIAL_UNITS = ("ton", "kg", "m3", "liter")
MOVEMENT_KINDS = ("opening", "in", "out", "production", "transfer_in", "transfer_out", "adjust")
POSITIVE_KINDS = frozenset({"opening", "in", "transfer_in"})
NEGATIVE_KINDS = frozenset({"out", "production", "transfer_out"})


class Warehouse(TimestampMixin, Base):
    __tablename__ = "warehouses"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False)


class Supplier(TimestampMixin, Base):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(13))
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False)


class Material(TimestampMixin, Base):
    __tablename__ = "materials"
    __table_args__ = (
        CheckConstraint("min_stock IS NULL OR min_stock >= 0", name="min_stock_non_negative"),
        CheckConstraint("norm_per_m3 IS NULL OR norm_per_m3 >= 0", name="norm_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sku: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    unit: Mapped[str] = mapped_column(String(10), nullable=False)
    # Minimal qoldiq: undan kam bo'lsa "Kam qoldiq". NULL — chegara belgilanmagan (tizim taxmin qilmaydi).
    min_stock: Mapped[Decimal | None] = mapped_column(Numeric(14, 3))
    # 1 m³ beton uchun me'yor (shu material birligida). NULL — kiritilmagan.
    norm_per_m3: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)


class StockMovement(CreatedAtMixin, Base):
    __tablename__ = "stock_movements"
    __table_args__ = (
        CheckConstraint("quantity <> 0", name="quantity_non_zero"),
        CheckConstraint("unit_price IS NULL OR unit_price >= 0", name="unit_price_non_negative"),
        Index("ix_stock_movements_material_wh", "material_id", "warehouse_id"),
        Index("ix_stock_movements_date", "movement_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    material_id: Mapped[int] = mapped_column(ForeignKey("materials.id", ondelete="RESTRICT"), nullable=False)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False)
    kind: Mapped[str] = mapped_column(String(15), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)  # ishorali
    movement_date: Mapped[date] = mapped_column(Date, nullable=False)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id", ondelete="SET NULL"))
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    transfer_group: Mapped[str | None] = mapped_column(String(36))
    document_no: Mapped[str | None] = mapped_column(String(50))
    note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Ishlab chiqarishdan avtomat chiqim bo'lsa — qaysi yozuvdan (yozuv o'chirilsa, chiqim ham qaytariladi)
    production_record_id: Mapped[int | None] = mapped_column(ForeignKey("production_records.id", ondelete="CASCADE"), index=True)
