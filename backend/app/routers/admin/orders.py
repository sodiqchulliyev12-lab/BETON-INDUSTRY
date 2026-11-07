from datetime import date
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require
from app.models import User
from app.models.enums import OrderStatus
from app.permissions import Perm
from app.schemas.admin_orders import OrderDetail, OrderItemUpdate, OrderListItem, OrderUpdate, StatusChange
from app.schemas.common import Page
from app.services import order_admin, telegram

router = APIRouter(prefix="/orders", tags=["Admin: buyurtmalar"])


def _load(db: Session, order_id: int):
    try:
        return order_admin.get_order(db, order_id)
    except order_admin.NotFound:
        raise HTTPException(status_code=404, detail="Buyurtma topilmadi.") from None


@router.get("", response_model=Page[OrderListItem])
def list_orders(
    db: Session = Depends(get_db),
    _: User = Depends(require(Perm.ORDERS_READ)),
    status: OrderStatus | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    date_from: date | None = None,
    date_to: date | None = None,
    customer_id: int | None = None,
    open_only: bool = False,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    return order_admin.list_orders(
        db, status=status, q=q, date_from=date_from, date_to=date_to,
        customer_id=customer_id, open_only=open_only, page=page, page_size=page_size,
    )


@router.get("/{order_id}", response_model=OrderDetail)
def get_order(order_id: int, db: Session = Depends(get_db), user: User = Depends(require(Perm.ORDERS_READ))):
    return order_admin.order_detail(db, _load(db, order_id), user.role)


@router.patch("/{order_id}", response_model=OrderDetail)
def update_order(
    order_id: int, payload: OrderUpdate, db: Session = Depends(get_db),
    user: User = Depends(require(Perm.ORDERS_MANAGE)),
):
    order = order_admin.update_order(db, _load(db, order_id), payload)
    return order_admin.order_detail(db, order, user.role)


@router.patch("/{order_id}/items/{item_id}", response_model=OrderDetail)
def update_item(
    order_id: int, item_id: int, payload: OrderItemUpdate, db: Session = Depends(get_db),
    user: User = Depends(require(Perm.ORDERS_MANAGE)),
):
    try:
        order = order_admin.update_item(db, _load(db, order_id), item_id, payload)
    except order_admin.NotFound:
        raise HTTPException(status_code=404, detail="Buyurtma qatori topilmadi.") from None
    return order_admin.order_detail(db, order, user.role)


@router.post("/{order_id}/status", response_model=OrderDetail)
def change_status(
    order_id: int, payload: StatusChange, background: BackgroundTasks, db: Session = Depends(get_db),
    user: User = Depends(require(Perm.ORDERS_STATUS)),
):
    order = _load(db, order_id)
    previous = order.status.value
    order = order_admin.change_status(db, order, payload, user)
    background.add_task(telegram.notify_status_change, order.id, previous, order.status.value, user.full_name, payload.note)
    return order_admin.order_detail(db, order, user.role)
