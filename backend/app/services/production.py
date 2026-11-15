"""Ishlab chiqarish: reja, haqiqiy ishlab chiqarilgan hajm, sifat nazorati va kunlik xulosa.

Zavod quvvati system_settings'dan olinadi. Belgilanmagan bo'lsa (NULL) — foydalanish foizi ham
hisoblanmaydi va hech qanday taxminiy qiymat qaytarilmaydi.
"""
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.models import (
    ConcreteProduct, Customer, Driver, Material, Order, OrderItem, OrderTrip, ProductionPlan, ProductionRecord, StockMovement,
    SystemSetting, User, Vehicle, Warehouse,
)
from app.models.enums import OrderStatus, PlanStatus, QcStatus, TripStatus
from app.schemas.admin_production import (
    PlanIn, PlanOut, ProductDaySummary, ProductionSummary, QcIn, RecordIn, RecordOut,
)
from app.services.orders import OrderError
from app.utils.timezone import local_tz

ZERO = Decimal("0")


class NotFound(Exception):
    pass


def _day_range(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=local_tz())
    return start, start + timedelta(days=1)


def _product(db: Session, product_id: int | None) -> ConcreteProduct:
    product = db.get(ConcreteProduct, product_id) if product_id else None
    if product is None:
        raise OrderError("Beton markasini tanlang.", field="product_id")
    return product


def _order(db: Session, order_id: int | None) -> Order | None:
    if order_id is None:
        return None
    order = db.get(Order, order_id)
    if order is None:
        raise OrderError("Buyurtma topilmadi.", field="order_id")
    if order.status == OrderStatus.CANCELLED:
        raise OrderError("Bekor qilingan buyurtma uchun ishlab chiqarib bo‘lmaydi.", field="order_id")
    return order


def capacity(db: Session) -> Decimal | None:
    value = db.scalar(select(SystemSetting.value).where(SystemSetting.key == "production.capacity_m3_per_day"))
    if value in (None, ""):
        return None
    try:
        number = Decimal(str(value))
    except Exception:
        return None
    return number if number > 0 else None


# --- Rejalar ---------------------------------------------------------------

def list_plans(db: Session, date_from: date, date_to: date) -> list[PlanOut]:
    creator = aliased(User)
    produced = (
        select(ProductionRecord.plan_id, func.sum(ProductionRecord.produced_volume_m3).label("produced"))
        .where(ProductionRecord.plan_id.is_not(None), ProductionRecord.qc_status != QcStatus.FAILED)
        .group_by(ProductionRecord.plan_id)
        .subquery()
    )
    rows = db.execute(
        select(ProductionPlan, ConcreteProduct.grade_class, ConcreteProduct.name, Order.order_number, creator.full_name, produced.c.produced)
        .join(ConcreteProduct, ConcreteProduct.id == ProductionPlan.product_id)
        .outerjoin(Order, Order.id == ProductionPlan.order_id)
        .outerjoin(creator, creator.id == ProductionPlan.created_by_id)
        .outerjoin(produced, produced.c.plan_id == ProductionPlan.id)
        .where(ProductionPlan.plan_date.between(date_from, date_to))
        .order_by(ProductionPlan.plan_date, ProductionPlan.id)
    ).all()
    return [
        PlanOut(
            id=p.id, plan_date=p.plan_date, product_id=p.product_id, grade_class=grade, product_name=name,
            order_id=p.order_id, order_number=number, planned_volume_m3=p.planned_volume_m3,
            produced_volume_m3=done or ZERO, status=p.status, notes=p.notes, created_by=author, created_at=p.created_at,
        )
        for p, grade, name, number, author, done in rows
    ]


def get_plan(db: Session, plan_id: int) -> ProductionPlan:
    plan = db.get(ProductionPlan, plan_id)
    if plan is None:
        raise NotFound
    return plan


def save_plan(db: Session, data: PlanIn, user: User, plan: ProductionPlan | None = None) -> ProductionPlan:
    _product(db, data.product_id)
    order = _order(db, data.order_id)
    if order and data.product_id not in {i.product_id for i in order.items}:
        raise OrderError("Bu buyurtmada tanlangan beton markasi yo‘q.", field="product_id")
    if plan is None:
        plan = ProductionPlan(created_by_id=user.id)
        db.add(plan)
    plan.plan_date = data.plan_date
    plan.product_id = data.product_id
    plan.order_id = data.order_id
    plan.planned_volume_m3 = data.planned_volume_m3
    plan.status = data.status
    plan.notes = data.notes
    db.commit()
    db.refresh(plan)
    return plan


def delete_plan(db: Session, plan: ProductionPlan) -> None:
    if db.scalar(select(func.count()).select_from(ProductionRecord).where(ProductionRecord.plan_id == plan.id)):
        raise OrderError("Rejaga ishlab chiqarish yozuvlari bog‘langan. O‘chirish o‘rniga «Bekor qilindi» holatiga o‘tkazing.")
    db.delete(plan)
    db.commit()


# --- Ishlab chiqarish yozuvlari va sifat nazorati -------------------------

def list_records(db: Session, day: date) -> list[RecordOut]:
    start, end = _day_range(day)
    creator, inspector = aliased(User), aliased(User)
    rows = db.execute(
        select(ProductionRecord, ConcreteProduct.grade_class, ConcreteProduct.name, Order.order_number, creator.full_name, inspector.full_name)
        .join(ConcreteProduct, ConcreteProduct.id == ProductionRecord.product_id)
        .outerjoin(Order, Order.id == ProductionRecord.order_id)
        .outerjoin(creator, creator.id == ProductionRecord.created_by_id)
        .outerjoin(inspector, inspector.id == ProductionRecord.qc_by_id)
        .where(ProductionRecord.produced_at >= start, ProductionRecord.produced_at < end)
        .order_by(ProductionRecord.produced_at.desc())
    ).all()
    customers = {c.id: (c.company_name or c.full_name) for c in db.scalars(select(Customer).where(Customer.id.in_({r.customer_id for r, *_ in rows if r.customer_id})))} if rows else {}
    plates = dict(db.execute(select(Vehicle.id, Vehicle.plate_number).where(Vehicle.id.in_({r.vehicle_id for r, *_ in rows if r.vehicle_id}))).all()) if rows else {}
    return [
        RecordOut(
            id=r.id, plan_id=r.plan_id, order_id=r.order_id, order_number=number, product_id=r.product_id,
            grade_class=grade, product_name=name, batch_number=r.batch_number, produced_volume_m3=r.produced_volume_m3,
            customer_id=r.customer_id, customer_name=customers.get(r.customer_id), vehicle_id=r.vehicle_id,
            plate_number=plates.get(r.vehicle_id), waybill_no=r.waybill_no,
            produced_at=r.produced_at, qc_status=r.qc_status, qc_notes=r.qc_notes, qc_by=qc_name, qc_at=r.qc_at,
            created_by=author,
        )
        for r, grade, name, number, author, qc_name in rows
    ]


def get_record(db: Session, record_id: int) -> ProductionRecord:
    record = db.get(ProductionRecord, record_id)
    if record is None:
        raise NotFound
    return record


def create_record(db: Session, data: RecordIn, user: User) -> ProductionRecord:
    plan = get_plan(db, data.plan_id) if data.plan_id else None
    if plan and plan.status == PlanStatus.CANCELLED:
        raise OrderError("Bekor qilingan reja bo‘yicha yozuv qo‘shib bo‘lmaydi.", field="plan_id")
    product_id = plan.product_id if plan else data.product_id
    _product(db, product_id)
    order_id = data.order_id if data.order_id is not None else (plan.order_id if plan else None)
    order = _order(db, order_id)
    customer_id = order.customer_id if order else data.customer_id
    if customer_id is not None and db.get(Customer, customer_id) is None:
        raise OrderError("Mijoz topilmadi.", field="customer_id")
    if data.vehicle_id is not None:
        veh = db.get(Vehicle, data.vehicle_id)
        if veh is None or veh.kind != "mixer":
            raise OrderError("Tashuvchi mikserni ro‘yxatdan tanlang.", field="vehicle_id")
    produced_at = data.produced_at or datetime.now(UTC)
    if produced_at.tzinfo is None:
        produced_at = produced_at.replace(tzinfo=local_tz())
    if produced_at > datetime.now(UTC) + timedelta(minutes=5):
        raise OrderError("Kelajakdagi vaqtni kiritib bo‘lmaydi.", field="produced_at")

    record = ProductionRecord(
        plan_id=plan.id if plan else None,
        order_id=order_id,
        product_id=product_id,
        batch_number=data.batch_number,
        customer_id=customer_id,
        vehicle_id=data.vehicle_id,
        produced_volume_m3=data.produced_volume_m3,
        produced_at=produced_at,
        created_by_id=user.id,
    )
    db.add(record)
    db.flush()
    record.waybill_no = f"NK-{produced_at.astimezone(local_tz()).year}-{record.id:05d}"
    consume_materials(db, record, user)
    if plan and plan.status == PlanStatus.PLANNED:
        plan.status = PlanStatus.IN_PROGRESS
    db.commit()
    db.refresh(record)
    return record


def consume_materials(db: Session, record: ProductionRecord, user: User) -> None:
    """Ishlab chiqarildi kiritilsa — me'yori (1 m³ ga) belgilangan xomashyolar ombordan avtomat chiqim qilinadi.

    Me'yori kiritilmagan material tegilmaydi (tizim taxmin qilmaydi). Yozuv o'chirilsa, chiqim ham qaytariladi.
    """
    warehouse = db.scalar(select(Warehouse).where(Warehouse.is_active.is_(True)).order_by(Warehouse.id))
    if warehouse is None:
        return
    day = record.produced_at.astimezone(local_tz()).date()
    materials = db.scalars(select(Material).where(Material.is_active.is_(True), Material.norm_per_m3.is_not(None), Material.norm_per_m3 > 0))
    for m in materials:
        qty = (m.norm_per_m3 * record.produced_volume_m3).quantize(Decimal("0.001"))
        if qty <= 0:
            continue
        db.add(StockMovement(
            material_id=m.id, warehouse_id=warehouse.id, kind="production", quantity=-qty, movement_date=day,
            document_no=record.waybill_no, note=f"Ishlab chiqarish: {record.produced_volume_m3} m³ (me'yor bo'yicha avtomat)",
            created_by_id=user.id, production_record_id=record.id,
        ))


def waybill(db: Session, record: ProductionRecord) -> dict:
    """Nakladnoy (yuk xati): ishlab chiqarish yozuvidagi ma'lumotlar bo'yicha avtomat to'ldiriladi. Narx ko'rsatilmaydi."""
    if not record.waybill_no:
        record.waybill_no = f"NK-{record.produced_at.astimezone(local_tz()).year}-{record.id:05d}"
        db.commit()
    product = db.get(ConcreteProduct, record.product_id)
    order = db.get(Order, record.order_id) if record.order_id else None
    customer = db.get(Customer, record.customer_id) if record.customer_id else None
    vehicle = db.get(Vehicle, record.vehicle_id) if record.vehicle_id else None
    driver_name = None
    if vehicle is not None:
        trip_driver = None
        if order is not None:
            trip_driver = db.scalar(select(OrderTrip.driver_id).where(OrderTrip.order_id == order.id, OrderTrip.vehicle_id == vehicle.id, OrderTrip.driver_id.is_not(None)).limit(1))
        driver = db.get(Driver, trip_driver or vehicle.default_driver_id) if (trip_driver or vehicle.default_driver_id) else None
        driver_name = driver.full_name if driver else None
    used = db.execute(
        select(Material.name, Material.unit, func.sum(-StockMovement.quantity))
        .join(Material, Material.id == StockMovement.material_id)
        .where(StockMovement.production_record_id == record.id).group_by(Material.name, Material.unit).order_by(Material.name)
    ).all()
    produced_local = record.produced_at.astimezone(local_tz())
    return {
        "number": record.waybill_no, "date": produced_local.date().isoformat(), "time": produced_local.strftime("%H:%M"),
        "customer": (customer.company_name or customer.full_name) if customer else None, "customer_phone": customer.phone if customer else None,
        "order_number": order.order_number if order else None,
        "address": order.delivery_address if order and order.delivery_required else None,
        "product": product.name, "grade": product.grade_class, "volume_m3": float(record.produced_volume_m3), "batch_number": record.batch_number,
        "vehicle": vehicle.plate_number if vehicle else None, "vehicle_type": vehicle.vehicle_type if vehicle else None, "driver": driver_name,
        "qc_status": record.qc_status.value if hasattr(record.qc_status, "value") else str(record.qc_status),
        "materials": [{"name": n, "unit": u, "quantity": float(q)} for n, u, q in used],
    }


def set_qc(db: Session, record: ProductionRecord, data: QcIn, user: User) -> ProductionRecord:
    if data.qc_status == QcStatus.FAILED and not data.qc_notes:
        raise OrderError("Sifat nazoratidan o‘tmagan bo‘lsa, sababini yozing.", field="qc_notes")
    record.qc_status = data.qc_status
    record.qc_notes = data.qc_notes
    if data.qc_status == QcStatus.PENDING:
        record.qc_by_id, record.qc_at = None, None
    else:
        record.qc_by_id, record.qc_at = user.id, datetime.now(UTC)
    db.commit()
    db.refresh(record)
    return record


def delete_record(db: Session, record: ProductionRecord) -> None:
    if record.qc_status != QcStatus.PENDING:
        raise OrderError("Sifat nazoratidan o‘tgan yozuvni o‘chirib bo‘lmaydi.")
    db.delete(record)
    db.commit()


# --- Kunlik xulosa ---------------------------------------------------------

def summary(db: Session, day: date) -> ProductionSummary:
    start, end = _day_range(day)
    cap = capacity(db)

    planned_rows = db.execute(
        select(ConcreteProduct.grade_class, ConcreteProduct.name, func.sum(ProductionPlan.planned_volume_m3))
        .join(ConcreteProduct, ConcreteProduct.id == ProductionPlan.product_id)
        .where(ProductionPlan.plan_date == day, ProductionPlan.status != PlanStatus.CANCELLED)
        .group_by(ConcreteProduct.grade_class, ConcreteProduct.name)
    ).all()
    produced_rows = db.execute(
        select(ConcreteProduct.grade_class, ConcreteProduct.name, ProductionRecord.qc_status, func.sum(ProductionRecord.produced_volume_m3))
        .join(ConcreteProduct, ConcreteProduct.id == ProductionRecord.product_id)
        .where(ProductionRecord.produced_at >= start, ProductionRecord.produced_at < end)
        .group_by(ConcreteProduct.grade_class, ConcreteProduct.name, ProductionRecord.qc_status)
    ).all()

    by_product: dict[tuple[str, str], dict[str, Decimal]] = {}
    for grade, name, volume in planned_rows:
        by_product.setdefault((grade, name), {"planned": ZERO, "produced": ZERO})["planned"] += volume
    qc = {s: ZERO for s in QcStatus}
    for grade, name, status, volume in produced_rows:
        qc[status] += volume
        if status != QcStatus.FAILED:
            by_product.setdefault((grade, name), {"planned": ZERO, "produced": ZERO})["produced"] += volume

    planned = sum((v["planned"] for v in by_product.values()), ZERO)
    loaded = db.scalar(
        select(func.coalesce(func.sum(OrderTrip.volume_m3), 0))
        .where(OrderTrip.loaded_at >= start, OrderTrip.loaded_at < end, OrderTrip.status != TripStatus.CANCELLED)
    ) or ZERO
    delivered = db.scalar(
        select(func.coalesce(func.sum(OrderTrip.volume_m3), 0))
        .where(OrderTrip.delivered_at >= start, OrderTrip.delivered_at < end, OrderTrip.status == TripStatus.DELIVERED)
    ) or ZERO

    # Ochiq buyurtmalar bo'yicha qolgan hajm: buyurtma hajmi − yetkazilgan qatnovlar
    open_statuses = [s for s in OrderStatus if s not in (OrderStatus.CANCELLED, OrderStatus.DELIVERED)]
    ordered_sq = (
        select(OrderItem.order_id, func.sum(OrderItem.volume_m3).label("ordered"))
        .group_by(OrderItem.order_id).subquery()
    )
    delivered_sq = (
        select(OrderTrip.order_id, func.sum(OrderTrip.volume_m3).label("delivered"))
        .where(OrderTrip.status == TripStatus.DELIVERED)
        .group_by(OrderTrip.order_id).subquery()
    )
    open_rows = db.execute(
        select(ordered_sq.c.ordered, func.coalesce(delivered_sq.c.delivered, 0))
        .select_from(Order)
        .join(ordered_sq, ordered_sq.c.order_id == Order.id)
        .outerjoin(delivered_sq, delivered_sq.c.order_id == Order.id)
        .where(Order.status.in_(open_statuses))
    ).all()
    remaining = sum((max(o - d, ZERO) for o, d in open_rows), ZERO)

    return ProductionSummary(
        date=day,
        capacity_m3_per_day=cap,
        planned_m3=planned,
        utilization_percent=(planned / cap * 100).quantize(Decimal("0.1")) if cap else None,
        produced_m3=qc[QcStatus.PASSED] + qc[QcStatus.PENDING],
        qc_passed_m3=qc[QcStatus.PASSED],
        qc_failed_m3=qc[QcStatus.FAILED],
        qc_pending_m3=qc[QcStatus.PENDING],
        loaded_m3=loaded,
        delivered_m3=delivered,
        open_orders=len(open_rows),
        open_orders_remaining_m3=remaining,
        by_product=[
            ProductDaySummary(grade_class=g, product_name=n, planned_m3=v["planned"], produced_m3=v["produced"])
            for (g, n), v in sorted(by_product.items())
        ],
    )
