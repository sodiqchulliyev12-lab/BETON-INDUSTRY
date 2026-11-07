from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require
from app.models import Customer, Order, OrderItem, User
from app.models.enums import OrderStatus
from app.permissions import Perm
from app.schemas.admin_people import CustomerDetail, CustomerIn, CustomerListItem
from app.schemas.common import Page, like_pattern

router = APIRouter(prefix="/customers", tags=["Admin: mijozlar"])

_DUPLICATE = HTTPException(
    status_code=status.HTTP_409_CONFLICT,
    detail=[{"loc": ["body", "phone"], "msg": "Bu telefon raqamli mijoz allaqachon mavjud.", "type": "duplicate"}],
)


@router.get("", response_model=Page[CustomerListItem])
def list_customers(
    db: Session = Depends(get_db),
    _: User = Depends(require(Perm.CUSTOMERS_READ)),
    q: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    # Buyurtmalar soni va hajmi (bekor qilinganlarsiz) — alohida subquery
    stats = (
        select(
            Order.customer_id.label("customer_id"),
            func.count(func.distinct(Order.id)).label("orders_count"),
            func.coalesce(func.sum(OrderItem.volume_m3), 0).label("total_volume"),
            func.max(Order.created_at).label("last_order_at"),
        )
        .join(OrderItem, OrderItem.order_id == Order.id)
        .where(Order.status != OrderStatus.CANCELLED)
        .group_by(Order.customer_id)
        .subquery()
    )
    stmt = select(Customer, stats.c.orders_count, stats.c.total_volume, stats.c.last_order_at).outerjoin(
        stats, stats.c.customer_id == Customer.id
    )
    if q and q.strip():
        term = q.strip()
        digits = "".join(ch for ch in term if ch.isdigit())
        conditions = [Customer.full_name.ilike(like_pattern(term)), Customer.company_name.ilike(like_pattern(term))]
        if len(digits) >= 3:
            conditions.append(Customer.phone.like(like_pattern(digits)))
        stmt = stmt.where(or_(*conditions))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(stats.c.last_order_at.desc().nulls_last(), Customer.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    items = [
        CustomerListItem(
            id=c.id,
            full_name=c.full_name,
            phone=c.phone,
            company_name=c.company_name,
            orders_count=count or 0,
            total_volume_m3=volume or 0,
            last_order_at=last,
            created_at=c.created_at,
        )
        for c, count, volume, last in rows
    ]
    return Page(items=items, total=total, page=page, page_size=page_size)


def _load(db: Session, customer_id: int) -> Customer:
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Mijoz topilmadi.")
    return customer


@router.get("/{customer_id}", response_model=CustomerDetail)
def get_customer(customer_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.CUSTOMERS_READ))):
    return _load(db, customer_id)


@router.post("", response_model=CustomerDetail, status_code=status.HTTP_201_CREATED)
def create_customer(payload: CustomerIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.CUSTOMERS_MANAGE))):
    customer = Customer(**payload.model_dump())
    db.add(customer)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _DUPLICATE from None
    db.refresh(customer)
    return customer


@router.put("/{customer_id}", response_model=CustomerDetail)
def update_customer(
    customer_id: int, payload: CustomerIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.CUSTOMERS_MANAGE))
):
    customer = _load(db, customer_id)
    for key, value in payload.model_dump().items():
        setattr(customer, key, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _DUPLICATE from None
    db.refresh(customer)
    return customer
