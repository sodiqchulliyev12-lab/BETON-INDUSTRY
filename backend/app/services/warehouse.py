"""Ombor hisobi. Qoldiq harakatlar yig'indisidan hisoblanadi — alohida saqlanmaydi, shuning uchun og'ib ketmaydi.

Qoidalar:
- qoldiq hech bir omborda 0 dan pastga tushmaydi (chiqim, ishlab chiqarishga berish, ko'chirish, inventarizatsiya);
- kelajak sanasiga harakat yozib bo'lmaydi;
- xomashyo narxi faqat kirimda ixtiyoriy yoziladi; ombor qiymati narxi ma'lum kirimlardan o'rtacha tortilgan narx bilan hisoblanadi.
"""
import uuid
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import Material, ProductionRecord, StockMovement
from app.models.enums import QcStatus
from app.models.warehouse import NEGATIVE_KINDS, POSITIVE_KINDS
from app.services.orders import OrderError
from app.utils.timezone import today_local

ZERO = Decimal("0")
SKU_PREFIX = {"cement": "CEM", "sand": "SND", "gravel": "GVL", "crushed_stone": "CST", "water": "WTR", "additive": "ADD", "other": "OTH"}


def _f(value) -> float:
    return float(value or 0)


def stock_by_material(db: Session, *, warehouse_id: int | None = None, before: date | None = None,
                      until: date | None = None) -> dict[int, Decimal]:
    q = select(StockMovement.material_id, func.coalesce(func.sum(StockMovement.quantity), 0)).group_by(StockMovement.material_id)
    if warehouse_id:
        q = q.where(StockMovement.warehouse_id == warehouse_id)
    if before:
        q = q.where(StockMovement.movement_date < before)
    if until:
        q = q.where(StockMovement.movement_date <= until)
    return {mid: qty for mid, qty in db.execute(q)}


def stock_in_warehouse(db: Session, material_id: int, warehouse_id: int) -> Decimal:
    return db.scalar(
        select(func.coalesce(func.sum(StockMovement.quantity), 0))
        .where(StockMovement.material_id == material_id, StockMovement.warehouse_id == warehouse_id)
    ) or ZERO


def avg_prices(db: Session) -> dict[int, Decimal]:
    rows = db.execute(
        select(StockMovement.material_id, func.sum(StockMovement.quantity * StockMovement.unit_price), func.sum(StockMovement.quantity))
        .where(StockMovement.kind == "in", StockMovement.unit_price.is_not(None))
        .group_by(StockMovement.material_id)
    )
    return {mid: total / qty for mid, total, qty in rows if qty}


def status_of(material: Material, stock: Decimal) -> str:
    if stock <= 0:
        return "out"
    if material.min_stock is None:
        return "no_limit"
    return "low" if stock < material.min_stock else "ok"


def next_sku(db: Session, category: str) -> str:
    prefix = SKU_PREFIX.get(category, "OTH")
    n = (db.scalar(select(func.count()).select_from(Material).where(Material.sku.like(f"{prefix}-%"))) or 0) + 1
    while db.scalar(select(Material.id).where(Material.sku == f"{prefix}-{n:03d}")):
        n += 1
    return f"{prefix}-{n:03d}"


def add_movement(db: Session, *, material: Material, warehouse_id: int, kind: str, quantity: Decimal, day: date,
                 user_id: int | None, supplier_id: int | None = None, unit_price: Decimal | None = None,
                 transfer_group: str | None = None, document_no: str | None = None, note: str | None = None) -> StockMovement:
    if day > today_local():
        raise OrderError("Kelajak sanasini kiritib bo‘lmaydi.", field="movement_date")
    if kind in POSITIVE_KINDS:
        signed = abs(quantity)
    elif kind in NEGATIVE_KINDS:
        signed = -abs(quantity)
    elif kind == "adjust":
        signed = quantity
    else:
        raise OrderError("Harakat turi noto‘g‘ri.", field="kind")
    if signed == 0:
        raise OrderError("Miqdor 0 bo‘lishi mumkin emas.", field="quantity")
    if signed < 0 and stock_in_warehouse(db, material.id, warehouse_id) + signed < 0:
        raise OrderError(
            f"Omborda yetarli qoldiq yo‘q. Mavjud: {stock_in_warehouse(db, material.id, warehouse_id):g} {material.unit}.",
            field="quantity",
        )
    move = StockMovement(
        material_id=material.id, warehouse_id=warehouse_id, kind=kind, quantity=signed, movement_date=day,
        supplier_id=supplier_id, unit_price=unit_price if kind == "in" else None, transfer_group=transfer_group,
        document_no=document_no, note=note, created_by_id=user_id,
    )
    db.add(move)
    return move


def transfer(db: Session, *, material: Material, from_id: int, to_id: int, quantity: Decimal, day: date,
             user_id: int | None, note: str | None) -> str:
    if from_id == to_id:
        raise OrderError("Qaysi ombordan va qaysi omborga — turli omborlar tanlanishi kerak.", field="to_warehouse_id")
    group = str(uuid.uuid4())
    add_movement(db, material=material, warehouse_id=from_id, kind="transfer_out", quantity=quantity, day=day,
                 user_id=user_id, transfer_group=group, note=note)
    db.flush()
    add_movement(db, material=material, warehouse_id=to_id, kind="transfer_in", quantity=quantity, day=day,
                 user_id=user_id, transfer_group=group, note=note)
    return group


def material_rows(db: Session, *, warehouse_id: int | None, date_from: date | None, date_to: date | None,
                  category: str | None = None) -> list[dict]:
    """Har bir material uchun: boshlang'ich qoldiq, kirim, chiqim, joriy qoldiq (tanlangan davr bo'yicha)."""
    q = select(Material).order_by(Material.category, Material.name)
    if category:
        q = q.where(Material.category == category)
    materials = list(db.scalars(q))
    current = stock_by_material(db, warehouse_id=warehouse_id, until=date_to)
    initial = stock_by_material(db, warehouse_id=warehouse_id, before=date_from) if date_from else {}
    flows: dict[int, list[Decimal]] = defaultdict(lambda: [ZERO, ZERO])
    fq = select(
        StockMovement.material_id,
        func.coalesce(func.sum(case((StockMovement.quantity > 0, StockMovement.quantity), else_=0)), 0),
        func.coalesce(func.sum(case((StockMovement.quantity < 0, -StockMovement.quantity), else_=0)), 0),
    ).group_by(StockMovement.material_id)
    if warehouse_id:
        fq = fq.where(StockMovement.warehouse_id == warehouse_id)
    if date_from:
        fq = fq.where(StockMovement.movement_date >= date_from)
    if date_to:
        fq = fq.where(StockMovement.movement_date <= date_to)
    for mid, inc, out in db.execute(fq):
        flows[mid] = [inc, out]
    full = stock_by_material(db)  # holat (kam qoldiq) barcha omborlar bo'yicha
    prices = avg_prices(db)
    rows = []
    for m in materials:
        stock = current.get(m.id, ZERO)
        total_stock = full.get(m.id, ZERO)
        rows.append({
            "id": m.id, "sku": m.sku, "name": m.name, "category": m.category, "unit": m.unit,
            "min_stock": _f(m.min_stock) if m.min_stock is not None else None,
            "norm_per_m3": _f(m.norm_per_m3) if m.norm_per_m3 is not None else None,
            "is_active": m.is_active, "notes": m.notes,
            "initial": _f(initial.get(m.id, ZERO)) if date_from else None,
            "incoming": _f(flows[m.id][0]), "outgoing": _f(flows[m.id][1]),
            "stock": _f(stock), "stock_total": _f(total_stock),
            "status": status_of(m, total_stock) if m.is_active else "inactive",
            "avg_price": _f(prices[m.id]) if m.id in prices else None,
        })
    return rows


def consumption_vs_norm(db: Session, date_from: date, date_to: date) -> list[dict]:
    """Ishlab chiqarishga berilgan xomashyo va me'yor bo'yicha kutilgan sarf (faqat me'yori kiritilgan materiallar)."""
    produced = db.scalar(
        select(func.coalesce(func.sum(ProductionRecord.produced_volume_m3), 0))
        .where(func.date(ProductionRecord.produced_at) >= date_from, func.date(ProductionRecord.produced_at) <= date_to,
               ProductionRecord.qc_status != QcStatus.FAILED)
    ) or ZERO
    used = dict(db.execute(
        select(StockMovement.material_id, func.coalesce(func.sum(-StockMovement.quantity), 0))
        .where(StockMovement.kind == "production", StockMovement.movement_date >= date_from, StockMovement.movement_date <= date_to)
        .group_by(StockMovement.material_id)
    ).all())
    rows = []
    for m in db.scalars(select(Material).where(Material.is_active.is_(True)).order_by(Material.category, Material.name)):
        actual = used.get(m.id, ZERO)
        norm = m.norm_per_m3
        expected = produced * norm if norm is not None and produced else None
        diff_pct = round(float((actual - expected) / expected * 100), 2) if expected else None
        if actual or expected:
            rows.append({"material_id": m.id, "name": m.name, "unit": m.unit, "norm_per_m3": _f(norm) if norm is not None else None,
                         "expected": _f(expected) if expected is not None else None, "actual": _f(actual), "diff_pct": diff_pct})
    return rows
