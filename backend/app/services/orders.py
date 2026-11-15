"""Buyurtmalar bilan ishlash."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ConcreteProduct, Order, OrderItem, OrderStatusHistory
from app.models.enums import OrderSource, OrderStatus
from app.schemas.order import OrderCreate
from app.services import pricing
from app.services.customers import get_or_create_customer
from app.services.numbering import next_order_number
from app.utils.geo import round_coord


class OrderError(Exception):
    """Biznes qoidasi buzilganda (masalan, marka sotuvda yo'q). field — xato tegishli maydon."""

    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.message = message
        self.field = field


def create_public_order(db: Session, data: OrderCreate) -> Order:
    return create_order(db, data, source=OrderSource.WEBSITE, note="Saytdan yaratildi")


def create_order(
    db: Session, data, *, source: OrderSource, note: str, manager_id: int | None = None, changed_by_id: int | None = None,
) -> Order:
    """Saytdan kelgan buyurtmani bitta tranzaksiyada yaratadi.

    1. Marka faol va sotuvda ekanini tekshiradi (narx bazadan olinadi, frontenddan emas).
    2. Mijozni telefon bo'yicha topadi yoki yaratadi.
    3. Unikal raqam beradi, narxni buyurtma paytidagi holatida saqlaydi.
    4. Holatlar tarixiga birinchi yozuvni qo'shadi.
    """
    product = db.scalar(
        select(ConcreteProduct).where(ConcreteProduct.id == data.product_id).with_for_update(read=True)
    )
    from types import SimpleNamespace
    if product is None or not product.is_active:
        raise OrderError("Tanlangan beton markasi topilmadi.", field="product_id")
    if not product.is_available:
        raise OrderError("Bu beton markasi hozir sotuvda yo‘q.", field="product_id")

    if source == OrderSource.ADMIN:
        # admin kiritgan narx shu buyurtmaga xos (katalog narxi hammaga bir xil emas); kiritilmasa — ochiq
        price = SimpleNamespace(price_per_m3=data.unit_price, currency="UZS") if data.unit_price is not None else None
        estimate = pricing.calculate(data.volume_m3, price, data.delivery_required, getattr(data, "delivery_price", None))
    else:
        price = pricing.current_price(db, product.id)
        estimate = pricing.calculate(data.volume_m3, price, data.delivery_required)

    customer = get_or_create_customer(db, data.phone, data.customer_name)

    order = Order(
        order_number=next_order_number(db),
        customer_id=customer.id,
        status=OrderStatus.NEW,
        source=source,
        manager_id=manager_id,
        delivery_required=data.delivery_required,
        delivery_address=data.delivery_address,
        delivery_lat=round_coord(data.delivery_lat) if data.delivery_lon is not None else None,
        delivery_lon=round_coord(data.delivery_lon) if data.delivery_lon is not None else None,
        delivery_date=data.delivery_date,
        delivery_time=data.delivery_time,
        comment=data.comment,
        concrete_total=estimate.concrete_total,
        delivery_price=estimate.delivery_price,
        delivery_price_status=estimate.delivery_price_status,
        grand_total=estimate.grand_total,
        currency=estimate.currency,
    )
    order.items.append(
        OrderItem(
            product_id=product.id,
            product_name=product.name,
            grade_class=product.grade_class,
            volume_m3=data.volume_m3,
            unit_price=estimate.unit_price,
            line_total=estimate.concrete_total,
        )
    )
    order.status_history.append(
        OrderStatusHistory(from_status=None, to_status=OrderStatus.NEW, note=note, changed_by_id=changed_by_id)
    )

    db.add(order)
    db.commit()
    db.refresh(order)
    return order
