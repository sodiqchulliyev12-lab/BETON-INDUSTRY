"""Narx va hisob-kitob — tizimdagi YAGONA manba.

    Beton qiymati = Beton hajmi (m³) × 1 m³ narxi

Yetkazib berish narxi belgilanmagan bo'lsa u 0 deb olinmaydi: holati "pending"
bo'lib qoladi va umumiy summa (grand_total) menejer tasdiqlaguncha NULL.
"""
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ConcretePrice
from app.models.enums import DeliveryPriceStatus

CENT = Decimal("0.01")


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def current_price(db: Session, product_id: int) -> ConcretePrice | None:
    """Amaldagi narx: valid_to IS NULL (bunday yozuv bittadan ko'p bo'la olmaydi)."""
    return db.scalar(
        select(ConcretePrice).where(
            ConcretePrice.product_id == product_id,
            ConcretePrice.valid_to.is_(None),
        )
    )


def current_prices(db: Session, product_ids: list[int]) -> dict[int, ConcretePrice]:
    if not product_ids:
        return {}
    rows = db.scalars(
        select(ConcretePrice).where(
            ConcretePrice.product_id.in_(product_ids),
            ConcretePrice.valid_to.is_(None),
        )
    )
    return {row.product_id: row for row in rows}


@dataclass(frozen=True)
class Estimate:
    unit_price: Decimal | None
    currency: str
    concrete_total: Decimal | None
    delivery_price: Decimal | None
    delivery_price_status: DeliveryPriceStatus
    grand_total: Decimal | None


def calculate(
    volume_m3: Decimal,
    price: ConcretePrice | None,
    delivery_required: bool,
    delivery_price: Decimal | None = None,
) -> Estimate:
    unit_price = price.price_per_m3 if price else None
    currency = price.currency if price else "UZS"
    concrete_total = money(volume_m3 * unit_price) if unit_price is not None else None

    if not delivery_required:
        status, delivery = DeliveryPriceStatus.NOT_REQUIRED, None
    elif delivery_price is None:
        status, delivery = DeliveryPriceStatus.PENDING, None
    else:
        status, delivery = DeliveryPriceStatus.CONFIRMED, money(delivery_price)

    if concrete_total is None or status == DeliveryPriceStatus.PENDING:
        grand_total = None
    else:
        grand_total = concrete_total + (delivery or Decimal("0"))

    return Estimate(
        unit_price=unit_price,
        currency=currency,
        concrete_total=concrete_total,
        delivery_price=delivery,
        delivery_price_status=status,
        grand_total=grand_total,
    )
