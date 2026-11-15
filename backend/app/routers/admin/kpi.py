"""KPI va bonus: haydovchilar (har bir reys uchun) va sotuvchilar (mijozdan pul tushish muddatiga qarab).

Faqat admin ko'radi (maosh va foiz ma'lumoti). Hamma raqam bazadagi yozuvlardan hisoblanadi.

Haydovchi bonusi = yetkazilgan reyslar soni × bir reys uchun bonus (standart 10 000 so'm; oy oxirida to'lanadi).
Sotuvchi bonusi = buyurtma uchun mijozdan tushgan pul × foiz. Foiz pul yetkazib berilgan kundan necha kun
o'tib kelganiga bog'liq: 10 kungacha / 20 kungacha / 30 kungacha / 30 kundan keyin. Foizlar har bir mijoz
bo'yicha kelishiladi (kelishilmagan mijozda standart 5 / 3 / 1 / 0.5 %). Oldindan to'langan pul — 10 kun ichida.
"""
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.deps import require
from app.models import Customer, CustomerKpiMonthRate, CustomerKpiRate, Driver, Order, OrderPayment, OrderTrip, SystemSetting, User, Vehicle
from app.models.enums import OrderStatus, TripStatus
from app.permissions import Perm
from app.schemas.common import InputModel, clean_text
from app.utils.timezone import today_local

router = APIRouter(prefix="/kpi", tags=["Admin: KPI va bonus"])

DRIVER_BONUS_KEY = "kpi.driver_bonus_per_trip"
DEFAULT_DRIVER_BONUS = 10000.0
DEFAULT_RATES = {"pct_10": 5.0, "pct_20": 3.0, "pct_30": 1.0, "pct_over": 0.5}
TIERS = ("pct_10", "pct_20", "pct_30", "pct_over")


def _f(v) -> float:
    return float(v or 0)


def _422(field: str, message: str) -> HTTPException:
    return HTTPException(status_code=422, detail=[{"loc": ["body", field], "msg": message, "type": "business_rule"}])


def _check_period(date_from: date, date_to: date) -> None:
    if date_to < date_from:
        raise _422("date_to", "Davr oxiri boshidan oldin bo‘lishi mumkin emas.")
    if (date_to - date_from).days > 400:
        raise _422("date_to", "Davr 400 kundan oshmasligi kerak.")


def _month_key(month: date) -> str:
    return f"{DRIVER_BONUS_KEY}.{month:%Y-%m}"


def _parse_month(value: str | None) -> date | None:
    if not value:
        return None
    try:
        y, m = value.split("-")
        return date(int(y), int(m), 1)
    except (ValueError, TypeError):
        raise _422("month", "Oyni YYYY-OO ko‘rinishida kiriting.") from None


def driver_bonus_rate(db: Session, month: date | None = None) -> float:
    """Bir reys uchun bonus: shu oy uchun belgilangan summa, bo'lmasa umumiy, bo'lmasa 10 000 so'm."""
    keys = ([_month_key(month)] if month else []) + [DRIVER_BONUS_KEY]
    found = dict(db.execute(select(SystemSetting.key, SystemSetting.value).where(SystemSetting.key.in_(keys))).all())
    for k in keys:
        if found.get(k):
            return float(found[k])
    return DEFAULT_DRIVER_BONUS


def month_start(d: date) -> date:
    return d.replace(day=1)


def tier_index(days: int) -> int:
    """Pul necha kun ichida kelgan: ≤10 → 0, ≤20 → 1, ≤30 → 2, undan keyin → 3 (oldindan to'lov ham 0)."""
    if days <= 10:
        return 0
    if days <= 20:
        return 1
    if days <= 30:
        return 2
    return 3


def split_payments(delivery: date, amount: float | None, payments: list) -> list[float]:
    """Tushgan pulni muddatlar bo'yicha bo'ladi. Pul buyurtma summasidan oshsa, ortig'i bonusga kirmaydi."""
    tiers = [0.0, 0.0, 0.0, 0.0]
    remaining = float("inf") if amount is None else amount
    for p in sorted(payments, key=lambda x: (x.paid_on, x.id)):
        if remaining <= 0:
            break
        take = min(_f(p.amount), remaining)
        remaining -= take
        tiers[tier_index((p.paid_on - delivery).days)] += take
    return tiers


# --- Sozlama -----------------------------------------------------------------

class ConfigIn(InputModel):
    driver_bonus_per_trip: Annotated[Decimal, Field(gt=0, le=10_000_000, max_digits=12, decimal_places=2)]
    month: Annotated[str | None, Field(default=None, max_length=7)]  # YYYY-OO; bo'sh — barcha oylar uchun umumiy


@router.get("/config")
def get_config(month: str | None = None, db: Session = Depends(get_db), _: User = Depends(require(Perm.KPI_MANAGE))):
    m = _parse_month(month)
    is_set = bool(m and db.scalar(select(SystemSetting.value).where(SystemSetting.key == _month_key(m))))
    return {"driver_bonus_per_trip": driver_bonus_rate(db, m), "month": m.strftime("%Y-%m") if m else None, "month_is_set": is_set,
            "default_rates": DEFAULT_RATES}


@router.put("/config")
def put_config(payload: ConfigIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.KPI_MANAGE))):
    m = _parse_month(payload.month)
    key = _month_key(m) if m else DRIVER_BONUS_KEY
    row = db.get(SystemSetting, key)
    if row is None:
        row = SystemSetting(key=key, is_public=False, description="Haydovchiga bir reys uchun bonus (so'm)")
        db.add(row)
    row.value = float(payload.driver_bonus_per_trip)
    row.updated_by_id = user.id
    db.commit()
    return get_config(payload.month, db, user)


# --- Haydovchilar: reys × bonus ---------------------------------------------------

@router.get("/drivers")
def drivers_report(date_from: date, date_to: date, kind: Literal["mixer", "pump", "other", "car", "all"] = "mixer",
                   driver_id: int | None = None, vehicle_id: int | None = None,
                   db: Session = Depends(get_db), _: User = Depends(require(Perm.KPI_MANAGE))):
    """«Mikserlar qatnovi bo'yicha hisobot»: haydovchi, davlat raqami, reys, hajm, bonus. Faqat yetkazilgan reyslar."""
    _check_period(date_from, date_to)
    rates_by_month: dict[date, float] = {}

    def rate_of(d: date) -> float:
        m = month_start(d)
        if m not in rates_by_month:
            rates_by_month[m] = driver_bonus_rate(db, m)
        return rates_by_month[m]

    rate = rate_of(date_to)
    q = (select(OrderTrip, Order, Vehicle, Customer).join(Order, Order.id == OrderTrip.order_id)
         .join(Vehicle, Vehicle.id == OrderTrip.vehicle_id).join(Customer, Customer.id == Order.customer_id)
         .where(Order.delivery_date >= date_from, Order.delivery_date <= date_to, OrderTrip.status != TripStatus.CANCELLED))
    if kind != "all":
        q = q.where(Vehicle.kind == kind)
    if driver_id:
        q = q.where(OrderTrip.driver_id == driver_id)
    if vehicle_id:
        q = q.where(OrderTrip.vehicle_id == vehicle_id)
    names = dict(db.execute(select(Driver.id, Driver.full_name)).all())
    rows: dict[tuple, dict] = {}
    clients: dict[int, dict] = {}
    details: list[dict] = []
    pending = 0
    for trip, order, vehicle, customer in db.execute(q):
        if trip.status != TripStatus.DELIVERED:
            pending += 1
            continue
        key = (trip.driver_id, trip.vehicle_id)
        r = rows.setdefault(key, {"driver_id": trip.driver_id, "driver": names.get(trip.driver_id), "vehicle_id": trip.vehicle_id,
                                  "plate_number": vehicle.plate_number, "kind": vehicle.kind, "trips": 0, "volume_m3": 0.0,
                                  "bonus": 0.0, "rates": set()})
        r["trips"] += 1
        r["volume_m3"] += _f(trip.volume_m3)
        trip_rate = rate_of(order.delivery_date)
        r["rates"].add(trip_rate)
        if trip.driver_id:  # haydovchi belgilanmagan reysga bonus yozilmaydi
            r["bonus"] += trip_rate
        if driver_id or vehicle_id:
            details.append({"date": order.delivery_date.isoformat(), "order_id": order.id, "order_number": order.order_number,
                            "customer": customer.company_name or customer.full_name, "address": order.delivery_address if order.delivery_required else None,
                            "grade": ", ".join(sorted({i.grade_class for i in order.items})), "plate_number": vehicle.plate_number,
                            "driver": names.get(trip.driver_id), "volume_m3": _f(trip.volume_m3)})
        c = clients.setdefault(customer.id, {"customer_id": customer.id, "name": customer.company_name or customer.full_name, "contact": customer.full_name,
                                             "phone": customer.phone, "trips": 0, "volume_m3": 0.0, "orders": set()})
        c["trips"] += 1
        c["volume_m3"] += _f(trip.volume_m3)
        c["orders"].add(order.id)
    out = []
    for r in sorted(rows.values(), key=lambda x: ((x["driver"] or "~").lower(), x["plate_number"])):
        r["bonus_per_trip"] = next(iter(r["rates"])) if len(r["rates"]) == 1 else None  # oylar bo'yicha har xil bo'lsa — None
        del r["rates"]
        r["bonus"] = round(r["bonus"], 2)
        r["volume_m3"] = round(r["volume_m3"], 2)
        out.append(r)
    client_rows = []
    if driver_id or vehicle_id:
        for c in sorted(clients.values(), key=lambda x: -x["volume_m3"]):
            c["orders"] = len(c["orders"])
            c["volume_m3"] = round(c["volume_m3"], 2)
            client_rows.append(c)
    return {
        "date_from": date_from.isoformat(), "date_to": date_to.isoformat(), "bonus_per_trip": rate,
        "month": month_start(date_to).strftime("%Y-%m"), "rows": out,
        "details": sorted(details, key=lambda x: (x["date"], x["order_number"])),
        "totals": {"trips": sum(r["trips"] for r in out), "volume_m3": round(sum(r["volume_m3"] for r in out), 2), "bonus": round(sum(r["bonus"] for r in out), 2)},
        "clients": client_rows, "pending_trips": pending,
        "unassigned_trips": sum(r["trips"] for r in out if not r["driver_id"]),
    }


# --- Sotuvchilar: pul tushish muddatiga qarab foiz -----------------------------------

def _rates_for(rate_row, month_row=None) -> dict:
    """Foiz: shu oy uchun belgilangan (tasdiqlangan) → mijoz bo'yicha doimiy → standart."""
    if month_row is not None:
        return {**{k: _f(getattr(month_row, k)) for k in TIERS}, "custom": True, "source": "month", "approved": month_row.approved_at is not None}
    if rate_row is None:
        return {**DEFAULT_RATES, "custom": False, "source": "default", "approved": False}
    return {**{k: _f(getattr(rate_row, k)) for k in TIERS}, "custom": True, "source": "customer", "approved": False}


@router.get("/sales")
def sales_report(date_from: date, date_to: date, manager_id: int | None = None, unassigned: bool = False,
                 db: Session = Depends(get_db), _: User = Depends(require(Perm.KPI_MANAGE))):
    """Sotuvchi → mijoz bo'yicha: hajm, summa, tushgan pul va bonus. Yetkazilgan buyurtmalar (yetkazish sanasi davrda)."""
    _check_period(date_from, date_to)
    q = (select(Order).options(selectinload(Order.items), selectinload(Order.customer))
         .where(Order.delivery_date >= date_from, Order.delivery_date <= date_to, Order.status == OrderStatus.DELIVERED)
         .order_by(Order.delivery_date, Order.id))
    if manager_id:
        q = q.where(Order.manager_id == manager_id)
    if unassigned:
        q = q.where(Order.manager_id.is_(None))
    orders = list(db.scalars(q))
    ids = [o.id for o in orders]
    pays: dict[int, list] = {}
    if ids:
        for p in db.scalars(select(OrderPayment).where(OrderPayment.order_id.in_(ids)).order_by(OrderPayment.paid_on, OrderPayment.id)):
            pays.setdefault(p.order_id, []).append(p)
    rates = {r.customer_id: r for r in db.scalars(select(CustomerKpiRate))}
    month_rates = {(r.month, r.customer_id): r for r in db.scalars(select(CustomerKpiMonthRate).where(
        CustomerKpiMonthRate.month >= month_start(date_from), CustomerKpiMonthRate.month <= month_start(date_to)))}
    managers = {u.id: u.full_name for u in db.scalars(select(User))}

    groups: dict[tuple, dict] = {}
    no_price = 0
    for o in orders:
        amount = None if o.concrete_total is None else _f(o.concrete_total)
        if amount is None:
            no_price += 1
        volume = sum(_f(i.volume_m3) for i in o.items)
        plist = pays.get(o.id, [])
        paid = sum(_f(p.amount) for p in plist)
        tiers = split_payments(o.delivery_date, amount, plist)
        rate = _rates_for(rates.get(o.customer_id), month_rates.get((month_start(o.delivery_date), o.customer_id)))
        bonus = sum(t * rate[k] / 100 for t, k in zip(tiers, TIERS))
        g = groups.setdefault((o.manager_id, o.customer_id), {
            "manager_id": o.manager_id, "manager": managers.get(o.manager_id), "customer_id": o.customer_id,
            "customer": o.customer.company_name or o.customer.full_name, "contact": o.customer.full_name, "grades": set(),
            "volume_m3": 0.0, "priced_volume_m3": 0.0, "amount": 0.0, "paid": 0.0, "unpaid": 0.0, "tiers": [0.0] * 4, "bonus": 0.0,
            "rates": rate, "orders": [],
        })
        g["grades"].update(i.grade_class for i in o.items)
        g["volume_m3"] += volume
        if amount is not None:
            g["priced_volume_m3"] += volume
            g["amount"] += amount
            g["unpaid"] += max(amount - paid, 0)
        g["paid"] += paid
        g["tiers"] = [a + b for a, b in zip(g["tiers"], tiers)]
        g["bonus"] += bonus
        g["orders"].append({
            "id": o.id, "order_number": o.order_number, "delivery_date": o.delivery_date.isoformat(), "volume_m3": round(volume, 2), "amount": amount,
            "paid": round(paid, 2), "bonus": round(bonus, 2), "manager_id": o.manager_id,
            "payments": [{"id": p.id, "amount": _f(p.amount), "paid_on": p.paid_on.isoformat(), "days": (p.paid_on - o.delivery_date).days, "note": p.note} for p in plist],
        })
    rows = []
    for g in sorted(groups.values(), key=lambda x: ((x["manager"] or "~").lower(), -x["amount"])):
        g["grades"] = sorted(g["grades"])
        g["price_avg"] = round(g["amount"] / g["priced_volume_m3"]) if g["priced_volume_m3"] else None
        for k in ("volume_m3", "amount", "paid", "unpaid", "bonus"):
            g[k] = round(g[k], 2)
        g["tiers"] = [round(t, 2) for t in g["tiers"]]
        del g["priced_volume_m3"]
        rows.append(g)
    by_manager: dict[int | None, dict] = {}
    for g in rows:
        m = by_manager.setdefault(g["manager_id"], {"manager_id": g["manager_id"], "manager": g["manager"], "clients": 0, "volume_m3": 0.0, "amount": 0.0, "paid": 0.0, "bonus": 0.0})
        m["clients"] += 1
        for k in ("volume_m3", "amount", "paid", "bonus"):
            m[k] = round(m[k] + g[k], 2)
    return {
        "date_from": date_from.isoformat(), "date_to": date_to.isoformat(), "default_rates": DEFAULT_RATES, "rows": rows,
        "managers": sorted(by_manager.values(), key=lambda m: -m["bonus"]),
        "totals": {"volume_m3": round(sum(g["volume_m3"] for g in rows), 2), "amount": round(sum(g["amount"] for g in rows), 2),
                   "paid": round(sum(g["paid"] for g in rows), 2), "unpaid": round(sum(g["unpaid"] for g in rows), 2),
                   "bonus": round(sum(g["bonus"] for g in rows), 2), "orders": len(orders), "no_price_orders": no_price,
                   "unassigned_orders": sum(1 for o in orders if o.manager_id is None)},
        "month_status": _month_status(db, month_start(date_to)),
    }


def _month_status(db: Session, month: date) -> dict:
    rows = list(db.scalars(select(CustomerKpiMonthRate).where(CustomerKpiMonthRate.month == month)))
    approved = [r for r in rows if r.approved_at is not None]
    latest = max((r.approved_at for r in approved), default=None)
    return {"month": month.strftime("%Y-%m"), "customers": len(rows), "approved": len(approved),
            "approved_at": latest.isoformat() if latest else None}


# --- Yozish: to'lov, sotuvchi, foizlar ------------------------------------------------

def _order(db: Session, order_id: int) -> Order:
    o = db.get(Order, order_id)
    if o is None:
        raise HTTPException(status_code=404, detail="Buyurtma topilmadi.")
    return o


class ManagerIn(InputModel):
    manager_id: int | None = None


@router.put("/orders/{order_id}/manager")
def set_manager(order_id: int, payload: ManagerIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.KPI_MANAGE))):
    order = _order(db, order_id)
    if payload.manager_id is not None:
        u = db.get(User, payload.manager_id)
        if u is None or not u.is_active:
            raise _422("manager_id", "Xodim topilmadi yoki faol emas.")
    order.manager_id = payload.manager_id
    db.commit()
    return {"id": order.id, "manager_id": order.manager_id}


class PaymentIn(InputModel):
    amount: Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]
    paid_on: date
    note: Annotated[str | None, Field(max_length=300)] = None

    @field_validator("note")
    @classmethod
    def _clean(cls, v):
        return clean_text(v) if v else None


@router.post("/orders/{order_id}/payments", status_code=status.HTTP_201_CREATED)
def add_payment(order_id: int, payload: PaymentIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.KPI_MANAGE))):
    order = _order(db, order_id)
    if order.status == OrderStatus.CANCELLED:
        raise _422("amount", "Bekor qilingan buyurtmaga to‘lov kiritib bo‘lmaydi.")
    if payload.paid_on > today_local():
        raise _422("paid_on", "Kelajak sanasini kiritib bo‘lmaydi.")
    total = order.grand_total if order.grand_total is not None else order.concrete_total
    if total is not None:
        already = sum((p.amount for p in db.scalars(select(OrderPayment).where(OrderPayment.order_id == order.id))), Decimal(0))
        if already + payload.amount > total:
            raise _422("amount", f"To‘lov buyurtma summasidan oshib ketadi: qolgan summa {max(total - already, Decimal(0)):,.0f} so‘m.".replace(",", " "))
    p = OrderPayment(order_id=order.id, amount=payload.amount, paid_on=payload.paid_on, note=payload.note, created_by_id=user.id)
    db.add(p)
    db.commit()
    return {"id": p.id}


@router.delete("/payments/{payment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_payment(payment_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.KPI_MANAGE))):
    p = db.get(OrderPayment, payment_id)
    if p is None:
        raise HTTPException(status_code=404, detail="To‘lov topilmadi.")
    db.delete(p)
    db.commit()
    return Response(status_code=204)


class RatesIn(InputModel):
    pct_10: Annotated[Decimal, Field(ge=0, le=100, max_digits=5, decimal_places=2)]
    pct_20: Annotated[Decimal, Field(ge=0, le=100, max_digits=5, decimal_places=2)]
    pct_30: Annotated[Decimal, Field(ge=0, le=100, max_digits=5, decimal_places=2)]
    pct_over: Annotated[Decimal, Field(ge=0, le=100, max_digits=5, decimal_places=2)]


@router.put("/customers/{customer_id}/rates")
def put_rates(customer_id: int, payload: RatesIn, month: str | None = None, db: Session = Depends(get_db),
              _: User = Depends(require(Perm.KPI_MANAGE))):
    """Mijoz foizi. `month` berilsa — faqat shu oy uchun (tasdiqlangan oyni o'zgartirib bo'lmaydi); bo'lmasa — doimiy."""
    if db.get(Customer, customer_id) is None:
        raise HTTPException(status_code=404, detail="Mijoz topilmadi.")
    m = _parse_month(month)
    if m is not None:
        mrow = db.get((CustomerKpiMonthRate), (m, customer_id))
        if mrow is not None and mrow.approved_at is not None:
            raise HTTPException(status_code=409, detail="Bu oy foizlari tasdiqlangan. O‘zgartirish uchun avval tasdiqni bekor qiling.")
        if mrow is None:
            mrow = CustomerKpiMonthRate(month=m, customer_id=customer_id, **payload.model_dump())
            db.add(mrow)
        else:
            for k, v in payload.model_dump().items():
                setattr(mrow, k, v)
        db.commit()
        return {"customer_id": customer_id, "month": m.strftime("%Y-%m"), **{k: _f(v) for k, v in payload.model_dump().items()}, "custom": True}
    row = db.get(CustomerKpiRate, customer_id)
    if row is None:
        row = CustomerKpiRate(customer_id=customer_id, **payload.model_dump())
        db.add(row)
    else:
        for k, v in payload.model_dump().items():
            setattr(row, k, v)
    db.commit()
    return {"customer_id": customer_id, **{k: _f(v) for k, v in payload.model_dump().items()}, "custom": True}


@router.delete("/customers/{customer_id}/rates", status_code=status.HTTP_204_NO_CONTENT)
def reset_rates(customer_id: int, month: str | None = None, db: Session = Depends(get_db), _: User = Depends(require(Perm.KPI_MANAGE))):
    m = _parse_month(month)
    if m is not None:
        mrow = db.get(CustomerKpiMonthRate, (m, customer_id))
        if mrow is not None:
            if mrow.approved_at is not None:
                raise HTTPException(status_code=409, detail="Bu oy foizlari tasdiqlangan. Avval tasdiqni bekor qiling.")
            db.delete(mrow)
            db.commit()
        return Response(status_code=204)
    row = db.get(CustomerKpiRate, customer_id)
    if row is not None:
        db.delete(row)
        db.commit()
    return Response(status_code=204)


# --- Oy foizlarini tasdiqlash -------------------------------------------------------------

class ApproveIn(InputModel):
    month: Annotated[str, Field(max_length=7)]


@router.post("/rates/approve")
def approve_month(payload: ApproveIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.KPI_MANAGE))):
    """Oy foizlarini tasdiqlaydi: shu oy yetkazilgan buyurtmasi bor har bir mijozning amaldagi foizi qotiriladi.
    Keyin standart yoki doimiy foiz o'zgarsa ham, tasdiqlangan oy hisobi o'zgarmaydi."""
    m = _parse_month(payload.month)
    if m is None:
        raise _422("month", "Oyni kiriting.")
    nxt = date(m.year + (m.month // 12), m.month % 12 + 1, 1)
    customer_ids = set(db.scalars(select(Order.customer_id).where(
        Order.delivery_date >= m, Order.delivery_date < nxt, Order.status == OrderStatus.DELIVERED)))
    existing = {r.customer_id: r for r in db.scalars(select(CustomerKpiMonthRate).where(CustomerKpiMonthRate.month == m))}
    baseline = {r.customer_id: r for r in db.scalars(select(CustomerKpiRate))}
    customer_ids |= set(existing)
    now = datetime.now(UTC)
    for cid in customer_ids:
        row = existing.get(cid)
        if row is None:
            base = _rates_for(baseline.get(cid))
            row = CustomerKpiMonthRate(month=m, customer_id=cid, **{k: base[k] for k in TIERS})
            db.add(row)
        row.approved_at = now
        row.approved_by_id = user.id
    db.commit()
    return _month_status(db, m)


@router.delete("/rates/approve/{month}", status_code=status.HTTP_200_OK)
def unapprove_month(month: str, db: Session = Depends(get_db), _: User = Depends(require(Perm.KPI_MANAGE))):
    m = _parse_month(month)
    for row in db.scalars(select(CustomerKpiMonthRate).where(CustomerKpiMonthRate.month == m)):
        row.approved_at = None
        row.approved_by_id = None
    db.commit()
    return _month_status(db, m)
