"""Laboratoriya: beton namunalari va siqilishga sinov natijalari."""
from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, CreatedAtMixin, TimestampMixin
from app.models.product import ConcreteProduct


class LabSample(TimestampMixin, Base):
    __tablename__ = "lab_samples"
    __table_args__ = (CheckConstraint("slump_cm IS NULL OR slump_cm >= 0", name="slump_non_negative"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sample_no: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("concrete_products.id", ondelete="RESTRICT"), index=True, nullable=False)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"))
    production_record_id: Mapped[int | None] = mapped_column(ForeignKey("production_records.id", ondelete="SET NULL"))
    sampled_on: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    operator: Mapped[str | None] = mapped_column(String(100))
    slump_cm: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))  # osma konus cho'kishi
    notes: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    product: Mapped[ConcreteProduct] = relationship()
    tests: Mapped[list["LabTest"]] = relationship(
        back_populates="sample", cascade="all, delete-orphan", order_by="LabTest.age_days"
    )


class LabTest(CreatedAtMixin, Base):
    """Kub (150×150×150 mm) siqilishga sinovi. Mustahkamlik MPa = kuch (kN) / 22,5."""

    __tablename__ = "lab_tests"
    __table_args__ = (
        UniqueConstraint("sample_id", "age_days", name="uq_lab_tests_sample_age"),
        CheckConstraint("age_days BETWEEN 1 AND 365", name="age_range"),
        CheckConstraint("force_kn > 0", name="force_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sample_id: Mapped[int] = mapped_column(ForeignKey("lab_samples.id", ondelete="CASCADE"), index=True, nullable=False)
    age_days: Mapped[int] = mapped_column(Integer, nullable=False)
    tested_on: Mapped[date] = mapped_column(Date, nullable=False)
    force_kn: Mapped[Decimal] = mapped_column(Numeric(8, 1), nullable=False)
    strength_mpa: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    operator: Mapped[str | None] = mapped_column(String(100))
    notes: Mapped[str | None] = mapped_column(Text)

    sample: Mapped[LabSample] = relationship(back_populates="tests")
