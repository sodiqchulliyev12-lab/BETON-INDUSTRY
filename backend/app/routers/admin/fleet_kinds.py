"""Transport turlari bo'yicha hisobot: mikserlar / yuk avtomobillari, beton nasoslar, yengil avtomobillar.

Har bir tur uchun «kun» va «oy» ko'rsatkichlari, hamma raqam bazadagi yozuvlardan:
- mikser, yuk: reyslar, yoqilg'i, buzilishlar soni, zapchast va boshqa xarajatlar, texnik ko'rik;
- nasos: ish soatlari (kompaniya / mijoz hisobidan), yoqilg'i, zapchast, ko'zda tutilmagan xarajatlar, texnik ko'rik;
- yengil: texnik ko'rik, yoqilg'i, zapchast, boshqa xarajatlar, taksi (marta va so'm).
"""
from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require
from app.models import Order, OrderTrip, TaxiRide, User, Vehicle, VehicleBreakdown, VehicleExpense, VehicleWorkLog
from app.models.enums import TripStatus
from app.permissions import Perm
from app.schemas.common import InputModel, clean_text
from app.services.fleet import inspection_status
from app.utils.timezone import today_local

router = APIRouter(prefix="/fleet", tags=["Admin: transport turlari"])
KINDS = ("mixer", "pump", "other", "car")


def _f(v) -> float:
    return float(v or 0)


def _422(field: str, message: str) -> HTTPException:
    return HTTPException(status_code=422, detail=[{"loc": ["body", field], "msg": message, "type": "business_rule"}])


def _vehicle(db: Session, vehicle_id: int) -> Vehicle:
    v = db.get(Vehicle, vehicle_id)
    if v is None:
        raise _422("vehicle_id", "Transport topilmadi.")
    return v


def _empty() -> dict:
    return {"trips": 0, "volume_m3": 0.0, "trip_pay": 0.0, "hours_company": 0.0, "hours_client": 0.0, "hours": 0.0,
            "fuel": 0.0, "parts": 0.0, "other_costs": 0.0, "expenses_total": 0.0, "breakdowns": 0}


def _add(target: dict, **values) -> None:
    for k, v in values.items():
        target[k] = target.get(k, 0) + v


@router.get("/kind/{kind}")
def kind_report(kind: Literal["mixer", "pump", "other", "car"], date_: date = Query(alias="date", default_factory=today_local),
                db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_READ))):
    m0 = date_.replace(day=1)
    m1 = date_.replace(day=monthrange(date_.year, date_.month)[1])
    vehicles = list(db.scalars(select(Vehicle).where(Vehicle.kind == kind).order_by(Vehicle.is_active.desc(), Vehicle.ownership, Vehicle.plate_number)))
    ids = {v.id for v in vehicles}
    per: dict[int, dict[str, dict]] = {v.id: {"day": _empty(), "month": _empty()} for v in vehicles}
    daily: dict[date, dict] = {}
    series_from = date_ - timedelta(days=29)

    def slot(vid: int, d: date):
        if m0 <= d <= m1:
            yield per[vid]["month"]
        if d == date_:
            yield per[vid]["day"]

    def day_slot(d: date) -> dict | None:
        return daily.setdefault(d, {"date": d.isoformat(), "trips": 0, "hours": 0.0, "fuel": 0.0}) if series_from <= d <= date_ else None

    lo = min(m0, series_from)
    hi = max(m1, date_)
    if ids:
        for vid, delivery, st, vol, pay in db.execute(
            select(OrderTrip.vehicle_id, Order.delivery_date, OrderTrip.status, OrderTrip.volume_m3, OrderTrip.rental_cost)
            .join(Order, Order.id == OrderTrip.order_id)
            .where(OrderTrip.vehicle_id.in_(ids), Order.delivery_date >= lo, Order.delivery_date <= hi, OrderTrip.status != TripStatus.CANCELLED)
        ):
            for s in slot(vid, delivery):
                _add(s, trips=1, volume_m3=_f(vol), trip_pay=_f(pay))
            if (d := day_slot(delivery)) is not None:
                d["trips"] += 1
        for vid, d_, hrs, billed in db.execute(
            select(VehicleWorkLog.vehicle_id, VehicleWorkLog.work_date, VehicleWorkLog.hours, VehicleWorkLog.billed_to)
            .where(VehicleWorkLog.vehicle_id.in_(ids), VehicleWorkLog.work_date >= lo, VehicleWorkLog.work_date <= hi)
        ):
            for s in slot(vid, d_):
                _add(s, hours=_f(hrs), **{f"hours_{'company' if billed == 'company' else 'client'}": _f(hrs)})
            if (d := day_slot(d_)) is not None:
                d["hours"] += _f(hrs)
        for vid, d_, cat, amount in db.execute(
            select(VehicleExpense.vehicle_id, VehicleExpense.expense_date, VehicleExpense.category, VehicleExpense.amount)
            .where(VehicleExpense.vehicle_id.in_(ids), VehicleExpense.expense_date >= lo, VehicleExpense.expense_date <= hi)
        ):
            a = _f(amount)
            field = "fuel" if cat == "fuel" else ("parts" if cat == "parts" else "other_costs")
            for s in slot(vid, d_):
                _add(s, **{field: a, "expenses_total": a})
            if cat == "fuel" and (d := day_slot(d_)) is not None:
                d["fuel"] += a
        for vid, d_ in db.execute(
            select(VehicleBreakdown.vehicle_id, VehicleBreakdown.occurred_on)
            .where(VehicleBreakdown.vehicle_id.in_(ids), VehicleBreakdown.occurred_on >= lo, VehicleBreakdown.occurred_on <= hi)
        ):
            for s in slot(vid, d_):
                _add(s, breakdowns=1)

    rows = []
    totals = {"day": _empty(), "month": _empty()}
    for v in vehicles:
        for period in ("day", "month"):
            for k, val in per[v.id][period].items():
                totals[period][k] += val
        rows.append({
            "id": v.id, "plate_number": v.plate_number, "vehicle_type": v.vehicle_type, "ownership": v.ownership.value, "status": v.status.value,
            "is_active": v.is_active, "capacity_m3": _f(v.capacity_m3) if v.capacity_m3 else None,
            "inspection_date": v.inspection_date.isoformat() if v.inspection_date else None,
            "inspection_due": v.inspection_due.isoformat() if v.inspection_due else None,
            "inspection_status": inspection_status(v.inspection_due),
            "day": per[v.id]["day"], "month": per[v.id]["month"],
        })
    active_rows = [r for r in rows if r["is_active"]]
    result = {
        "kind": kind, "date": date_.isoformat(), "month": date_.strftime("%Y-%m"),
        "vehicles": rows, "totals": totals,
        "inspection": {s: sum(1 for r in active_rows if r["inspection_status"] == s) for s in ("ok", "soon", "overdue", "unknown")},
        "daily": [daily.get(series_from + timedelta(days=i), {"date": (series_from + timedelta(days=i)).isoformat(), "trips": 0, "hours": 0.0, "fuel": 0.0})
                  for i in range(30)],
    }
    if kind == "car":
        rides = list(db.scalars(select(TaxiRide).where(TaxiRide.ride_date >= m0, TaxiRide.ride_date <= m1).order_by(TaxiRide.ride_date.desc(), TaxiRide.id.desc())))
        result["taxi"] = {
            "day": {"rides": sum(1 for r in rides if r.ride_date == date_), "amount": sum(_f(r.amount) for r in rides if r.ride_date == date_)},
            "month": {"rides": len(rides), "amount": sum(_f(r.amount) for r in rides)},
            "items": [{"id": r.id, "ride_date": r.ride_date.isoformat(), "amount": _f(r.amount), "purpose": r.purpose} for r in rides],
        }
    return result


# --- Buzilishlar ------------------------------------------------------------

class BreakdownIn(InputModel):
    vehicle_id: int
    occurred_on: date
    description: Annotated[str, Field(min_length=3, max_length=300)]
    resolved_on: date | None = None

    @field_validator("description")
    @classmethod
    def _clean(cls, v):
        return clean_text(v)


def _bd_out(b: VehicleBreakdown) -> dict:
    return {"id": b.id, "vehicle_id": b.vehicle_id, "plate_number": b.vehicle.plate_number, "occurred_on": b.occurred_on.isoformat(),
            "description": b.description, "resolved_on": b.resolved_on.isoformat() if b.resolved_on else None}


def _check_bd(db: Session, p: BreakdownIn) -> None:
    _vehicle(db, p.vehicle_id)
    if p.occurred_on > today_local():
        raise _422("occurred_on", "Kelajak sanasini kiritib bo‘lmaydi.")
    if p.resolved_on and p.resolved_on < p.occurred_on:
        raise _422("resolved_on", "Tuzatilgan sana buzilgan sanadan oldin bo‘lishi mumkin emas.")


@router.get("/breakdowns")
def list_breakdowns(date_from: date | None = None, date_to: date | None = None, vehicle_id: int | None = None,
                    db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_READ))):
    q = select(VehicleBreakdown).order_by(VehicleBreakdown.occurred_on.desc(), VehicleBreakdown.id.desc()).limit(300)
    if date_from:
        q = q.where(VehicleBreakdown.occurred_on >= date_from)
    if date_to:
        q = q.where(VehicleBreakdown.occurred_on <= date_to)
    if vehicle_id:
        q = q.where(VehicleBreakdown.vehicle_id == vehicle_id)
    return {"items": [_bd_out(b) for b in db.scalars(q)]}


@router.post("/breakdowns", status_code=201)
def create_breakdown(payload: BreakdownIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.FLEET_MANAGE))):
    _check_bd(db, payload)
    b = VehicleBreakdown(**payload.model_dump(), created_by_id=user.id)
    db.add(b)
    db.commit()
    db.refresh(b)
    return _bd_out(b)


@router.delete("/breakdowns/{item_id}", status_code=204)
def delete_breakdown(item_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_MANAGE))):
    b = db.get(VehicleBreakdown, item_id)
    if b is None:
        raise HTTPException(status_code=404, detail="Yozuv topilmadi.")
    db.delete(b)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Ish soatlari (nasos) ----------------------------------------------------

class WorkLogIn(InputModel):
    vehicle_id: int
    work_date: date
    hours: Annotated[Decimal, Field(gt=0, le=24, max_digits=5, decimal_places=2)]
    billed_to: Literal["company", "client"]
    order_id: int | None = None
    note: Annotated[str | None, Field(default=None, max_length=300)]

    @field_validator("note")
    @classmethod
    def _clean(cls, v):
        return clean_text(v)


def _wl_out(w: VehicleWorkLog) -> dict:
    return {"id": w.id, "vehicle_id": w.vehicle_id, "plate_number": w.vehicle.plate_number, "work_date": w.work_date.isoformat(),
            "hours": _f(w.hours), "billed_to": w.billed_to, "order_id": w.order_id, "note": w.note}


@router.get("/work-logs")
def list_work_logs(date_from: date | None = None, date_to: date | None = None, vehicle_id: int | None = None,
                   db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_READ))):
    q = select(VehicleWorkLog).order_by(VehicleWorkLog.work_date.desc(), VehicleWorkLog.id.desc()).limit(300)
    if date_from:
        q = q.where(VehicleWorkLog.work_date >= date_from)
    if date_to:
        q = q.where(VehicleWorkLog.work_date <= date_to)
    if vehicle_id:
        q = q.where(VehicleWorkLog.vehicle_id == vehicle_id)
    return {"items": [_wl_out(w) for w in db.scalars(q)]}


@router.post("/work-logs", status_code=201)
def create_work_log(payload: WorkLogIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.FLEET_MANAGE))):
    _vehicle(db, payload.vehicle_id)
    if payload.work_date > today_local():
        raise _422("work_date", "Kelajak sanasini kiritib bo‘lmaydi.")
    if payload.order_id and db.get(Order, payload.order_id) is None:
        raise _422("order_id", "Buyurtma topilmadi.")
    done = sum((w.hours for w in db.scalars(select(VehicleWorkLog).where(
        VehicleWorkLog.vehicle_id == payload.vehicle_id, VehicleWorkLog.work_date == payload.work_date))), Decimal(0))
    if done + payload.hours > 24:
        raise _422("hours", f"Bir kunda 24 soatdan ortiq bo‘lishi mumkin emas (kiritilgan: {done:g} soat).")
    w = VehicleWorkLog(**payload.model_dump(), created_by_id=user.id)
    db.add(w)
    db.commit()
    db.refresh(w)
    return _wl_out(w)


@router.delete("/work-logs/{item_id}", status_code=204)
def delete_work_log(item_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_MANAGE))):
    w = db.get(VehicleWorkLog, item_id)
    if w is None:
        raise HTTPException(status_code=404, detail="Yozuv topilmadi.")
    db.delete(w)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Taksi -------------------------------------------------------------------

class TaxiIn(InputModel):
    ride_date: date
    amount: Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]
    purpose: Annotated[str | None, Field(default=None, max_length=300)]

    @field_validator("purpose")
    @classmethod
    def _clean(cls, v):
        return clean_text(v)


@router.post("/taxi", status_code=201)
def create_taxi(payload: TaxiIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.FLEET_MANAGE))):
    if payload.ride_date > today_local():
        raise _422("ride_date", "Kelajak sanasini kiritib bo‘lmaydi.")
    r = TaxiRide(**payload.model_dump(), created_by_id=user.id)
    db.add(r)
    db.commit()
    return {"id": r.id}


@router.delete("/taxi/{item_id}", status_code=204)
def delete_taxi(item_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_MANAGE))):
    r = db.get(TaxiRide, item_id)
    if r is None:
        raise HTTPException(status_code=404, detail="Yozuv topilmadi.")
    db.delete(r)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
