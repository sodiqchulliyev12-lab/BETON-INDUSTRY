"""Transport bo'limi: umumiy ko'rsatkichlar, logistika rejalashtirish, xarajatlar va hisobot.

Hamma raqam bazadagi haqiqiy yozuvlardan hisoblanadi; ma'lumot bo'lmasa bo'sh ro'yxat qaytadi.
"""
from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require
from app.models import Customer, Order, OrderTrip, TaxiRide, User, Vehicle, VehicleExpense
from app.models.enums import OrderStatus, TripStatus, VehicleStatus
from app.models.fleet import EXPENSE_CATEGORIES
from app.permissions import Perm
from app.schemas.common import InputModel, clean_text
from app.services.fleet import ACTIVE_TRIP, order_volumes
from app.utils.timezone import local_tz, today_local

router = APIRouter(tags=["Admin: transport bo‘limi"])
T = TripStatus
ZERO = Decimal("0")
EXPENSE_LABELS = {"fuel": "Yoqilg‘i", "parts": "Zapchast", "repair": "Ta’mir", "tires": "Shina", "insurance": "Sug‘urta", "other": "Boshqa"}


def _f(value) -> float:
    return float(value or 0)


# --- Umumiy ko'rsatkichlar -------------------------------------------------

@router.get("/fleet/summary")
def fleet_summary(days: int = Query(14, ge=3, le=60), db: Session = Depends(get_db),
                  _: User = Depends(require(Perm.FLEET_READ))):
    vehicles = list(db.scalars(select(Vehicle).where(Vehicle.is_active.is_(True))))
    today = today_local()

    def count(fn) -> int:
        return sum(1 for v in vehicles if fn(v))

    start = today - timedelta(days=days - 1)
    rows = db.execute(
        select(Order.delivery_date, OrderTrip.status, func.count(), func.coalesce(func.sum(OrderTrip.volume_m3), 0))
        .join(Order, Order.id == OrderTrip.order_id)
        .where(Order.delivery_date >= start, Order.delivery_date <= today, OrderTrip.status != T.CANCELLED)
        .group_by(Order.delivery_date, OrderTrip.status)
    ).all()
    per_day: dict[date, dict[str, float]] = {}
    for day, trip_status, n, vol in rows:
        slot = per_day.setdefault(day, {"trips": 0, "volume_m3": 0.0, "delivered": 0})
        slot["trips"] += n
        slot["volume_m3"] += _f(vol)
        if trip_status == T.DELIVERED:
            slot["delivered"] += n
    daily = [{"date": (start + timedelta(days=i)).isoformat(),
              **per_day.get(start + timedelta(days=i), {"trips": 0, "volume_m3": 0.0, "delivered": 0})}
             for i in range(days)]

    on_road = db.scalar(select(func.count()).select_from(OrderTrip).where(OrderTrip.status == T.EN_ROUTE)) or 0
    active_trips = db.scalar(select(func.count()).select_from(OrderTrip).where(OrderTrip.status.in_(ACTIVE_TRIP))) or 0
    trips_today = db.execute(
        select(func.count(), func.coalesce(func.sum(OrderTrip.volume_m3), 0))
        .join(Order, Order.id == OrderTrip.order_id)
        .where(Order.delivery_date == today, OrderTrip.status != T.CANCELLED)
    ).one()

    # Bugungi reyslar soat bo'yicha: bo'lim va egalik guruhlari (yuklangan vaqt, bo'lmasa yaratilgan vaqt)
    tz = local_tz()
    hourly: dict[str, dict[int, int]] = {}
    for at, kind, own in db.execute(
        select(func.coalesce(OrderTrip.loaded_at, OrderTrip.created_at), Vehicle.kind, Vehicle.ownership)
        .join(Vehicle, Vehicle.id == OrderTrip.vehicle_id).join(Order, Order.id == OrderTrip.order_id)
        .where(Order.delivery_date == today, OrderTrip.status != T.CANCELLED)
    ):
        group = f"{kind}_{'own' if own.value == 'own' else 'hired'}"
        h = at.astimezone(tz).hour
        hourly.setdefault(group, {})[h] = hourly.setdefault(group, {}).get(h, 0) + 1
    fuel = dict(db.execute(
        select(VehicleExpense.expense_date, func.sum(VehicleExpense.amount))
        .where(VehicleExpense.expense_date >= start, VehicleExpense.category == "fuel").group_by(VehicleExpense.expense_date)
    ).all())
    for d in daily:
        d["fuel_cost"] = _f(fuel.get(date.fromisoformat(d["date"])))

    taxi = list(db.scalars(select(TaxiRide).where(TaxiRide.ride_date >= today.replace(day=1), TaxiRide.ride_date <= today)))
    return {
        "hourly": {g: [[h, n] for h, n in sorted(v.items())] for g, v in hourly.items()},
        "total": len(vehicles),
        "free": count(lambda v: v.status == VehicleStatus.FREE),
        "busy": count(lambda v: v.status == VehicleStatus.BUSY),
        "repair": count(lambda v: v.status == VehicleStatus.REPAIR),
        "on_road": on_road,
        "active_trips": active_trips,
        "trips_today": trips_today[0],
        "volume_today_m3": _f(trips_today[1]),
        # Bandlik: band mashinalar / ta'mirda bo'lmagan faol mashinalar. Maqsad (reja) kiritilmagan — taxmin qilinmaydi.
        "busy_pct": round(100 * count(lambda v: v.status == VehicleStatus.BUSY)
                          / max(1, count(lambda v: v.status != VehicleStatus.REPAIR)), 1) if vehicles else None,
        "by_kind": {k: count(lambda v, k=k: v.kind == k) for k in ("mixer", "pump", "other", "car")},
        "by_ownership": {o: {k: count(lambda v, o=o, k=k: v.ownership.value == o and v.kind == k)
                             for k in ("mixer", "pump", "other", "car")} for o in ("own", "rented", "per_trip")},
        # Ta'mirda bo'lmagan (ishga yaroqli) transport soni — "faol %" uchun
        "ready_by_ownership": {o: {k: count(lambda v, o=o, k=k: v.ownership.value == o and v.kind == k and v.status != VehicleStatus.REPAIR)
                                   for k in ("mixer", "pump", "other", "car")} for o in ("own", "rented", "per_trip")},
        "taxi_month": {"rides": len(taxi), "amount": sum(_f(t.amount) for t in taxi)},
        "daily": daily,
    }


# --- Reyslar monitoringi (filtrlar bilan) ----------------------------------

@router.get("/fleet/monitor")
def fleet_monitor(date_: date = Query(alias="date", default_factory=today_local), kind: str | None = None,
                  ownership: str | None = None, vehicle_status: str | None = None, driver_id: int | None = None,
                  page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=50), db: Session = Depends(get_db),
                  _: User = Depends(require(Perm.FLEET_READ))):
    q = (select(OrderTrip).join(Vehicle, Vehicle.id == OrderTrip.vehicle_id).join(Order, Order.id == OrderTrip.order_id)
         .where(Order.delivery_date == date_, OrderTrip.status != T.CANCELLED))
    if kind in ("mixer", "pump", "other", "car"):
        q = q.where(Vehicle.kind == kind)
    if ownership in ("own", "rented", "per_trip"):
        q = q.where(Vehicle.ownership == ownership)
    if vehicle_status in ("free", "busy", "repair"):
        q = q.where(Vehicle.status == vehicle_status)
    if driver_id:
        q = q.where(OrderTrip.driver_id == driver_id)
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    trips = list(db.scalars(q.order_by(OrderTrip.created_at.desc(), OrderTrip.id.desc()).limit(page_size).offset((page - 1) * page_size)))
    order_ids = {t.order_id for t in trips}
    orders = {o.id: o for o in db.scalars(select(Order).where(Order.id.in_(order_ids)))} if order_ids else {}
    names = dict(db.execute(select(Customer.id, Customer.full_name).where(Customer.id.in_({o.customer_id for o in orders.values()}))).all()) if orders else {}
    return {
        "total": total, "page": page, "page_size": page_size,
        "items": [{
            "id": t.id, "order_id": t.order_id, "order_number": orders[t.order_id].order_number, "trip_no": t.trip_no,
            "plate_number": t.vehicle.plate_number, "vehicle_type": t.vehicle.vehicle_type, "kind": t.vehicle.kind,
            "ownership": t.vehicle.ownership.value, "driver": t.driver.full_name if t.driver else None,
            "customer": names.get(orders[t.order_id].customer_id), "address": orders[t.order_id].delivery_address,
            "volume_m3": _f(t.volume_m3), "status": t.status.value,
        } for t in trips],
    }


# --- Logistika rejalashtirish ---------------------------------------------

@router.get("/fleet/planning")
def fleet_planning(date_: date = Query(alias="date", default_factory=today_local), db: Session = Depends(get_db),
                   _: User = Depends(require(Perm.FLEET_READ))):
    orders = list(db.scalars(
        select(Order).where(Order.delivery_date == date_, Order.status != OrderStatus.CANCELLED)
        .order_by(Order.delivery_time.nulls_last(), Order.id)
    ))
    names = dict(db.execute(select(Customer.id, Customer.full_name).where(Customer.id.in_({o.customer_id for o in orders}))).all()) if orders else {}
    items = []
    for o in orders:
        vol = order_volumes(db, o)
        items.append({
            "id": o.id, "order_number": o.order_number, "status": o.status.value,
            "customer": names.get(o.customer_id), "address": o.delivery_address if o.delivery_required else None,
            "delivery_required": o.delivery_required,
            "delivery_time": o.delivery_time.strftime("%H:%M") if o.delivery_time else None,
            "ordered_m3": _f(vol.ordered), "assigned_m3": _f(vol.in_trips), "unassigned_m3": _f(vol.unassigned),
            "delivered_m3": _f(vol.delivered),
            "trips": [{"id": t.id, "plate_number": t.vehicle.plate_number, "volume_m3": _f(t.volume_m3), "status": t.status.value}
                      for t in o.trips if t.status != T.CANCELLED],
        })
    vehicles = list(db.scalars(select(Vehicle).where(Vehicle.is_active.is_(True)).order_by(Vehicle.kind, Vehicle.plate_number)))
    day_trips = dict(db.execute(
        select(OrderTrip.vehicle_id, func.count())
        .join(Order, Order.id == OrderTrip.order_id)
        .where(Order.delivery_date == date_, OrderTrip.status != T.CANCELLED)
        .group_by(OrderTrip.vehicle_id)
    ).all())
    return {
        "date": date_.isoformat(),
        "orders": items,
        "unassigned_total_m3": round(sum(i["unassigned_m3"] for i in items), 2),
        "vehicles": [{"id": v.id, "plate_number": v.plate_number, "vehicle_type": v.vehicle_type, "kind": v.kind,
                      "ownership": v.ownership.value, "capacity_m3": _f(v.capacity_m3) if v.capacity_m3 else None,
                      "status": v.status.value, "trips_that_day": day_trips.get(v.id, 0)} for v in vehicles],
    }


# --- Xarajatlar ------------------------------------------------------------

class ExpenseIn(InputModel):
    vehicle_id: int
    expense_date: date
    category: Literal["fuel", "parts", "repair", "tires", "insurance", "other"]
    amount: Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]
    note: Annotated[str | None, Field(default=None, max_length=500)]
    fuel_type: Literal["gas", "diesel", "petrol"] | None = None
    quantity: Annotated[Decimal | None, Field(default=None, gt=0, max_digits=12, decimal_places=2)]

    @field_validator("note")
    @classmethod
    def _clean(cls, v: str | None) -> str | None:
        return clean_text(v)

    @model_validator(mode="after")
    def _fuel(self):
        if self.category == "fuel" and self.fuel_type is None:
            raise ValueError("Yoqilg‘i turini tanlang: gaz, dizel (solyarka) yoki benzin.")
        if self.category != "fuel":
            self.fuel_type = None
            self.quantity = None
        return self


def _expense_out(e: VehicleExpense) -> dict:
    return {"id": e.id, "vehicle_id": e.vehicle_id, "plate_number": e.vehicle.plate_number, "expense_date": e.expense_date.isoformat(),
            "category": e.category, "amount": _f(e.amount), "note": e.note,
            "fuel_type": e.fuel_type, "quantity": _f(e.quantity) if e.quantity is not None else None}


def _check_expense(db: Session, payload: ExpenseIn) -> None:
    if db.get(Vehicle, payload.vehicle_id) is None:
        raise HTTPException(status_code=422, detail=[{"loc": ["body", "vehicle_id"], "msg": "Transport topilmadi.", "type": "business_rule"}])
    if payload.expense_date > today_local():
        raise HTTPException(status_code=422, detail=[{"loc": ["body", "expense_date"], "msg": "Kelajak sanasini kiritib bo‘lmaydi.", "type": "business_rule"}])


@router.get("/fleet/expenses")
def list_expenses(date_from: date | None = None, date_to: date | None = None, vehicle_id: int | None = None,
                  category: str | None = None, fuel_type: str | None = None, db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_READ))):
    q = select(VehicleExpense).order_by(VehicleExpense.expense_date.desc(), VehicleExpense.id.desc()).limit(500)
    if date_from:
        q = q.where(VehicleExpense.expense_date >= date_from)
    if date_to:
        q = q.where(VehicleExpense.expense_date <= date_to)
    if vehicle_id:
        q = q.where(VehicleExpense.vehicle_id == vehicle_id)
    if category:
        q = q.where(VehicleExpense.category == category)
    if fuel_type:
        q = q.where(VehicleExpense.fuel_type == fuel_type)
    items = [_expense_out(e) for e in db.scalars(q)]
    by_cat: dict[str, float] = {}
    for i in items:
        by_cat[i["category"]] = by_cat.get(i["category"], 0) + i["amount"]
    return {"items": items, "total": round(sum(i["amount"] for i in items), 2), "by_category": by_cat}


@router.post("/fleet/expenses", status_code=status.HTTP_201_CREATED)
def create_expense(payload: ExpenseIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.FLEET_MANAGE))):
    _check_expense(db, payload)
    e = VehicleExpense(**payload.model_dump(), created_by_id=user.id)
    db.add(e)
    db.commit()
    db.refresh(e)
    return _expense_out(e)


@router.put("/fleet/expenses/{expense_id}")
def update_expense(expense_id: int, payload: ExpenseIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_MANAGE))):
    e = db.get(VehicleExpense, expense_id)
    if e is None:
        raise HTTPException(status_code=404, detail="Xarajat topilmadi.")
    _check_expense(db, payload)
    for k, v in payload.model_dump().items():
        setattr(e, k, v)
    db.commit()
    db.refresh(e)
    return _expense_out(e)


@router.delete("/fleet/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expense(expense_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_MANAGE))):
    e = db.get(VehicleExpense, expense_id)
    if e is None:
        raise HTTPException(status_code=404, detail="Xarajat topilmadi.")
    db.delete(e)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Hisobot ---------------------------------------------------------------

@router.get("/fleet/report")
def fleet_report(date_from: date | None = None, date_to: date | None = None, db: Session = Depends(get_db),
                 _: User = Depends(require(Perm.FLEET_READ))):
    date_to = date_to or today_local()
    date_from = date_from or (date_to - timedelta(days=29))
    trips = db.execute(
        select(OrderTrip.vehicle_id, OrderTrip.status, func.count(), func.coalesce(func.sum(OrderTrip.volume_m3), 0),
               func.coalesce(func.sum(OrderTrip.rental_cost), 0))
        .join(Order, Order.id == OrderTrip.order_id)
        .where(Order.delivery_date >= date_from, Order.delivery_date <= date_to, OrderTrip.status != T.CANCELLED)
        .group_by(OrderTrip.vehicle_id, OrderTrip.status)
    ).all()
    stats: dict[int, dict] = {}
    for vid, trip_status, n, vol, rental in trips:
        s = stats.setdefault(vid, {"trips": 0, "delivered_trips": 0, "volume_m3": 0.0, "delivered_m3": 0.0, "rental_cost": 0.0})
        s["trips"] += n
        s["volume_m3"] += _f(vol)
        s["rental_cost"] += _f(rental)
        if trip_status == T.DELIVERED:
            s["delivered_trips"] += n
            s["delivered_m3"] += _f(vol)
    exp = {}
    for vid, cat, amount in db.execute(
        select(VehicleExpense.vehicle_id, VehicleExpense.category, func.sum(VehicleExpense.amount))
        .where(VehicleExpense.expense_date >= date_from, VehicleExpense.expense_date <= date_to)
        .group_by(VehicleExpense.vehicle_id, VehicleExpense.category)
    ):
        exp.setdefault(vid, {})[cat] = _f(amount)
    rows = []
    for v in db.scalars(select(Vehicle).order_by(Vehicle.kind, Vehicle.plate_number)):
        s = stats.get(v.id, {"trips": 0, "delivered_trips": 0, "volume_m3": 0.0, "delivered_m3": 0.0, "rental_cost": 0.0})
        e = exp.get(v.id, {})
        if not s["trips"] and not e and not v.is_active:
            continue
        rows.append({"id": v.id, "plate_number": v.plate_number, "vehicle_type": v.vehicle_type, "kind": v.kind,
                     "ownership": v.ownership.value, **s, "expenses": e, "expenses_total": round(sum(e.values()), 2),
                     "cost_total": round(sum(e.values()) + s["rental_cost"], 2)})
    return {
        "date_from": date_from.isoformat(), "date_to": date_to.isoformat(), "rows": rows,
        "totals": {k: round(sum(r[k] for r in rows), 2) for k in ("trips", "delivered_trips", "volume_m3", "delivered_m3",
                                                                "rental_cost", "expenses_total", "cost_total")},
    }
