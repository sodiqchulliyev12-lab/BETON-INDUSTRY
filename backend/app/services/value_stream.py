"""Qiymat oqimi xaritasi (Value Stream Map): buyurtma zayafkadan yetkazilguncha qaysi bosqichda qancha turadi.

Hamma raqam buyurtmalar holati tarixidan (order_status_history) hisoblanadi — hech narsa taxmin qilinmaydi.
Ma'lumot yetarli bo'lmagan bosqichda vaqt None qaytadi ("—" ko'rsatiladi), 0 emas.

Atamalar:
- navbat (WIP) — hozir shu holatda turgan buyurtmalar soni va hajmi;
- o'rtacha vaqt — buyurtma shu holatga kirgandan keyingi holatga o'tguncha o'tgan vaqt;
- yetkazish vaqti (lead time) — zayafka yaratilgandan "Yetkazib berildi"gacha;
- ish vaqti — shundan haqiqiy ish bosqichlarida (ishlab chiqarish → yo'l) o'tgan qismi;
  qolgani kutish (tasdiqlash, rejalashtirish).
"""
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Order, OrderItem, OrderStatusHistory
from app.models.enums import OrderStatus

S = OrderStatus
FLOW: tuple[OrderStatus, ...] = (
    S.NEW, S.CONFIRMED, S.SCHEDULED, S.IN_PRODUCTION, S.QUALITY_CHECK, S.LOADED, S.IN_TRANSIT, S.DELIVERED,
)
# Qiymat qo'shadigan (ish) bosqichlari; qolganlari — kutish
WORK: frozenset[OrderStatus] = frozenset({S.IN_PRODUCTION, S.QUALITY_CHECK, S.LOADED, S.IN_TRANSIT})


def _hours(delta: timedelta) -> float:
    return delta.total_seconds() / 3600


def _avg(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 2) if values else None


def value_stream(db: Session, days: int = 90) -> dict[str, Any]:
    since = datetime.now(timezone.utc) - timedelta(days=days)

    # Hozirgi navbat — barcha ochiq buyurtmalar (davrdan qat'i nazar)
    wip_count = dict(db.execute(select(Order.status, func.count()).group_by(Order.status)).all())
    wip_volume = dict(
        db.execute(
            select(Order.status, func.coalesce(func.sum(OrderItem.volume_m3), 0))
            .join(OrderItem, OrderItem.order_id == Order.id)
            .group_by(Order.status)
        ).all()
    )

    history = db.execute(
        select(OrderStatusHistory.order_id, OrderStatusHistory.to_status, OrderStatusHistory.created_at)
        .join(Order, Order.id == OrderStatusHistory.order_id)
        .where(Order.created_at >= since)
        .order_by(OrderStatusHistory.order_id, OrderStatusHistory.id)
    ).all()
    by_order: dict[int, list[tuple[OrderStatus, datetime]]] = defaultdict(list)
    for order_id, status, at in history:
        by_order[order_id].append((status, at))

    dwell: dict[OrderStatus, list[float]] = defaultdict(list)
    cancelled_from: Counter[OrderStatus] = Counter()
    lead_times: list[float] = []
    work_times: list[float] = []
    for steps in by_order.values():
        work = 0.0
        for (status, at), (next_status, next_at) in zip(steps, steps[1:]):
            spent = _hours(next_at - at)
            if status in FLOW and status != S.DELIVERED:
                dwell[status].append(spent)
                if status in WORK:
                    work += spent
            if next_status == S.CANCELLED:
                cancelled_from[status] += 1
        delivered_at = next((at for status, at in steps if status == S.DELIVERED), None)
        if delivered_at is not None:
            lead_times.append(_hours(delivered_at - steps[0][1]))
            work_times.append(work)

    stages = []
    for status in FLOW:
        samples = dwell.get(status, [])
        stages.append({
            "status": status.value,
            "kind": "work" if status in WORK else ("done" if status == S.DELIVERED else "wait"),
            "wip_orders": wip_count.get(status, 0),
            "wip_volume_m3": float(wip_volume.get(status, Decimal("0"))),
            "avg_hours": _avg(samples),
            "samples": len(samples),
            "cancelled_here": cancelled_from.get(status, 0),
        })

    timed = [s for s in stages if s["avg_hours"] is not None and s["status"] != S.DELIVERED.value]
    bottleneck = max(timed, key=lambda s: s["avg_hours"])["status"] if timed else None

    lead = _avg(lead_times)
    work = _avg(work_times)
    return {
        "period_days": days,
        "has_data": bool(by_order),
        "stages": stages,
        "bottleneck": bottleneck,
        "delivered_orders": len(lead_times),
        "lead_time_hours": lead,
        "work_time_hours": work,
        "wait_time_hours": round(lead - work, 2) if lead is not None and work is not None else None,
        # Ish vaqtining umumiy vaqtdagi ulushi; yetkazilgan buyurtma bo'lmasa None
        "efficiency_pct": round(work / lead * 100, 1) if lead and work is not None else None,
        "cancelled_total": sum(cancelled_from.values()),
        "cancelled_volume_m3": float(wip_volume.get(S.CANCELLED, Decimal("0"))),
    }
