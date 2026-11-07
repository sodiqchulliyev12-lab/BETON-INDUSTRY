from typing import TYPE_CHECKING

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.order import Order


class Customer(TimestampMixin, Base):
    """Mijozlar. Telefon raqami bo'yicha yagona (+998XXXXXXXXX)."""

    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    phone: Mapped[str] = mapped_column(String(13), unique=True, nullable=False)
    company_name: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)

    orders: Mapped[list["Order"]] = relationship(back_populates="customer")
