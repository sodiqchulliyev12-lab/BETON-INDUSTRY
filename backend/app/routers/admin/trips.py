"""Buyurtma qatnovlari: mashina va haydovchini biriktirish, yuklash/yo'lda/yetkazildi holatlari."""
from datetime import date, datetime, time, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require
from app.models import Order, OrderTrip, User
from app.models.enums import TripStatus
from app.permissions import Perm
from app.schemas.admin_fleet import OrderVolumes, TripIn, TripOut, TripStatusIn, TripUpdate
from app.services import fleet
from app.utils.timezone import local_tz, today_local

router = APIRouter(tags=["Admin: qatnovlar"])


class OrderLogistics(BaseModel):
    volumes: OrderVolumes
    trips: list[TripOut]


def _order(db: Session, order_id: int) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Buyurtma topilmadi.")
    return order


def _trip(db: Session, trip_id: int) -> OrderTrip:
    try:
        return fleet.get_trip(db, trip_id)
    except fleet.NotFound:
        raise HTTPException(status_code=404, detail="Qatnov topilmadi.") from None


def _logistics(db: Session, order: Order) -> OrderLogistics:
    db.refresh(order)
    return OrderLogistics(
        volumes=fleet.order_volumes(db, order),
        trips=[fleet.trip_out(t) for t in fleet.list_order_trips(db, order.id)],
    )


@router.get("/orders/{order_id}/logistics", response_model=OrderLogistics)
def order_logistics(order_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.ORDERS_READ))):
    return _logistics(db, _order(db, order_id))


@router.post("/orders/{order_id}/trips", response_model=OrderLogistics, status_code=status.HTTP_201_CREATED)
def create_trip(order_id: int, payload: TripIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.TRIPS_MANAGE))):
    order = _order(db, order_id)
    fleet.create_trip(db, order, payload)
    return _logistics(db, order)


@router.patch("/trips/{trip_id}", response_model=OrderLogistics)
def update_trip(trip_id: int, payload: TripUpdate, db: Session = Depends(get_db), _: User = Depends(require(Perm.TRIPS_MANAGE))):
    trip = fleet.update_trip(db, _trip(db, trip_id), payload)
    return _logistics(db, _order(db, trip.order_id))


@router.post("/trips/{trip_id}/status", response_model=OrderLogistics)
def change_trip_status(
    trip_id: int, payload: TripStatusIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.TRIPS_MANAGE))
):
    trip = fleet.change_trip_status(db, _trip(db, trip_id), payload.status)
    return _logistics(db, _order(db, trip.order_id))


@router.delete("/trips/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trip(trip_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.TRIPS_MANAGE))):
    fleet.delete_trip(db, _trip(db, trip_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/trips", response_model=list[TripOut], summary="Dispetcher uchun: kun bo'yicha qatnovlar")
def list_trips(
    db: Session = Depends(get_db),
    _: User = Depends(require(Perm.FLEET_READ)),
    day: Annotated[date | None, Query(alias="date")] = None,
    active_only: bool = False,
):
    """Tanlangan kunda yetkazilishi kerak bo'lgan buyurtmalarning qatnovlari + o'sha kuni yuklangan/yetkazilganlar."""
    day = day or today_local()
    start = datetime.combine(day, time.min, tzinfo=local_tz())
    end = start + timedelta(days=1)
    stmt = (
        select(OrderTrip, Order.order_number)
        .join(Order, Order.id == OrderTrip.order_id)
        .where(or_(
            Order.delivery_date == day,
            OrderTrip.loaded_at.between(start, end),
            OrderTrip.delivered_at.between(start, end),
        ))
    )
    if active_only:
        stmt = stmt.where(OrderTrip.status.notin_((TripStatus.DELIVERED, TripStatus.CANCELLED)))
    rows = db.execute(stmt.order_by(Order.delivery_time.nulls_last(), Order.id, OrderTrip.trip_no)).all()
    return [fleet.trip_out(trip, number) for trip, number in rows]
