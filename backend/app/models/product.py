from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    false,
    func,
    text,
    true,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, CreatedAtMixin, TimestampMixin


class ConcreteProduct(TimestampMixin, Base):
    """Beton markalari katalogi. Barcha markalar admin paneldan kiritiladi."""

    __tablename__ = "concrete_products"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    slug: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    grade_class: Mapped[str] = mapped_column(String(20), nullable=False)  # masalan "B25"
    description: Mapped[str | None] = mapped_column(Text)
    # Texnik xususiyatlar: [{"label": "Harakatchanlik", "value": "P3"}, ...]
    specs: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False)
    is_available: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, server_default=text("0"), nullable=False)

    # Marka o'chirilsa narxlari bazaning o'zida (ON DELETE CASCADE) o'chadi
    prices: Mapped[list["ConcretePrice"]] = relationship(
        back_populates="product",
        order_by="ConcretePrice.valid_from.desc()",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class ConcretePrice(CreatedAtMixin, Base):
    """Narxlar tarixi. Amaldagi narx — valid_to IS NULL bo'lgan yagona yozuv."""

    __tablename__ = "concrete_prices"
    __table_args__ = (
        CheckConstraint("price_per_m3 >= 0", name="price_non_negative"),
        CheckConstraint("valid_to IS NULL OR valid_to > valid_from", name="valid_range"),
        # Har bir marka uchun bir vaqtda faqat bitta amaldagi narx
        Index(
            "uq_concrete_prices_current",
            "product_id",
            unique=True,
            postgresql_where=text("valid_to IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("concrete_products.id", ondelete="CASCADE"), index=True, nullable=False
    )
    price_per_m3: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), server_default=text("'UZS'"), nullable=False)
    valid_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(String(255))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    product: Mapped[ConcreteProduct] = relationship(back_populates="prices")
