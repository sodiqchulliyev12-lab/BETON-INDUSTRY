"""Buyurtma raqami: BI-2026-000123. PostgreSQL ketma-ketligi raqam takrorlanmasligini kafolatlaydi."""
from sqlalchemy.orm import Session

from app.models import order_number_seq
from app.utils.timezone import today_local

PREFIX = "BI"


def next_order_number(db: Session) -> str:
    value = db.execute(order_number_seq.next_value()).scalar_one()
    return f"{PREFIX}-{today_local().year}-{value:06d}"
