"""Sotuv bo'limi: ishlab chiqarilgan beton → sotildi / mijoz olmadi → boshqa mijozga sotildi yoki brak.

Hamma raqam bazadagi yozuvlardan hisoblanadi (ishlab chiqarish yozuvlari, yetkazilgan buyurtmalar, qaytgan beton).
Narx ko'rsatilmaydi — faqat hajm (m³).
"""
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require
from app.models import ConcreteProduct, ConcreteReturn, Customer, Order, OrderItem, ProductionRecord, User
from app.models.enums import OrderStatus, QcStatus
from app.permissions import Perm
from app.schemas.common import InputModel, clean_text
from app.utils.timezone import local_tz, today_local

router = APIRouter(prefix="/sales", tags=["Admin: sotuv"])


def _f(v) -> float:
    return float(v or 0)


def _422(field: str, message: str) -> HTTPException:
    return HTTPException(status_code=422, detail=[{"loc": ["body", field], "msg": message, "type": "business_rule"}])


def _check_period(date_from: date, date_to: date) -> None:
    if date_to < date_from:
        raise HTTPException(status_code=422, detail="Davr oxiri boshidan oldin bo‘lishi mumkin emas.")
    if (date_to - date_from).days > 400:
        raise HTTPException(status_code=422, detail="Davr 400 kundan oshmasligi kerak.")


@router.get("/overview")
def overview(date_from: date, date_to: date, db: Session = Depends(get_db), _: User = Depends(require(Perm.ORDERS_READ))):
    """Ishlab chiqarish = sotuv: qancha ishlab chiqarildi, qancha sotildi, qancha qaytdi, brak bo'ldi yoki boshqaga sotildi."""
    _check_period(date_from, date_to)
    tz = local_tz()
    produced: dict[int, dict] = {}
    for rec in db.scalars(select(ProductionRecord)):
        d = rec.produced_at.astimezone(tz).date()
        if not (date_from <= d <= date_to):
            continue
        p = produced.setdefault(rec.product_id, {"produced": 0.0, "qc_failed": 0.0})
        p["produced"] += _f(rec.produced_volume_m3)
        if rec.qc_status == QcStatus.FAILED:
            p["qc_failed"] += _f(rec.produced_volume_m3)
    delivered = {
        pid: _f(v) for pid, v in db.execute(
            select(OrderItem.product_id, func.sum(OrderItem.volume_m3)).join(Order, Order.id == OrderItem.order_id)
            .where(Order.status == OrderStatus.DELIVERED, Order.delivery_date >= date_from, Order.delivery_date <= date_to)
            .group_by(OrderItem.product_id)
        ).all()
    }
    returns = list(db.scalars(select(ConcreteReturn).where(ConcreteReturn.returned_on >= date_from, ConcreteReturn.returned_on <= date_to)
                              .order_by(ConcreteReturn.returned_on.desc(), ConcreteReturn.id.desc())))
    ret_by_product: dict[int | None, dict] = {}
    for r in returns:
        d = ret_by_product.setdefault(r.product_id, {"pending": 0.0, "resold": 0.0, "brak": 0.0})
        d[r.outcome] += _f(r.volume_m3)

    pids = set(produced) | set(delivered) | {p for p in ret_by_product if p}
    names = {p.id: (p.name, p.grade_class) for p in db.scalars(select(ConcreteProduct).where(ConcreteProduct.id.in_(pids)))} if pids else {}
    rows = []
    for pid in pids:
        pr = produced.get(pid, {"produced": 0.0, "qc_failed": 0.0})
        rt = ret_by_product.get(pid, {"pending": 0.0, "resold": 0.0, "brak": 0.0})
        sold = delivered.get(pid, 0.0)
        rows.append({
            "product_id": pid, "name": names.get(pid, ("—", ""))[0], "grade": names.get(pid, ("", "—"))[1],
            "produced_m3": round(pr["produced"], 2), "qc_failed_m3": round(pr["qc_failed"], 2), "sold_m3": round(sold, 2),
            "returned_pending_m3": round(rt["pending"], 2), "resold_m3": round(rt["resold"], 2), "brak_m3": round(rt["brak"], 2),
            "difference_m3": round(pr["produced"] - sold - rt["pending"] - rt["brak"], 2),
        })
    rows.sort(key=lambda x: x["grade"])
    totals = {k: round(sum(r[k] for r in rows), 2) for k in (
        "produced_m3", "qc_failed_m3", "sold_m3", "returned_pending_m3", "resold_m3", "brak_m3", "difference_m3")}

    orders = {o.id: o.order_number for o in db.scalars(select(Order).where(Order.id.in_({x for r in returns for x in (r.order_id, r.resold_order_id) if x})))} if returns else {}
    custs = {c.id: (c.company_name or c.full_name) for c in db.scalars(select(Customer).where(Customer.id.in_({r.customer_id for r in returns if r.customer_id})))} if returns else {}
    return {
        "date_from": date_from.isoformat(), "date_to": date_to.isoformat(), "rows": rows, "totals": totals,
        "returns": [{
            "id": r.id, "returned_on": r.returned_on.isoformat(), "order_id": r.order_id, "order_number": orders.get(r.order_id),
            "customer": custs.get(r.customer_id), "product": names.get(r.product_id, (None, None))[0], "grade": names.get(r.product_id, (None, None))[1],
            "volume_m3": _f(r.volume_m3), "reason": r.reason, "outcome": r.outcome, "resold_order_id": r.resold_order_id,
            "resold_order_number": orders.get(r.resold_order_id), "note": r.note,
        } for r in returns],
    }


class ReturnIn(InputModel):
    returned_on: date
    order_id: int | None = None          # kim olmadi (buyurtma)
    customer_id: int | None = None
    product_id: int | None = None
    volume_m3: Annotated[Decimal, Field(gt=0, le=1000, max_digits=8, decimal_places=2)]
    reason: Annotated[str | None, Field(default=None, max_length=500)]
    outcome: Literal["pending", "resold", "brak"] = "pending"
    resold_order_id: int | None = None   # kimga sotildi
    note: Annotated[str | None, Field(default=None, max_length=500)]

    @field_validator("reason", "note")
    @classmethod
    def _clean(cls, v: str | None) -> str | None:
        return clean_text(v)


def _apply(db: Session, row: ConcreteReturn, data: ReturnIn) -> None:
    if data.returned_on > today_local():
        raise _422("returned_on", "Kelajak sanasini kiritib bo‘lmaydi.")
    customer_id, product_id = data.customer_id, data.product_id
    if data.order_id is not None:
        order = db.get(Order, data.order_id)
        if order is None:
            raise _422("order_id", "Buyurtma topilmadi.")
        customer_id = customer_id or order.customer_id
        if product_id is None and order.items:
            product_id = order.items[0].product_id
    if customer_id is not None and db.get(Customer, customer_id) is None:
        raise _422("customer_id", "Mijoz topilmadi.")
    if data.outcome == "resold":
        if data.resold_order_id is None:
            raise _422("resold_order_id", "Qaysi buyurtmaga sotilganini tanlang.")
        if db.get(Order, data.resold_order_id) is None:
            raise _422("resold_order_id", "Buyurtma topilmadi.")
    row.returned_on = data.returned_on
    row.order_id = data.order_id
    row.customer_id = customer_id
    row.product_id = product_id
    row.volume_m3 = data.volume_m3
    row.reason = data.reason
    row.outcome = data.outcome
    row.resold_order_id = data.resold_order_id if data.outcome == "resold" else None
    row.note = data.note


@router.post("/returns", status_code=status.HTTP_201_CREATED)
def create_return(payload: ReturnIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.ORDERS_MANAGE))):
    row = ConcreteReturn(created_by_id=user.id, returned_on=payload.returned_on, volume_m3=payload.volume_m3)
    _apply(db, row, payload)
    db.add(row)
    db.commit()
    return {"id": row.id}


@router.put("/returns/{return_id}")
def update_return(return_id: int, payload: ReturnIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.ORDERS_MANAGE))):
    row = db.get(ConcreteReturn, return_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Yozuv topilmadi.")
    _apply(db, row, payload)
    db.commit()
    return {"id": row.id}


@router.delete("/returns/{return_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_return(return_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.ORDERS_MANAGE))):
    row = db.get(ConcreteReturn, return_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Yozuv topilmadi.")
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.get("/delivered-orders")
def delivered_orders(q: Annotated[str | None, Query(max_length=60)] = None, db: Session = Depends(get_db),
                     _: User = Depends(require(Perm.ORDERS_READ))):
    """Qaytish/qayta sotish formasida buyurtma tanlash uchun ro'yxat (oxirgi 120 ta)."""
    stmt = select(Order).where(Order.status != OrderStatus.CANCELLED).order_by(Order.id.desc()).limit(120)
    out = []
    for o in db.scalars(stmt):
        out.append({"id": o.id, "order_number": o.order_number, "customer": o.customer.company_name or o.customer.full_name,
                    "delivery_date": o.delivery_date.isoformat(), "volume_m3": round(sum(_f(i.volume_m3) for i in o.items), 2)})
    return out
