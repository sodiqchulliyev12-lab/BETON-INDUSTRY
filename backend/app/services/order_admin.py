"""Admin panel: buyurtmalarni ko'rish, tahrirlash va holatini o'zgartirish."""
from datetime import date
from decimal import Decimal

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models import Customer, Order, OrderItem, OrderStatusHistory, SystemSetting, User
from app.models.enums import DeliveryPriceStatus, OrderStatus, UserRole
from app.permissions import can_set_status
from app.schemas.admin_orders import (
    CustomerShort,
    OrderDetail,
    OrderItemOut,
    OrderItemUpdate,
    OrderListItem,
    OrderUpdate,
    StatusChange,
    StatusHistoryOut,
)
from app.schemas.common import Page, like_pattern
from app.services.orders import OrderError
from app.services.pricing import money
from app.utils.geo import haversine_km, round_coord

S = OrderStatus

# Holatlar zanjiri. Sifat nazoratidan o'tmasa ishlab chiqarishga qaytarish mumkin.
TRANSITIONS: dict[OrderStatus, tuple[OrderStatus, ...]] = {
    S.NEW: (S.CONFIRMED, S.CANCELLED),
    S.CONFIRMED: (S.SCHEDULED, S.IN_PRODUCTION, S.CANCELLED),
    S.SCHEDULED: (S.IN_PRODUCTION, S.CANCELLED),
    S.IN_PRODUCTION: (S.QUALITY_CHECK, S.CANCELLED),
    S.QUALITY_CHECK: (S.LOADED, S.IN_PRODUCTION, S.CANCELLED),
    S.LOADED: (S.IN_TRANSIT, S.DELIVERED, S.CANCELLED),
    S.IN_TRANSIT: (S.DELIVERED,),
    S.DELIVERED: (),
    S.CANCELLED: (S.NEW,),  # xato bilan bekor qilinganini qayta ochish
}


class NotFound(Exception):
    pass


# --- Ro'yxat ---------------------------------------------------------------

def _filtered(
    stmt: Select,
    status: OrderStatus | None,
    q: str | None,
    date_from: date | None,
    date_to: date | None,
) -> Select:
    if status:
        stmt = stmt.where(Order.status == status)
    if date_from:
        stmt = stmt.where(Order.delivery_date >= date_from)
    if date_to:
        stmt = stmt.where(Order.delivery_date <= date_to)
    if q and q.strip():
        term = q.strip()
        digits = "".join(ch for ch in term if ch.isdigit())
        conditions = [
            Order.order_number.ilike(like_pattern(term)),
            Customer.full_name.ilike(like_pattern(term)),
        ]
        if len(digits) >= 3:
            conditions.append(Customer.phone.like(like_pattern(digits)))
        stmt = stmt.where(or_(*conditions))
    return stmt


def list_orders(
    db: Session,
    *,
    status: OrderStatus | None = None,
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    customer_id: int | None = None,
    open_only: bool = False,
    page: int = 1,
    page_size: int = 20,
) -> Page[OrderListItem]:
    base = select(Order).join(Customer, Customer.id == Order.customer_id)
    if customer_id:
        base = base.where(Order.customer_id == customer_id)
    if open_only:
        base = base.where(Order.status.notin_((S.DELIVERED, S.CANCELLED)))
    base = _filtered(base, status, q, date_from, date_to)

    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    orders = db.scalars(
        base.options(selectinload(Order.items), selectinload(Order.customer))
        .order_by(Order.created_at.desc(), Order.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    items = [
        OrderListItem(
            id=o.id,
            order_number=o.order_number,
            status=o.status,
            created_at=o.created_at,
            customer_id=o.customer_id,
            customer_name=o.customer.full_name,
            customer_phone=o.customer.phone,
            products=", ".join(dict.fromkeys(i.grade_class for i in o.items)),
            volume_m3=sum((i.volume_m3 for i in o.items), Decimal("0")),
            delivery_required=o.delivery_required,
            delivery_date=o.delivery_date,
            delivery_time=o.delivery_time,
            concrete_total=o.concrete_total,
            delivery_price_status=o.delivery_price_status,
            grand_total=o.grand_total,
            currency=o.currency,
        )
        for o in orders
    ]
    return Page(items=items, total=total, page=page, page_size=page_size)


# --- Tafsilot --------------------------------------------------------------

def get_order(db: Session, order_id: int) -> Order:
    order = db.scalar(
        select(Order)
        .where(Order.id == order_id)
        .options(selectinload(Order.items), selectinload(Order.status_history), selectinload(Order.customer))
    )
    if order is None:
        raise NotFound
    return order


def allowed_statuses(order: Order, role: UserRole) -> list[OrderStatus]:
    return [s for s in TRANSITIONS[order.status] if can_set_status(role, s)]


def factory_location(db: Session) -> tuple[float, float] | None:
    """Zavod koordinatalari sozlamalardan. Kiritilmagan bo'lsa None (taxmin qilinmaydi)."""
    rows = dict(db.execute(
        select(SystemSetting.key, SystemSetting.value)
        .where(SystemSetting.key.in_(("company.latitude", "company.longitude")))
    ).all())
    try:
        lat, lon = float(rows["company.latitude"]), float(rows["company.longitude"])
    except (KeyError, TypeError, ValueError):
        return None
    return lat, lon


def order_detail(db: Session, order: Order, role: UserRole) -> OrderDetail:
    factory = factory_location(db)
    user_ids = {h.changed_by_id for h in order.status_history if h.changed_by_id}
    names = dict(db.execute(select(User.id, User.full_name).where(User.id.in_(user_ids))).all()) if user_ids else {}
    return OrderDetail(
        id=order.id,
        order_number=order.order_number,
        status=order.status,
        source=order.source,
        created_at=order.created_at,
        updated_at=order.updated_at,
        customer=CustomerShort.model_validate(order.customer),
        delivery_required=order.delivery_required,
        delivery_address=order.delivery_address,
        delivery_date=order.delivery_date,
        delivery_time=order.delivery_time,
        comment=order.comment,
        concrete_total=order.concrete_total,
        delivery_price=order.delivery_price,
        delivery_price_status=order.delivery_price_status,
        grand_total=order.grand_total,
        currency=order.currency,
        cancel_reason=order.cancel_reason,
        delivery_lat=float(order.delivery_lat) if order.delivery_lat is not None else None,
        delivery_lon=float(order.delivery_lon) if order.delivery_lon is not None else None,
        factory_lat=factory[0] if factory else None,
        factory_lon=factory[1] if factory else None,
        distance_km=(
            round(haversine_km(factory[0], factory[1], float(order.delivery_lat), float(order.delivery_lon)), 1)
            if factory and order.delivery_lat is not None else None
        ),
        items=[OrderItemOut.model_validate(i) for i in order.items],
        history=[
            StatusHistoryOut(
                id=h.id,
                from_status=h.from_status,
                to_status=h.to_status,
                note=h.note,
                changed_by=names.get(h.changed_by_id) if h.changed_by_id else None,
                created_at=h.created_at,
            )
            for h in order.status_history
        ],
        allowed_statuses=allowed_statuses(order, role),
    )


# --- Summalarni qayta hisoblash ---------------------------------------------

def recalculate_totals(order: Order) -> None:
    """Narx qoidalari (services/pricing.py bilan bir xil):
    - bitta qatorning narxi noma'lum bo'lsa, beton qiymati ham noma'lum (NULL)
    - yetkazib berish narxi tasdiqlanmagan bo'lsa, umumiy summa NULL (0 deb olinmaydi)
    """
    for item in order.items:
        item.line_total = money(item.volume_m3 * item.unit_price) if item.unit_price is not None else None

    lines = [i.line_total for i in order.items]
    order.concrete_total = sum(lines, Decimal("0")) if lines and all(v is not None for v in lines) else None

    if order.concrete_total is None or order.delivery_price_status == DeliveryPriceStatus.PENDING:
        order.grand_total = None
    else:
        order.grand_total = order.concrete_total + (order.delivery_price or Decimal("0"))


# --- Tahrirlash ------------------------------------------------------------

_LOCKED = (S.DELIVERED, S.CANCELLED)


def update_order(db: Session, order: Order, data: OrderUpdate) -> Order:
    if order.status in _LOCKED:
        raise OrderError("Yakunlangan yoki bekor qilingan buyurtmani tahrirlab bo‘lmaydi.")
    fields = data.model_fields_set

    if "delivery_price" in fields:
        if not order.delivery_required:
            raise OrderError("Bu buyurtmada yetkazib berish yo‘q.", field="delivery_price")
        order.delivery_price = data.delivery_price
        order.delivery_price_status = (
            DeliveryPriceStatus.PENDING if data.delivery_price is None else DeliveryPriceStatus.CONFIRMED
        )
    if "delivery_address" in fields:
        if order.delivery_required and not data.delivery_address:
            raise OrderError("Yetkazib berish manzilini kiriting.", field="delivery_address")
        order.delivery_address = data.delivery_address
    if "delivery_date" in fields:
        if data.delivery_date is None:
            raise OrderError("Sanani kiriting.", field="delivery_date")
        order.delivery_date = data.delivery_date
    if "delivery_time" in fields:
        order.delivery_time = data.delivery_time
    if "comment" in fields:
        order.comment = data.comment
    if "delivery_lat" in fields or "delivery_lon" in fields:
        lat, lon = data.delivery_lat, data.delivery_lon
        if (lat is None) != (lon is None):
            raise OrderError("Nuqtaning ikkala koordinatasi ham kerak.", field="delivery_lat")
        if lat is not None and not order.delivery_required:
            raise OrderError("Bu buyurtmada yetkazib berish yo‘q.", field="delivery_lat")
        order.delivery_lat = round_coord(lat) if lat is not None else None
        order.delivery_lon = round_coord(lon) if lon is not None else None

    recalculate_totals(order)
    db.commit()
    return order


def update_item(db: Session, order: Order, item_id: int, data: OrderItemUpdate) -> Order:
    if order.status in _LOCKED:
        raise OrderError("Yakunlangan yoki bekor qilingan buyurtmani tahrirlab bo‘lmaydi.")
    item: OrderItem | None = next((i for i in order.items if i.id == item_id), None)
    if item is None:
        raise NotFound
    fields = data.model_fields_set
    if "unit_price" in fields:
        item.unit_price = data.unit_price
    if "volume_m3" in fields:
        if data.volume_m3 is None:
            raise OrderError("Hajmni kiriting.", field="volume_m3")
        item.volume_m3 = data.volume_m3
    recalculate_totals(order)
    db.commit()
    return order


def change_status(db: Session, order: Order, data: StatusChange, user: User) -> Order:
    target = data.status
    if target == order.status:
        raise OrderError("Buyurtma allaqachon shu holatda.", field="status")
    if target not in TRANSITIONS[order.status]:
        raise OrderError("Bu holatga to‘g‘ridan-to‘g‘ri o‘tkazib bo‘lmaydi.", field="status")
    if not can_set_status(user.role, target):
        raise OrderError("Bu holatga o‘tkazish uchun ruxsatingiz yo‘q.", field="status")

    if target == S.CONFIRMED:
        if order.concrete_total is None:
            raise OrderError("Avval beton narxini kiriting — summa aniqlanmagan.", field="status")
        if order.delivery_price_status == DeliveryPriceStatus.PENDING:
            raise OrderError("Avval yetkazib berish narxini tasdiqlang.", field="status")
    if target == S.CANCELLED:
        if not data.cancel_reason:
            raise OrderError("Bekor qilish sababini yozing.", field="cancel_reason")
        order.cancel_reason = data.cancel_reason
    if target == S.NEW:
        order.cancel_reason = None

    order.status_history.append(
        OrderStatusHistory(from_status=order.status, to_status=target, changed_by_id=user.id, note=data.note)
    )
    order.status = target
    db.commit()
    return order
