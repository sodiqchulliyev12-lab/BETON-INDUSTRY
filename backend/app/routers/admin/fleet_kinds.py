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
from app.models import Driver, Order, OrderTrip, TaxiRide, User, Vehicle, VehicleBreakdown, VehicleExpense, VehicleWorkLog
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


FUEL_TYPES = ("gas", "diesel", "petrol")


def _fuel_empty() -> dict:
    return {t: {"cost": 0.0, "qty": 0.0} for t in (*FUEL_TYPES, "unknown")}


@router.get("/kind/{kind}")
def kind_report(kind: Literal["mixer", "pump", "other", "car"], date_: date = Query(alias="date", default_factory=today_local),
                date_from: date | None = None, date_to: date | None = None,
                db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_READ))):
    """«Kun» = date; «Davr» = date_from…date_to (berilmasa — date oyining o'zi)."""
    m0 = date_from or date_.replace(day=1)
    m1 = date_to or date_.replace(day=monthrange(date_.year, date_.month)[1])
    if m1 < m0:
        raise _422("date_to", "Davr oxiri boshidan oldin bo‘lishi mumkin emas.")
    if (m1 - m0).days > 400:
        raise _422("date_to", "Davr 400 kundan oshmasligi kerak.")
    vehicles = list(db.scalars(select(Vehicle).where(Vehicle.kind == kind).order_by(Vehicle.is_active.desc(), Vehicle.ownership, Vehicle.plate_number)))
    ids = {v.id for v in vehicles}
    per: dict[int, dict[str, dict]] = {v.id: {"day": _empty(), "month": _empty()} for v in vehicles}
    fuel_types = {"day": _fuel_empty(), "period": _fuel_empty()}
    drivers_by_vehicle: dict[int, dict[int | None, dict]] = {v.id: {} for v in vehicles}
    daily: dict[date, dict] = {}
    series_to = min(m1, max(today_local(), m0))  # kelajak kunlari grafikda ko'rsatilmaydi
    series_from = max(m0, series_to - timedelta(days=91))

    def slot(vid: int, d: date):
        if m0 <= d <= m1:
            yield per[vid]["month"]
        if d == date_:
            yield per[vid]["day"]

    def day_slot(d: date) -> dict | None:
        return daily.setdefault(d, {"date": d.isoformat(), "trips": 0, "hours": 0.0, "fuel": 0.0}) if series_from <= d <= series_to else None

    lo = min(m0, date_)
    hi = max(m1, date_)
    names = dict(db.execute(select(Driver.id, Driver.full_name)).all())
    if ids:
        for vid, delivery, vol, pay, drv in db.execute(
            select(OrderTrip.vehicle_id, Order.delivery_date, OrderTrip.volume_m3, OrderTrip.rental_cost, OrderTrip.driver_id)
            .join(Order, Order.id == OrderTrip.order_id)
            .where(OrderTrip.vehicle_id.in_(ids), Order.delivery_date >= lo, Order.delivery_date <= hi, OrderTrip.status != TripStatus.CANCELLED)
        ):
            for s in slot(vid, delivery):
                _add(s, trips=1, volume_m3=_f(vol), trip_pay=_f(pay))
            if (d := day_slot(delivery)) is not None:
                d["trips"] += 1
            # bitta mashinani bir necha haydovchi haydashi mumkin: har bir qatnov o'z haydovchisi bilan hisoblanadi
            rec = drivers_by_vehicle[vid].setdefault(drv, {"trips_day": 0, "trips_period": 0})
            if delivery == date_:
                rec["trips_day"] += 1
            if m0 <= delivery <= m1:
                rec["trips_period"] += 1
        for vid, d_, hrs, billed, drv in db.execute(
            select(VehicleWorkLog.vehicle_id, VehicleWorkLog.work_date, VehicleWorkLog.hours, VehicleWorkLog.billed_to, VehicleWorkLog.driver_id)
            .where(VehicleWorkLog.vehicle_id.in_(ids), VehicleWorkLog.work_date >= lo, VehicleWorkLog.work_date <= hi)
        ):
            for s in slot(vid, d_):
                _add(s, hours=_f(hrs), **{f"hours_{'company' if billed == 'company' else 'client'}": _f(hrs)})
            if (d := day_slot(d_)) is not None:
                d["hours"] += _f(hrs)
            if drv is not None:
                rec = drivers_by_vehicle[vid].setdefault(drv, {"trips_day": 0, "trips_period": 0})
                rec.setdefault("hours_period", 0.0)
                if m0 <= d_ <= m1:
                    rec["hours_period"] += _f(hrs)
        for vid, d_, cat, amount, ft, qty in db.execute(
            select(VehicleExpense.vehicle_id, VehicleExpense.expense_date, VehicleExpense.category, VehicleExpense.amount,
                   VehicleExpense.fuel_type, VehicleExpense.quantity)
            .where(VehicleExpense.vehicle_id.in_(ids), VehicleExpense.expense_date >= lo, VehicleExpense.expense_date <= hi)
        ):
            a = _f(amount)
            field = "fuel" if cat == "fuel" else ("parts" if cat == "parts" else "other_costs")
            for s in slot(vid, d_):
                _add(s, **{field: a, "expenses_total": a})
            if cat == "fuel":
                key = ft or "unknown"
                if m0 <= d_ <= m1:
                    fuel_types["period"][key]["cost"] += a
                    fuel_types["period"][key]["qty"] += _f(qty)
                if d_ == date_:
                    fuel_types["day"][key]["cost"] += a
                    fuel_types["day"][key]["qty"] += _f(qty)
                if (d := day_slot(d_)) is not None:
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
            "is_active": v.is_active, "capacity_m3": _f(v.capacity_m3) if v.capacity_m3 else None, "fuel_type": v.fuel_type,
            "inspection_date": v.inspection_date.isoformat() if v.inspection_date else None,
            "inspection_due": v.inspection_due.isoformat() if v.inspection_due else None,
            "inspection_status": inspection_status(v.inspection_due),
            "default_driver": names.get(v.default_driver_id),
            "drivers": sorted(
                [{"id": did, "name": names.get(did) if did is not None else None, **rec} for did, rec in drivers_by_vehicle[v.id].items()],
                key=lambda x: -x.get("trips_period", 0)),
            "day": per[v.id]["day"], "month": per[v.id]["month"],
        })
    active_rows = [r for r in rows if r["is_active"]]
    n_days = (m1 - m0).days + 1
    result = {
        "kind": kind, "date": date_.isoformat(), "period_from": m0.isoformat(), "period_to": m1.isoformat(), "period_days": n_days,
        "vehicles": rows, "totals": totals, "fuel_types": fuel_types,
        "inspection": {s: sum(1 for r in active_rows if r["inspection_status"] == s) for s in ("ok", "soon", "overdue", "unknown")},
        "daily": [daily.get(series_from + timedelta(days=i), {"date": (series_from + timedelta(days=i)).isoformat(), "trips": 0, "hours": 0.0, "fuel": 0.0})
                  for i in range((series_to - series_from).days + 1)],
    }
    if kind == "car":
        rides = list(db.scalars(select(TaxiRide).where(TaxiRide.ride_date >= lo, TaxiRide.ride_date <= hi).order_by(TaxiRide.ride_date.desc(), TaxiRide.id.desc())))
        in_period = [r for r in rides if m0 <= r.ride_date <= m1]
        result["taxi"] = {
            "day": {"rides": sum(1 for r in rides if r.ride_date == date_), "amount": sum(_f(r.amount) for r in rides if r.ride_date == date_)},
            "month": {"rides": len(in_period), "amount": sum(_f(r.amount) for r in in_period)},
            "items": [{"id": r.id, "ride_date": r.ride_date.isoformat(), "amount": _f(r.amount), "purpose": r.purpose} for r in in_period],
        }
    return result


# --- Yoqilg'i hisoboti (gaz / dizel / benzin) ---------------------------------

@router.get("/fuel")
def fuel_report(date_: date = Query(alias="date", default_factory=today_local), date_from: date | None = None, date_to: date | None = None,
                vehicle_id: int | None = None, kind: Literal["mixer", "pump", "other", "car"] | None = None,
                db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_READ))):
    """Yoqilg'i turlari bo'yicha kunlik (date) va davr (date_from…date_to, default — date oyi) hisobot."""
    m0 = date_from or date_.replace(day=1)
    m1 = date_to or date_.replace(day=monthrange(date_.year, date_.month)[1])
    if m1 < m0:
        raise _422("date_to", "Davr oxiri boshidan oldin bo‘lishi mumkin emas.")
    if (m1 - m0).days > 400:
        raise _422("date_to", "Davr 400 kundan oshmasligi kerak.")
    lo, hi = min(m0, date_), max(m1, date_)
    q = (select(VehicleExpense, Vehicle).join(Vehicle, Vehicle.id == VehicleExpense.vehicle_id)
         .where(VehicleExpense.category == "fuel", VehicleExpense.expense_date >= lo, VehicleExpense.expense_date <= hi))
    if vehicle_id:
        q = q.where(VehicleExpense.vehicle_id == vehicle_id)
    if kind:
        q = q.where(Vehicle.kind == kind)
    types = {"day": _fuel_empty(), "period": _fuel_empty()}
    for t in types.values():
        for v in t.values():
            v["count"] = 0
    by_vehicle: dict[int, dict] = {}
    series_to = min(m1, max(today_local(), m0))  # kelajak kunlari grafikda ko'rsatilmaydi
    series_from = max(m0, series_to - timedelta(days=91))
    daily: dict[date, dict] = {}
    for e, v in db.execute(q):
        key = e.fuel_type or "unknown"
        a, qty = _f(e.amount), _f(e.quantity)
        in_period = m0 <= e.expense_date <= m1
        if in_period:
            types["period"][key]["cost"] += a
            types["period"][key]["qty"] += qty
            types["period"][key]["count"] += 1
            row = by_vehicle.setdefault(v.id, {"id": v.id, "plate_number": v.plate_number, "vehicle_type": v.vehicle_type, "kind": v.kind,
                                               "default_fuel": v.fuel_type, "by_type": _fuel_empty(), "total": 0.0})
            row["by_type"][key]["cost"] += a
            row["by_type"][key]["qty"] += qty
            row["total"] += a
            if e.expense_date >= series_from:
                d = daily.setdefault(e.expense_date, {"date": e.expense_date.isoformat(), **{k: 0.0 for k in (*FUEL_TYPES, "unknown")}})
                d[key] += a
        if e.expense_date == date_:
            types["day"][key]["cost"] += a
            types["day"][key]["qty"] += qty
            types["day"][key]["count"] += 1
    return {
        "date": date_.isoformat(), "period_from": m0.isoformat(), "period_to": m1.isoformat(), "types": types,
        "total": {"day": round(sum(t["cost"] for t in types["day"].values()), 2), "period": round(sum(t["cost"] for t in types["period"].values()), 2)},
        "vehicles": sorted(by_vehicle.values(), key=lambda r: -r["total"]),
        "daily": [daily.get(series_from + timedelta(days=i), {"date": (series_from + timedelta(days=i)).isoformat(), **{k: 0.0 for k in (*FUEL_TYPES, "unknown")}})
                  for i in range((series_to - series_from).days + 1)],
    }


# --- Qatnovlar: haydovchi va transport bo'yicha kun / davr ---------------------

@router.get("/usage")
def usage(date_: date = Query(alias="date", default_factory=today_local), date_from: date | None = None, date_to: date | None = None,
          driver_id: int | None = None, vehicle_id: int | None = None, kind: Literal["mixer", "pump", "other", "car"] | None = None,
          db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_READ))):
    """Tanlangan haydovchi yoki mashina bo'yicha kunlik va davr ma'lumoti.

    Bir mashinani bir kunda bir necha haydovchi, bir haydovchi esa bir necha mashinani haydashi mumkin:
    har bir qatnov o'z haydovchisi va mashinasi bilan alohida hisoblanadi.
    """
    m0 = date_from or date_.replace(day=1)
    m1 = date_to or date_.replace(day=monthrange(date_.year, date_.month)[1])
    if m1 < m0:
        raise _422("date_to", "Davr oxiri boshidan oldin bo‘lishi mumkin emas.")
    if (m1 - m0).days > 400:
        raise _422("date_to", "Davr 400 kundan oshmasligi kerak.")
    lo, hi = min(m0, date_), max(m1, date_)
    q = (select(OrderTrip, Order.delivery_date, Order.order_number).join(Order, Order.id == OrderTrip.order_id).join(Vehicle, Vehicle.id == OrderTrip.vehicle_id)
         .where(Order.delivery_date >= lo, Order.delivery_date <= hi, OrderTrip.status != TripStatus.CANCELLED))
    if driver_id:
        q = q.where(OrderTrip.driver_id == driver_id)
    if vehicle_id:
        q = q.where(OrderTrip.vehicle_id == vehicle_id)
    names = dict(db.execute(select(Driver.id, Driver.full_name)).all())
    plates = {v.id: v for v in db.scalars(select(Vehicle))}
    # Tur bo'yicha kartalar uchun: «kind» filtri ta'sir qilmaydi (haydovchi/mashina filtri ta'sir qiladi)
    by_kind = {k: {"trips_day": 0, "trips_period": 0, "volume_period": 0.0, "hours_day": 0.0, "hours_period": 0.0, "vehicles": set()} for k in KINDS}
    tot = {"day": {"trips": 0, "volume_m3": 0.0, "trip_pay": 0.0}, "period": {"trips": 0, "volume_m3": 0.0, "trip_pay": 0.0}}
    by_vehicle: dict[int, dict] = {}
    by_driver: dict[int | None, dict] = {}
    daily: dict[date, int] = {}
    day_trips = []
    for t, delivery, number in db.execute(q):
        in_period = m0 <= delivery <= m1
        on_day = delivery == date_
        bk = by_kind[plates[t.vehicle_id].kind]
        if on_day:
            bk["trips_day"] += 1
        if in_period:
            bk["trips_period"] += 1
            bk["volume_period"] += _f(t.volume_m3)
            bk["vehicles"].add(t.vehicle_id)
        if kind and plates[t.vehicle_id].kind != kind:
            continue
        for label, hit in (("day", on_day), ("period", in_period)):
            if hit:
                tot[label]["trips"] += 1
                tot[label]["volume_m3"] += _f(t.volume_m3)
                tot[label]["trip_pay"] += _f(t.rental_cost)
        v = plates[t.vehicle_id]
        for table, key, base in ((by_vehicle, t.vehicle_id, {"plate_number": v.plate_number, "vehicle_type": v.vehicle_type, "kind": v.kind, "ownership": v.ownership.value}),
                                 (by_driver, t.driver_id, {"name": names.get(t.driver_id)})):
            row = table.setdefault(key, {"id": key, **base, "trips_day": 0, "trips_period": 0, "volume_period": 0.0, "days": set()})
            if on_day:
                row["trips_day"] += 1
            if in_period:
                row["trips_period"] += 1
                row["volume_period"] += _f(t.volume_m3)
                row["days"].add(delivery)
        if in_period:
            daily[delivery] = daily.get(delivery, 0) + 1
        if on_day:
            day_trips.append({"id": t.id, "order_id": t.order_id, "order_number": number, "trip_no": t.trip_no, "plate_number": v.plate_number, "kind": v.kind,
                              "ownership": v.ownership.value, "driver": names.get(t.driver_id), "volume_m3": _f(t.volume_m3), "status": t.status.value})

    def fin(table):
        out = []
        for r in table.values():
            r["days_worked"] = len(r.pop("days"))
            out.append(r)
        return sorted(out, key=lambda r: -r["trips_period"])

    # Ish soati (nasos operatori) va yoqilg'i: tanlangan mashina/haydovchi bo'yicha
    wl = select(VehicleWorkLog.work_date, VehicleWorkLog.hours, Vehicle.kind).join(Vehicle, Vehicle.id == VehicleWorkLog.vehicle_id).where(VehicleWorkLog.work_date >= lo, VehicleWorkLog.work_date <= hi)
    if driver_id:
        wl = wl.where(VehicleWorkLog.driver_id == driver_id)
    if vehicle_id:
        wl = wl.where(VehicleWorkLog.vehicle_id == vehicle_id)
    hours = {"day": 0.0, "period": 0.0}
    for d_, hrs, k_ in db.execute(wl):
        if d_ == date_:
            by_kind[k_]["hours_day"] += _f(hrs)
        if m0 <= d_ <= m1:
            by_kind[k_]["hours_period"] += _f(hrs)
        if kind and k_ != kind:
            continue
        if d_ == date_:
            hours["day"] += _f(hrs)
        if m0 <= d_ <= m1:
            hours["period"] += _f(hrs)
    fuel = {"day": 0.0, "period": 0.0}
    if not driver_id:  # yoqilg'i mashinaga yoziladi, haydovchiga emas
        fq = select(VehicleExpense.expense_date, VehicleExpense.amount).join(Vehicle, Vehicle.id == VehicleExpense.vehicle_id).where(
            VehicleExpense.category == "fuel", VehicleExpense.expense_date >= lo, VehicleExpense.expense_date <= hi)
        if vehicle_id:
            fq = fq.where(VehicleExpense.vehicle_id == vehicle_id)
        if kind:
            fq = fq.where(Vehicle.kind == kind)
        for d_, amount in db.execute(fq):
            if d_ == date_:
                fuel["day"] += _f(amount)
            if m0 <= d_ <= m1:
                fuel["period"] += _f(amount)
    series_to = min(m1, max(today_local(), m0))  # kelajak kunlari grafikda ko'rsatilmaydi
    series_from = max(m0, series_to - timedelta(days=91))
    return {
        "date": date_.isoformat(), "period_from": m0.isoformat(), "period_to": m1.isoformat(), "totals": tot, "hours": hours,
        "fuel": None if driver_id else fuel,
        "by_kind": {k: {**{x: v for x, v in d.items() if x != "vehicles"}, "vehicles": len(d["vehicles"])} for k, d in by_kind.items()},
        "vehicles_count": {"day": len({t["plate_number"] for t in day_trips}), "period": len(by_vehicle)},
        "drivers_count": {"day": len({t["driver"] for t in day_trips if t["driver"]}), "period": len([k for k in by_driver if k is not None])},
        "by_vehicle": fin(by_vehicle), "by_driver": fin(by_driver), "trips_day": day_trips,
        "daily": [{"date": (series_from + timedelta(days=i)).isoformat(), "trips": daily.get(series_from + timedelta(days=i), 0)} for i in range((series_to - series_from).days + 1)],
    }


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
    driver_id: int | None = None
    note: Annotated[str | None, Field(default=None, max_length=300)]

    @field_validator("note")
    @classmethod
    def _clean(cls, v):
        return clean_text(v)


def _wl_out(w: VehicleWorkLog) -> dict:
    return {"id": w.id, "vehicle_id": w.vehicle_id, "plate_number": w.vehicle.plate_number, "work_date": w.work_date.isoformat(),
            "hours": _f(w.hours), "billed_to": w.billed_to, "order_id": w.order_id, "driver_id": w.driver_id,
            "driver": w.driver.full_name if w.driver else None, "note": w.note}


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
    if payload.driver_id and db.get(Driver, payload.driver_id) is None:
        raise _422("driver_id", "Haydovchi topilmadi.")
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
