"""Ombor bo'limi: xomashyo, kirim/chiqim, ishlab chiqarishga berish, omborlar aro ko'chirish, inventarizatsiya, hisobot."""
from datetime import date, timedelta
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require
from app.models import ConcreteProduct, Material, Order, OrderItem, ProductionRecord, StockMovement, Supplier, User, Warehouse
from app.models.enums import OrderStatus, QcStatus
from app.models.warehouse import MATERIAL_CATEGORIES, MATERIAL_UNITS
from app.permissions import Perm
from app.schemas.common import InputModel, clean_text
from app.services import warehouse as wh
from app.services.orders import OrderError
from app.utils.phone import normalize_phone
from app.utils.timezone import today_local

router = APIRouter(prefix="/warehouse", tags=["Admin: ombor"])
Category = Literal["cement", "sand", "gravel", "crushed_stone", "water", "additive", "other"]
Unit = Literal["ton", "kg", "m3", "liter"]
Qty = Annotated[Decimal, Field(max_digits=14, decimal_places=3)]


def _404(what: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{what} topilmadi.")


def _get(db: Session, model, pk: int, what: str):
    obj = db.get(model, pk)
    if obj is None:
        raise _404(what)
    return obj


def _conflict(field: str, message: str) -> HTTPException:
    return HTTPException(status_code=409, detail=[{"loc": ["body", field], "msg": message, "type": "business_rule"}])


def _f(v) -> float:
    return float(v or 0)


# --- Omborlar --------------------------------------------------------------

class NameIn(InputModel):
    name: Annotated[str, Field(min_length=2, max_length=100)]
    notes: Annotated[str | None, Field(default=None, max_length=500)]
    is_active: bool = True

    @field_validator("name", "notes")
    @classmethod
    def _clean(cls, v):
        return clean_text(v)


@router.get("/warehouses")
def list_warehouses(db: Session = Depends(get_db), _: User = Depends(require(Perm.WAREHOUSE_READ))):
    return [{"id": w.id, "name": w.name, "notes": w.notes, "is_active": w.is_active}
            for w in db.scalars(select(Warehouse).order_by(Warehouse.is_active.desc(), Warehouse.name))]


@router.post("/warehouses", status_code=201)
def create_warehouse(payload: NameIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.WAREHOUSE_MANAGE))):
    w = Warehouse(**payload.model_dump())
    db.add(w)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict("name", "Bunday nomli ombor allaqachon bor.") from None
    return {"id": w.id, "name": w.name, "notes": w.notes, "is_active": w.is_active}


@router.put("/warehouses/{warehouse_id}")
def update_warehouse(warehouse_id: int, payload: NameIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.WAREHOUSE_MANAGE))):
    w = _get(db, Warehouse, warehouse_id, "Ombor")
    for k, v in payload.model_dump().items():
        setattr(w, k, v)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict("name", "Bunday nomli ombor allaqachon bor.") from None
    return {"id": w.id, "name": w.name, "notes": w.notes, "is_active": w.is_active}


# --- Ta'minotchilar --------------------------------------------------------

class SupplierIn(InputModel):
    name: Annotated[str, Field(min_length=2, max_length=150)]
    phone: Annotated[str | None, Field(default=None, max_length=30)]
    notes: Annotated[str | None, Field(default=None, max_length=500)]
    is_active: bool = True

    @field_validator("name", "notes")
    @classmethod
    def _clean(cls, v):
        return clean_text(v)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v):
        v = clean_text(v)
        return normalize_phone(v) if v else None


def _supplier_out(s: Supplier, deliveries: int = 0) -> dict:
    return {"id": s.id, "name": s.name, "phone": s.phone, "notes": s.notes, "is_active": s.is_active, "deliveries": deliveries}


@router.get("/suppliers")
def list_suppliers(db: Session = Depends(get_db), _: User = Depends(require(Perm.WAREHOUSE_READ))):
    counts = dict(db.execute(select(StockMovement.supplier_id, func.count()).where(StockMovement.supplier_id.is_not(None)).group_by(StockMovement.supplier_id)).all())
    return [_supplier_out(s, counts.get(s.id, 0)) for s in db.scalars(select(Supplier).order_by(Supplier.is_active.desc(), Supplier.name))]


@router.post("/suppliers", status_code=201)
def create_supplier(payload: SupplierIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.WAREHOUSE_MANAGE))):
    s = Supplier(**payload.model_dump())
    db.add(s)
    db.commit()
    return _supplier_out(s)


@router.put("/suppliers/{supplier_id}")
def update_supplier(supplier_id: int, payload: SupplierIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.WAREHOUSE_MANAGE))):
    s = _get(db, Supplier, supplier_id, "Ta’minotchi")
    for k, v in payload.model_dump().items():
        setattr(s, k, v)
    db.commit()
    return _supplier_out(s)


@router.delete("/suppliers/{supplier_id}", status_code=204)
def delete_supplier(supplier_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.WAREHOUSE_MANAGE))):
    s = _get(db, Supplier, supplier_id, "Ta’minotchi")
    db.delete(s)  # harakatlardagi supplier_id NULL bo'ladi (tarix saqlanadi)
    db.commit()
    return Response(status_code=204)


# --- Materiallar -----------------------------------------------------------

class MaterialIn(InputModel):
    name: Annotated[str, Field(min_length=2, max_length=150)]
    category: Category
    unit: Unit
    sku: Annotated[str | None, Field(default=None, max_length=30)]
    min_stock: Annotated[Decimal | None, Field(default=None, ge=0, max_digits=14, decimal_places=3)]
    norm_per_m3: Annotated[Decimal | None, Field(default=None, ge=0, max_digits=12, decimal_places=3)]
    is_active: bool = True
    notes: Annotated[str | None, Field(default=None, max_length=500)]

    @field_validator("name", "sku", "notes")
    @classmethod
    def _clean(cls, v):
        return clean_text(v)


def _period(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    date_to = date_to or today_local()
    return date_from or (date_to - timedelta(days=29)), date_to


@router.get("/materials")
def list_materials(warehouse_id: int | None = None, category: str | None = None, date_from: date | None = None,
                   date_to: date | None = None, db: Session = Depends(get_db), _: User = Depends(require(Perm.WAREHOUSE_READ))):
    date_from, date_to = _period(date_from, date_to)
    return {"date_from": date_from.isoformat(), "date_to": date_to.isoformat(),
            "items": wh.material_rows(db, warehouse_id=warehouse_id, date_from=date_from, date_to=date_to, category=category)}


@router.post("/materials", status_code=201)
def create_material(payload: MaterialIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.WAREHOUSE_MANAGE))):
    data = payload.model_dump()
    data["sku"] = (data["sku"] or wh.next_sku(db, payload.category)).upper()
    m = Material(**data)
    db.add(m)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict("sku", "Bu kod (SKU) allaqachon ishlatilgan.") from None
    return {"id": m.id, "sku": m.sku}


@router.put("/materials/{material_id}")
def update_material(material_id: int, payload: MaterialIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.WAREHOUSE_MANAGE))):
    m = _get(db, Material, material_id, "Material")
    data = payload.model_dump()
    data["sku"] = (data["sku"] or m.sku).upper()
    if data["unit"] != m.unit and db.scalar(select(func.count()).select_from(StockMovement).where(StockMovement.material_id == m.id)):
        raise _conflict("unit", "Harakatlar bor materialning o‘lchov birligini o‘zgartirib bo‘lmaydi.")
    for k, v in data.items():
        setattr(m, k, v)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict("sku", "Bu kod (SKU) allaqachon ishlatilgan.") from None
    return {"id": m.id, "sku": m.sku}


@router.delete("/materials/{material_id}", status_code=204)
def delete_material(material_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.WAREHOUSE_MANAGE))):
    m = _get(db, Material, material_id, "Material")
    if db.scalar(select(func.count()).select_from(StockMovement).where(StockMovement.material_id == m.id)):
        raise HTTPException(status_code=409, detail="Materialda harakatlar bor. O‘chirish o‘rniga nofaol qiling.")
    db.delete(m)
    db.commit()
    return Response(status_code=204)


# --- Dashboard -------------------------------------------------------------

@router.get("/summary")
def summary(warehouse_id: int | None = None, date_from: date | None = None, date_to: date | None = None,
            db: Session = Depends(get_db), _: User = Depends(require(Perm.WAREHOUSE_READ))):
    date_from, date_to = _period(date_from, date_to)
    rows = [r for r in wh.material_rows(db, warehouse_id=warehouse_id, date_from=date_from, date_to=date_to) if r["is_active"]]
    by_cat = {}
    for r in rows:
        c = by_cat.setdefault(r["category"], {"materials": 0, "stock": {}})
        c["materials"] += 1
        c["stock"][r["unit"]] = round(c["stock"].get(r["unit"], 0) + r["stock"], 3)
    value = 0.0
    priced = 0
    for r in rows:
        if r["avg_price"] is not None and r["stock"] > 0:
            value += r["stock"] * r["avg_price"]
            priced += 1
    movements = db.execute(
        select(StockMovement.kind, func.count()).where(StockMovement.movement_date >= date_from, StockMovement.movement_date <= date_to)
        .group_by(StockMovement.kind)
    ).all()
    return {
        "date_from": date_from.isoformat(), "date_to": date_to.isoformat(),
        "materials": len(rows),
        "categories": by_cat,
        "low": [r for r in rows if r["status"] == "low"],
        "out": [r for r in rows if r["status"] == "out"],
        "no_limit": sum(1 for r in rows if r["status"] == "no_limit"),
        "value": round(value) if priced else None,
        "value_priced": priced, "value_total": sum(1 for r in rows if r["stock"] > 0),
        "movements": {kind: n for kind, n in movements},
    }


# --- Harakatlar ------------------------------------------------------------

class MovementIn(InputModel):
    material_id: int
    warehouse_id: int
    kind: Literal["opening", "in", "out", "production", "adjust"]
    quantity: Qty
    movement_date: date
    supplier_id: int | None = None
    unit_price: Annotated[Decimal | None, Field(default=None, ge=0, max_digits=14, decimal_places=2)]
    document_no: Annotated[str | None, Field(default=None, max_length=50)]
    note: Annotated[str | None, Field(default=None, max_length=500)]

    @field_validator("document_no", "note")
    @classmethod
    def _clean(cls, v):
        return clean_text(v)


class TransferIn(InputModel):
    material_id: int
    from_warehouse_id: int
    to_warehouse_id: int
    quantity: Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=3)]
    movement_date: date
    note: Annotated[str | None, Field(default=None, max_length=500)]

    @field_validator("note")
    @classmethod
    def _clean(cls, v):
        return clean_text(v)


def _material(db: Session, material_id: int) -> Material:
    m = db.get(Material, material_id)
    if m is None or not m.is_active:
        raise OrderError("Material topilmadi yoki nofaol.", field="material_id")
    return m


def _warehouse(db: Session, warehouse_id: int, field: str = "warehouse_id") -> Warehouse:
    w = db.get(Warehouse, warehouse_id)
    if w is None or not w.is_active:
        raise OrderError("Ombor topilmadi yoki nofaol.", field=field)
    return w


def _move_out(mv: StockMovement, names: dict) -> dict:
    return {"id": mv.id, "material_id": mv.material_id, "material": names["m"].get(mv.material_id), "unit": names["u"].get(mv.material_id),
            "warehouse_id": mv.warehouse_id, "warehouse": names["w"].get(mv.warehouse_id), "kind": mv.kind,
            "quantity": _f(mv.quantity), "movement_date": mv.movement_date.isoformat(), "supplier": names["s"].get(mv.supplier_id),
            "unit_price": _f(mv.unit_price) if mv.unit_price is not None else None, "document_no": mv.document_no,
            "note": mv.note, "transfer_group": mv.transfer_group}


@router.get("/movements")
def list_movements(kind: str | None = None, material_id: int | None = None, warehouse_id: int | None = None,
                   date_from: date | None = None, date_to: date | None = None, limit: int = Query(300, le=1000),
                   db: Session = Depends(get_db), _: User = Depends(require(Perm.WAREHOUSE_READ))):
    q = select(StockMovement).order_by(StockMovement.movement_date.desc(), StockMovement.id.desc()).limit(limit)
    if kind:
        kinds = {"input": ("opening", "in"), "output": ("out",), "release": ("production",), "transfer": ("transfer_in", "transfer_out"),
                 "inventory": ("adjust",)}.get(kind, (kind,))
        q = q.where(StockMovement.kind.in_(kinds))
    if material_id:
        q = q.where(StockMovement.material_id == material_id)
    if warehouse_id:
        q = q.where(StockMovement.warehouse_id == warehouse_id)
    if date_from:
        q = q.where(StockMovement.movement_date >= date_from)
    if date_to:
        q = q.where(StockMovement.movement_date <= date_to)
    items = list(db.scalars(q))
    names = {
        "m": dict(db.execute(select(Material.id, Material.name)).all()),
        "u": dict(db.execute(select(Material.id, Material.unit)).all()),
        "w": dict(db.execute(select(Warehouse.id, Warehouse.name)).all()),
        "s": dict(db.execute(select(Supplier.id, Supplier.name)).all()),
    }
    return {"items": [_move_out(i, names) for i in items]}


@router.post("/movements", status_code=201)
def create_movement(payload: MovementIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.WAREHOUSE_MANAGE))):
    m = _material(db, payload.material_id)
    _warehouse(db, payload.warehouse_id)
    if payload.supplier_id and db.get(Supplier, payload.supplier_id) is None:
        raise OrderError("Ta’minotchi topilmadi.", field="supplier_id")
    if payload.kind != "adjust" and payload.quantity <= 0:
        raise OrderError("Miqdor musbat bo‘lishi kerak.", field="quantity")
    mv = wh.add_movement(db, material=m, warehouse_id=payload.warehouse_id, kind=payload.kind, quantity=payload.quantity,
                         day=payload.movement_date, user_id=user.id, supplier_id=payload.supplier_id,
                         unit_price=payload.unit_price, document_no=payload.document_no, note=payload.note)
    db.commit()
    return {"id": mv.id}


@router.post("/transfers", status_code=201)
def create_transfer(payload: TransferIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.WAREHOUSE_MANAGE))):
    m = _material(db, payload.material_id)
    _warehouse(db, payload.from_warehouse_id, "from_warehouse_id")
    _warehouse(db, payload.to_warehouse_id, "to_warehouse_id")
    group = wh.transfer(db, material=m, from_id=payload.from_warehouse_id, to_id=payload.to_warehouse_id,
                        quantity=payload.quantity, day=payload.movement_date, user_id=user.id, note=payload.note)
    db.commit()
    return {"transfer_group": group}


@router.delete("/movements/{movement_id}", status_code=204)
def delete_movement(movement_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.WAREHOUSE_MANAGE))):
    mv = _get(db, StockMovement, movement_id, "Harakat")
    group = [mv]
    if mv.transfer_group:
        group = list(db.scalars(select(StockMovement).where(StockMovement.transfer_group == mv.transfer_group)))
    # O'chirgandan keyin qoldiq 0 dan pastga tushmasligi kerak
    delta: dict[tuple[int, int], Decimal] = {}
    for g in group:
        delta[(g.material_id, g.warehouse_id)] = delta.get((g.material_id, g.warehouse_id), Decimal(0)) - g.quantity
    for (mid, wid), d in delta.items():
        if d < 0 and wh.stock_in_warehouse(db, mid, wid) + d < 0:
            raise HTTPException(status_code=409, detail="Bu yozuvni o‘chirib bo‘lmaydi: keyingi harakatlar uni ishlatgan, qoldiq manfiy bo‘lib qoladi.")
    for g in group:
        db.delete(g)
    db.commit()
    return Response(status_code=204)


# --- Inventarizatsiya ------------------------------------------------------

class CountLine(InputModel):
    material_id: int
    counted: Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=3)]


class InventoryIn(InputModel):
    warehouse_id: int
    movement_date: date
    lines: Annotated[list[CountLine], Field(min_length=1, max_length=200)]
    note: Annotated[str | None, Field(default=None, max_length=300)]


@router.get("/stock")
def stock_sheet(warehouse_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.WAREHOUSE_READ))):
    """Tanlangan ombordagi hisobiy qoldiq (inventarizatsiya varag'i)."""
    current = wh.stock_by_material(db, warehouse_id=warehouse_id)
    return [{"material_id": m.id, "sku": m.sku, "name": m.name, "unit": m.unit, "book": _f(current.get(m.id, 0))}
            for m in db.scalars(select(Material).where(Material.is_active.is_(True)).order_by(Material.category, Material.name))]


@router.post("/inventory", status_code=201)
def inventory(payload: InventoryIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.WAREHOUSE_MANAGE))):
    _warehouse(db, payload.warehouse_id)
    adjusted = 0
    for line in payload.lines:
        m = _material(db, line.material_id)
        diff = line.counted - wh.stock_in_warehouse(db, m.id, payload.warehouse_id)
        if diff == 0:
            continue
        wh.add_movement(db, material=m, warehouse_id=payload.warehouse_id, kind="adjust", quantity=diff,
                        day=payload.movement_date, user_id=user.id, note=payload.note or "Inventarizatsiya")
        db.flush()
        adjusted += 1
    db.commit()
    return {"adjusted": adjusted}


# --- Tayyor mahsulot va hisobot -------------------------------------------

@router.get("/finished")
def finished_products(db: Session = Depends(get_db), _: User = Depends(require(Perm.WAREHOUSE_READ))):
    """Tayyor beton saqlanmaydi: markalar bo'yicha ishlab chiqarilgan va yetkazilgan hajm."""
    produced = {
        pid: (total, passed)
        for pid, total, passed in db.execute(
            select(ProductionRecord.product_id,
                   func.coalesce(func.sum(ProductionRecord.produced_volume_m3).filter(ProductionRecord.qc_status != QcStatus.FAILED), 0),
                   func.coalesce(func.sum(ProductionRecord.produced_volume_m3).filter(ProductionRecord.qc_status == QcStatus.PASSED), 0))
            .group_by(ProductionRecord.product_id))
    }
    delivered = dict(db.execute(
        select(OrderItem.product_id, func.coalesce(func.sum(OrderItem.volume_m3), 0))
        .join(Order, Order.id == OrderItem.order_id).where(Order.status == OrderStatus.DELIVERED).group_by(OrderItem.product_id)).all())
    ordered_open = dict(db.execute(
        select(OrderItem.product_id, func.coalesce(func.sum(OrderItem.volume_m3), 0))
        .join(Order, Order.id == OrderItem.order_id).where(Order.status.notin_((OrderStatus.DELIVERED, OrderStatus.CANCELLED)))
        .group_by(OrderItem.product_id)).all())
    rows = []
    for p in db.scalars(select(ConcreteProduct).order_by(ConcreteProduct.sort_order, ConcreteProduct.grade_class)):
        prod, passed = produced.get(p.id, (0, 0))
        if not (prod or delivered.get(p.id) or ordered_open.get(p.id)):
            continue
        rows.append({"product_id": p.id, "name": p.name, "grade_class": p.grade_class, "is_demo": p.is_demo,
                     "produced_m3": _f(prod), "qc_passed_m3": _f(passed), "delivered_m3": _f(delivered.get(p.id)),
                     "open_orders_m3": _f(ordered_open.get(p.id))})
    return {"items": rows}


@router.get("/report")
def report(date_from: date | None = None, date_to: date | None = None, warehouse_id: int | None = None,
           db: Session = Depends(get_db), _: User = Depends(require(Perm.WAREHOUSE_READ))):
    date_from, date_to = _period(date_from, date_to)
    rows = wh.material_rows(db, warehouse_id=warehouse_id, date_from=date_from, date_to=date_to)
    kinds = {}
    for mid, kind, qty in db.execute(
        select(StockMovement.material_id, StockMovement.kind, func.sum(func.abs(StockMovement.quantity)))
        .where(StockMovement.movement_date >= date_from, StockMovement.movement_date <= date_to)
        .group_by(StockMovement.material_id, StockMovement.kind)
    ):
        kinds.setdefault(mid, {})[kind] = _f(qty)
    for r in rows:
        r["by_kind"] = kinds.get(r["id"], {})
    return {"date_from": date_from.isoformat(), "date_to": date_to.isoformat(), "items": rows,
            "consumption": wh.consumption_vs_norm(db, date_from, date_to)}
