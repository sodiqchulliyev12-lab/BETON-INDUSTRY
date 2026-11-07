"""Dashboard statistikasi. Faqat bazadagi haqiqiy ma'lumotlardan hisoblanadi — hech narsa taxmin qilinmaydi."""
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import CallbackRequest, Order, OrderItem, SystemSetting
from app.models.enums import CallbackStatus, OrderStatus
from app.utils.timezone import local_tz, today_local

S = OrderStatus
IN_PRODUCTION = (S.IN_PRODUCTION, S.QUALITY_CHECK)
ACTIVE_LOGISTICS = (S.LOADED, S.IN_TRANSIT)


def _f(value: Decimal | None) -> float:
    return float(value or 0)


def dashboard(db: Session, days: int = 30) -> dict[str, Any]:
    by_status = {status.value: 0 for status in OrderStatus}
    for status, count in db.execute(select(Order.status, func.count()).group_by(Order.status)):
        by_status[status.value] = count
    total_orders = sum(by_status.values())

    not_cancelled = Order.status != S.CANCELLED
    volume_rows = dict(
        db.execute(
            select(Order.status, func.coalesce(func.sum(OrderItem.volume_m3), 0))
            .join(OrderItem, OrderItem.order_id == Order.id)
            .group_by(Order.status)
        ).all()
    )
    total_volume = sum((v for s, v in volume_rows.items() if s != S.CANCELLED), Decimal("0"))
    delivered_volume = volume_rows.get(S.DELIVERED, Decimal("0"))
    open_volume = sum(
        (v for s, v in volume_rows.items() if s not in (S.CANCELLED, S.DELIVERED)), Decimal("0")
    )

    # Kunlik grafik: buyurtma yaratilgan sana bo'yicha (mahalliy vaqt).
    # Kunlarga ajratish Python'da — bazadagi vaqt zonalari sozlamasiga bog'liq bo'lmasligi uchun.
    tz = local_tz()
    today = today_local()
    start = today - timedelta(days=days - 1)
    start_utc = datetime.combine(start, time.min, tzinfo=tz)
    per_order = db.execute(
        select(Order.id, Order.created_at, func.coalesce(func.sum(OrderItem.volume_m3), 0))
        .join(OrderItem, OrderItem.order_id == Order.id)
        .where(Order.created_at >= start_utc, not_cancelled)
        .group_by(Order.id, Order.created_at)
    ).all()
    buckets: dict[date, list[Decimal]] = {}
    for _id, created_at, volume in per_order:
        buckets.setdefault(created_at.astimezone(tz).date(), []).append(volume)
    daily = []
    for offset in range(days):
        day: date = start + timedelta(days=offset)
        volumes = buckets.get(day, [])
        daily.append({"date": day.isoformat(), "orders": len(volumes), "volume_m3": _f(sum(volumes, Decimal("0")))})

    by_product = [
        {"grade_class": grade, "product_name": name, "volume_m3": _f(volume), "orders": orders}
        for grade, name, volume, orders in db.execute(
            select(
                OrderItem.grade_class,
                OrderItem.product_name,
                func.sum(OrderItem.volume_m3),
                func.count(func.distinct(OrderItem.order_id)),
            )
            .join(Order, Order.id == OrderItem.order_id)
            .where(not_cancelled)
            .group_by(OrderItem.grade_class, OrderItem.product_name)
            .order_by(func.sum(OrderItem.volume_m3).desc())
        )
    ]

    upcoming = db.execute(
        select(func.count(), func.coalesce(func.sum(OrderItem.volume_m3), 0))
        .select_from(Order)
        .join(OrderItem, OrderItem.order_id == Order.id)
        .where(Order.delivery_date == today, Order.status.notin_((S.CANCELLED, S.DELIVERED)))
    ).one()

    capacity = db.scalar(select(SystemSetting.value).where(SystemSetting.key == "production.capacity_m3_per_day"))

    return {
        "has_data": total_orders > 0,
        "totals": {
            "orders": total_orders,
            "new": by_status[S.NEW],
            "confirmed": by_status[S.CONFIRMED] + by_status[S.SCHEDULED],
            "in_production": sum(by_status[s] for s in IN_PRODUCTION),
            "in_logistics": sum(by_status[s] for s in ACTIVE_LOGISTICS),
            "delivered": by_status[S.DELIVERED],
            "cancelled": by_status[S.CANCELLED],
            "volume_m3": _f(total_volume),
            "delivered_volume_m3": _f(delivered_volume),
            "open_volume_m3": _f(open_volume),
        },
        "today": {"date": today.isoformat(), "orders": upcoming[0], "volume_m3": _f(upcoming[1])},
        "by_status": by_status,
        "daily": daily,
        "by_product": by_product,
        "callbacks_new": db.scalar(
            select(func.count()).select_from(CallbackRequest).where(CallbackRequest.status == CallbackStatus.NEW)
        ) or 0,
        # None — "belgilanmagan". Tizim quvvatni taxmin qilmaydi.
        "production_capacity_m3_per_day": capacity,
    }
