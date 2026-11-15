"""Ishlab chiqarish paneli va Analiz bo'limi (yaxshilash choralari rejasi + tahlil).

Hamma ko'rsatkich bazadagi haqiqiy yozuvlardan hisoblanadi. Ma'lumot yetarli bo'lmasa qiymat None ("—") bo'ladi.
OEE kabi to'xtab qolish vaqti kerak bo'ladigan ko'rsatkichlar hisoblanmaydi — buning uchun ma'lumot yig'ilmaydi.
"""
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require
from app.models import (
    ConcreteProduct, ImprovementAction, LabSample, Order, OrderItem, OrderTrip, ProductionPlan, ProductionRecord, User, Vehicle,
)
from app.models.enums import OrderStatus, PlanStatus, QcStatus, TripStatus, VehicleStatus
from app.permissions import Perm
from app.routers.admin.lab import summary as lab_summary
from app.schemas.common import InputModel, clean_text
from app.services import warehouse as wh
from app.services.production import capacity
from app.services.value_stream import value_stream
from app.utils.timezone import local_tz, today_local

router = APIRouter(tags=["Admin: ishlab chiqarish paneli va analiz"])
S = OrderStatus
ZERO = Decimal("0")


def _f(v) -> float:
    return float(v or 0)


def _day_bounds(start: date, end: date) -> tuple[datetime, datetime]:
    tz = local_tz()
    return datetime.combine(start, time.min, tzinfo=tz), datetime.combine(end + timedelta(days=1), time.min, tzinfo=tz)


# --- Ishlab chiqarish paneli ----------------------------------------------

@router.get("/production/panel")
def production_panel(days: int = Query(14, ge=3, le=60), db: Session = Depends(get_db),
                     _: User = Depends(require(Perm.PRODUCTION_READ))):
    tz = local_tz()
    today = today_local()
    month_start = today.replace(day=1)
    start = min(today - timedelta(days=days - 1), month_start)
    lo, hi = _day_bounds(start, today)

    records = db.execute(
        select(ProductionRecord.produced_at, ProductionRecord.produced_volume_m3, ProductionRecord.qc_status, ProductionRecord.product_id)
        .where(ProductionRecord.produced_at >= lo, ProductionRecord.produced_at < hi)
    ).all()
    produced_by_day: dict[date, Decimal] = {}
    by_product: dict[int, Decimal] = {}
    qc = {s.value: 0 for s in QcStatus}
    for at, vol, qc_status, pid in records:
        qc[qc_status.value] += 1
        if qc_status == QcStatus.FAILED:
            continue
        d = at.astimezone(tz).date()
        produced_by_day[d] = produced_by_day.get(d, ZERO) + vol
        if d > today - timedelta(days=30):
            by_product[pid] = by_product.get(pid, ZERO) + vol

    planned_by_day = {d: v for d, v in db.execute(
        select(ProductionPlan.plan_date, func.sum(ProductionPlan.planned_volume_m3))
        .where(ProductionPlan.plan_date >= start, ProductionPlan.plan_date <= today, ProductionPlan.status != PlanStatus.CANCELLED)
        .group_by(ProductionPlan.plan_date)
    )}
    daily = [{"date": (d := today - timedelta(days=days - 1 - i)).isoformat(),
              "planned_m3": _f(planned_by_day.get(d)), "produced_m3": _f(produced_by_day.get(d))} for i in range(days)]

    month_days = [today.replace(day=1) + timedelta(days=i) for i in range((today - month_start).days + 1)]
    month_total = sum((produced_by_day.get(d, ZERO) for d in month_days), ZERO)
    plan_days = [d for d in month_days if planned_by_day.get(d)]
    planned_month = sum((planned_by_day[d] for d in plan_days), ZERO)
    produced_on_plan_days = sum((produced_by_day.get(d, ZERO) for d in plan_days), ZERO)

    names = {p.id: (p.name, p.grade_class) for p in db.scalars(select(ConcreteProduct))}
    total_share = sum(by_product.values(), ZERO)
    shares = [{"name": names[pid][0], "grade_class": names[pid][1], "volume_m3": _f(v),
               "pct": round(float(v / total_share * 100), 1) if total_share else None}
              for pid, v in sorted(by_product.items(), key=lambda kv: kv[1], reverse=True)]

    stages = []
    for key, label, statuses in (
        ("wait", "Navbatda", (S.CONFIRMED, S.SCHEDULED)), ("production", "Ishlab chiqarilmoqda", (S.IN_PRODUCTION,)),
        ("qc", "Sifat nazoratida", (S.QUALITY_CHECK,)), ("loaded", "Yuklandi", (S.LOADED,)),
    ):
        n, vol = db.execute(
            select(func.count(func.distinct(Order.id)), func.coalesce(func.sum(OrderItem.volume_m3), 0))
            .select_from(Order).join(OrderItem, OrderItem.order_id == Order.id).where(Order.status.in_(statuses))
        ).one()
        stages.append({"key": key, "label": label, "orders": n, "volume_m3": _f(vol)})

    cap = capacity(db)
    return {
        "today_m3": _f(produced_by_day.get(today)),
        "month_m3": _f(month_total),
        "plan_today_m3": _f(planned_by_day.get(today)),
        "plan_pct_month": round(float(produced_on_plan_days / planned_month * 100), 1) if planned_month else None,
        "planned_month_m3": _f(planned_month),
        "capacity_m3_per_day": _f(cap) if cap is not None else None,
        "daily": daily, "shares": shares, "stages": stages, "qc": qc,
        "consumption": wh.consumption_vs_norm(db, month_start, today),
    }


# --- Yaxshilash choralari --------------------------------------------------

ActionStatus = Literal["planned", "in_progress", "waiting", "done"]


class ActionIn(InputModel):
    title: Annotated[str, Field(min_length=3, max_length=200)]
    assignee: Annotated[str | None, Field(default=None, max_length=100)]
    status: ActionStatus = "planned"
    due_date: date | None = None
    note: Annotated[str | None, Field(default=None, max_length=500)]

    @field_validator("title", "assignee", "note")
    @classmethod
    def _clean(cls, v):
        return clean_text(v)


def _action_out(a: ImprovementAction) -> dict:
    return {"id": a.id, "title": a.title, "assignee": a.assignee, "status": a.status,
            "due_date": a.due_date.isoformat() if a.due_date else None, "note": a.note,
            "overdue": bool(a.due_date and a.due_date < today_local() and a.status != "done")}


@router.get("/analysis/actions")
def list_actions(db: Session = Depends(get_db), _: User = Depends(require(Perm.DASHBOARD))):
    order = {"in_progress": 0, "waiting": 1, "planned": 2, "done": 3}
    items = sorted(db.scalars(select(ImprovementAction)), key=lambda a: (order.get(a.status, 9), a.due_date or date.max, a.id))
    return {"items": [_action_out(a) for a in items]}


@router.post("/analysis/actions", status_code=201)
def create_action(payload: ActionIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.ANALYSIS_MANAGE))):
    a = ImprovementAction(**payload.model_dump(), created_by_id=user.id)
    db.add(a)
    db.commit()
    return _action_out(a)


@router.put("/analysis/actions/{action_id}")
def update_action(action_id: int, payload: ActionIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.ANALYSIS_MANAGE))):
    a = db.get(ImprovementAction, action_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Chora topilmadi.")
    for k, v in payload.model_dump().items():
        setattr(a, k, v)
    db.commit()
    return _action_out(a)


@router.delete("/analysis/actions/{action_id}", status_code=204)
def delete_action(action_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.ANALYSIS_MANAGE))):
    a = db.get(ImprovementAction, action_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Chora topilmadi.")
    db.delete(a)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Analiz ----------------------------------------------------------------

@router.get("/analysis/overview")
def analysis_overview(db: Session = Depends(get_db), _: User = Depends(require(Perm.DASHBOARD))):
    """Samaradorlik ko'rsatkichlari, hozirgi holat xaritasi, 8 turdagi isrof, monitoring va rahbariyat xulosasi uchun xom raqamlar."""
    today = today_local()
    since = datetime.now(local_tz()) - timedelta(days=30)
    vsm = value_stream(db)

    orders_30 = db.execute(
        select(Order.status, func.count()).where(Order.created_at >= since).group_by(Order.status)
    ).all()
    n_orders = sum(n for _, n in orders_30)
    n_cancel = sum(n for s, n in orders_30 if s == S.CANCELLED)

    # O'z vaqtida yetkazish: yetkazilgan qatnov sanasi buyurtma sanasidan oshmagan
    delivered = db.execute(
        select(Order.delivery_date, func.max(OrderTrip.delivered_at))
        .join(OrderTrip, OrderTrip.order_id == Order.id)
        .where(Order.status == S.DELIVERED, Order.created_at >= since, OrderTrip.status == TripStatus.DELIVERED)
        .group_by(Order.id, Order.delivery_date)
    ).all()
    tz = local_tz()
    timed = [(d, at) for d, at in delivered if at is not None]
    on_time = sum(1 for d, at in timed if at.astimezone(tz).date() <= d)

    plan = db.execute(
        select(func.coalesce(func.sum(ProductionPlan.planned_volume_m3), 0))
        .where(ProductionPlan.plan_date >= today - timedelta(days=29), ProductionPlan.plan_date <= today, ProductionPlan.status != PlanStatus.CANCELLED)
    ).scalar_one()
    produced = db.execute(
        select(func.coalesce(func.sum(ProductionRecord.produced_volume_m3), 0))
        .where(ProductionRecord.produced_at >= since, ProductionRecord.qc_status != QcStatus.FAILED)
    ).scalar_one()
    failed_qc = db.scalar(select(func.count()).select_from(ProductionRecord).where(ProductionRecord.produced_at >= since, ProductionRecord.qc_status == QcStatus.FAILED)) or 0
    records = db.scalar(select(func.count()).select_from(ProductionRecord).where(ProductionRecord.produced_at >= since)) or 0

    vehicles = list(db.scalars(select(Vehicle).where(Vehicle.is_active.is_(True))))
    busy = sum(1 for v in vehicles if v.status == VehicleStatus.BUSY)
    repair = sum(1 for v in vehicles if v.status == VehicleStatus.REPAIR)
    on_road = db.scalar(select(func.count()).select_from(OrderTrip).where(OrderTrip.status == TripStatus.EN_ROUTE)) or 0

    lab = lab_summary(None, None, db, _)
    rows = wh.material_rows(db, warehouse_id=None, date_from=None, date_to=None)
    active_mats = [r for r in rows if r["is_active"]]
    gauges = [r for r in active_mats if r["category"] in ("cement", "sand", "gravel", "crushed_stone")]

    stages = {s["status"]: s for s in vsm["stages"]}
    return {
        "vsm": vsm,
        "orders_30d": n_orders,
        "cancel_pct": round(100 * n_cancel / n_orders, 1) if n_orders else None,
        "on_time_pct": round(100 * on_time / len(timed), 1) if timed else None,
        "on_time_n": len(timed),
        "plan_pct": round(float(produced / plan * 100), 1) if plan else None,
        "plan_m3": _f(plan), "produced_m3": _f(produced),
        "qc_fail_pct": round(100 * failed_qc / records, 1) if records else None,
        "lab_pass_pct": lab["pass_pct"], "lab_control_tests": lab["control_tests"],
        "vehicles": {"total": len(vehicles), "busy": busy, "repair": repair, "on_road": on_road,
                     "busy_pct": round(100 * busy / max(1, len(vehicles) - repair), 1) if vehicles else None},
        "wip": {k: {"orders": stages[k]["wip_orders"], "volume_m3": stages[k]["wip_volume_m3"]} for k in stages},
        "stock": {"low": sum(1 for r in active_mats if r["status"] == "low"), "out": sum(1 for r in active_mats if r["status"] == "out"),
                  "materials": len(active_mats), "gauges": [{"name": r["name"], "unit": r["unit"], "stock": r["stock_total"], "min_stock": r["min_stock"], "status": r["status"]} for r in gauges[:6]]},
        "pending_samples": lab["pending"],
    }
