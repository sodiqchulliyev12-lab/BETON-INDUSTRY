"""Transport, qatnovlar va buyurtma hajmlari.

Qoidalar:
- ta'mirdagi yoki nofaol mashinaga qatnov biriktirilmaydi;
- bitta buyurtmadagi qatnovlar hajmi buyurtma hajmidan oshmaydi;
- mashina sig'imi ma'lum bo'lsa, bitta qatnov hajmi undan oshmaydi;
- ijara xarajati faqat ijaraga olingan transport uchun yoziladi;
- mashina holati qatnovlarga qarab avtomatik yangilanadi (ta'mirdagisi bundan mustasno).
"""
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Driver, Order, OrderTrip, ProductionRecord, Vehicle
from app.models.enums import OrderStatus, QcStatus, TripStatus, VehicleOwnership, VehicleStatus
from app.schemas.admin_fleet import OrderVolumes, TripIn, TripOut, TripUpdate
from app.services.orders import OrderError

T = TripStatus
ZERO = Decimal("0")

TRIP_FLOW: dict[TripStatus, tuple[TripStatus, ...]] = {
    T.PLANNED: (T.LOADING, T.LOADED, T.CANCELLED),
    T.LOADING: (T.LOADED, T.CANCELLED),
    T.LOADED: (T.EN_ROUTE, T.DELIVERED, T.CANCELLED),
    T.EN_ROUTE: (T.DELIVERED,),
    T.DELIVERED: (),
    T.CANCELLED: (),
}
ACTIVE_TRIP = (T.LOADING, T.LOADED, T.EN_ROUTE)
LOADED_OR_LATER = (T.LOADED, T.EN_ROUTE, T.DELIVERED)


class NotFound(Exception):
    pass


# --- Hajmlar ---------------------------------------------------------------

def order_volumes(db: Session, order: Order) -> OrderVolumes:
    ordered = sum((i.volume_m3 for i in order.items), ZERO)
    trips = db.execute(
        select(OrderTrip.status, func.coalesce(func.sum(OrderTrip.volume_m3), 0), func.coalesce(func.sum(OrderTrip.rental_cost), 0))
        .where(OrderTrip.order_id == order.id)
        .group_by(OrderTrip.status)
    ).all()
    by_status = {status: (volume, cost) for status, volume, cost in trips}
    in_trips = sum((v for s, (v, _) in by_status.items() if s != T.CANCELLED), ZERO)
    loaded = sum((by_status.get(s, (ZERO, ZERO))[0] for s in LOADED_OR_LATER), ZERO)
    delivered = by_status.get(T.DELIVERED, (ZERO, ZERO))[0]
    rental = sum((c for s, (_, c) in by_status.items() if s != T.CANCELLED), ZERO)

    production = dict(
        db.execute(
            select(ProductionRecord.qc_status, func.coalesce(func.sum(ProductionRecord.produced_volume_m3), 0))
            .where(ProductionRecord.order_id == order.id)
            .group_by(ProductionRecord.qc_status)
        ).all()
    )
    produced = sum((v for s, v in production.items() if s != QcStatus.FAILED), ZERO)

    return OrderVolumes(
        ordered=ordered,
        in_trips=in_trips,
        unassigned=max(ordered - in_trips, ZERO),
        produced=produced,
        qc_passed=production.get(QcStatus.PASSED, ZERO),
        loaded=loaded,
        delivered=delivered,
        remaining=max(ordered - delivered, ZERO),
        rental_cost_total=rental,
    )


# --- Qatnovlar -------------------------------------------------------------

def trip_out(trip: OrderTrip, order_number: str | None = None) -> TripOut:
    return TripOut(
        id=trip.id,
        order_id=trip.order_id,
        order_number=order_number,
        trip_no=trip.trip_no,
        vehicle_id=trip.vehicle_id,
        plate_number=trip.vehicle.plate_number,
        vehicle_type=trip.vehicle.vehicle_type,
        ownership=trip.vehicle.ownership,
        driver_id=trip.driver_id,
        driver_name=trip.driver.full_name if trip.driver else None,
        driver_phone=trip.driver.phone if trip.driver else None,
        volume_m3=trip.volume_m3,
        status=trip.status,
        loaded_at=trip.loaded_at,
        departed_at=trip.departed_at,
        delivered_at=trip.delivered_at,
        rental_cost=trip.rental_cost,
        notes=trip.notes,
        allowed_statuses=list(TRIP_FLOW[trip.status]),
        created_at=trip.created_at,
    )


def list_order_trips(db: Session, order_id: int) -> list[OrderTrip]:
    return list(db.scalars(select(OrderTrip).where(OrderTrip.order_id == order_id).order_by(OrderTrip.trip_no)))


def get_trip(db: Session, trip_id: int) -> OrderTrip:
    trip = db.get(OrderTrip, trip_id)
    if trip is None:
        raise NotFound
    return trip


def _vehicle(db: Session, vehicle_id: int) -> Vehicle:
    vehicle = db.get(Vehicle, vehicle_id)
    if vehicle is None or not vehicle.is_active:
        raise OrderError("Transport topilmadi yoki nofaol.", field="vehicle_id")
    if vehicle.status == VehicleStatus.REPAIR:
        raise OrderError("Bu transport ta’mirda — qatnovga biriktirib bo‘lmaydi.", field="vehicle_id")
    return vehicle


def _driver(db: Session, driver_id: int | None) -> Driver | None:
    if driver_id is None:
        return None
    driver = db.get(Driver, driver_id)
    if driver is None or not driver.is_active:
        raise OrderError("Haydovchi topilmadi yoki nofaol.", field="driver_id")
    return driver


def _check_volume(db: Session, order: Order, vehicle: Vehicle, volume: Decimal, exclude_trip_id: int | None = None) -> None:
    if vehicle.capacity_m3 is not None and volume > vehicle.capacity_m3:
        raise OrderError(f"Hajm mashina sig‘imidan ({vehicle.capacity_m3} m³) katta.", field="volume_m3")
    stmt = select(func.coalesce(func.sum(OrderTrip.volume_m3), 0)).where(
        OrderTrip.order_id == order.id, OrderTrip.status != T.CANCELLED
    )
    if exclude_trip_id:
        stmt = stmt.where(OrderTrip.id != exclude_trip_id)
    assigned = db.scalar(stmt) or ZERO
    ordered = sum((i.volume_m3 for i in order.items), ZERO)
    if assigned + volume > ordered:
        raise OrderError(
            f"Qatnovlar jami hajmi buyurtma hajmidan oshib ketadi. Biriktirish mumkin: {max(ordered - assigned, ZERO)} m³.",
            field="volume_m3",
        )


def _check_rental(vehicle: Vehicle, rental_cost: Decimal | None) -> None:
    if rental_cost is not None and vehicle.ownership != VehicleOwnership.RENTED:
        raise OrderError("Ijara xarajati faqat ijaraga olingan transport uchun yoziladi.", field="rental_cost")


def sync_vehicle_status(db: Session, vehicle_id: int) -> None:
    vehicle = db.get(Vehicle, vehicle_id)
    if vehicle is None or vehicle.status == VehicleStatus.REPAIR:
        return
    busy = db.scalar(
        select(func.count()).select_from(OrderTrip).where(OrderTrip.vehicle_id == vehicle_id, OrderTrip.status.in_(ACTIVE_TRIP))
    )
    vehicle.status = VehicleStatus.BUSY if busy else VehicleStatus.FREE


def create_trip(db: Session, order: Order, data: TripIn) -> OrderTrip:
    if order.status in (OrderStatus.CANCELLED, OrderStatus.DELIVERED):
        raise OrderError("Yakunlangan yoki bekor qilingan buyurtmaga qatnov qo‘shib bo‘lmaydi.")
    if not order.delivery_required:
        raise OrderError("Bu buyurtmani mijoz o‘zi olib ketadi — yetkazib berish qatnovi kerak emas.")
    # Bir vaqtda ikki dispetcher qatnov qo'shsa ham raqam va hajm to'g'ri qolsin
    db.execute(select(Order.id).where(Order.id == order.id).with_for_update())

    vehicle = _vehicle(db, data.vehicle_id)
    driver = _driver(db, data.driver_id if data.driver_id is not None else vehicle.default_driver_id)
    _check_volume(db, order, vehicle, data.volume_m3)
    _check_rental(vehicle, data.rental_cost)

    next_no = (db.scalar(select(func.max(OrderTrip.trip_no)).where(OrderTrip.order_id == order.id)) or 0) + 1
    trip = OrderTrip(
        order_id=order.id,
        vehicle_id=vehicle.id,
        driver_id=driver.id if driver else None,
        trip_no=next_no,
        volume_m3=data.volume_m3,
        rental_cost=data.rental_cost,
        notes=data.notes,
    )
    db.add(trip)
    db.commit()
    db.refresh(trip)
    return trip


def update_trip(db: Session, trip: OrderTrip, data: TripUpdate) -> OrderTrip:
    if trip.status in (T.DELIVERED, T.CANCELLED):
        raise OrderError("Yakunlangan qatnovni tahrirlab bo‘lmaydi.")
    fields = data.model_fields_set
    order = db.get(Order, trip.order_id)
    vehicle = trip.vehicle

    if "vehicle_id" in fields and data.vehicle_id and data.vehicle_id != trip.vehicle_id:
        if trip.status != T.PLANNED:
            raise OrderError("Yuklangan qatnovning mashinasini almashtirib bo‘lmaydi.", field="vehicle_id")
        old_vehicle_id = trip.vehicle_id
        vehicle = _vehicle(db, data.vehicle_id)
        trip.vehicle_id = vehicle.id
        trip.vehicle = vehicle
        sync_vehicle_status(db, old_vehicle_id)
    if "driver_id" in fields:
        trip.driver_id = _driver(db, data.driver_id).id if data.driver_id else None
    if "volume_m3" in fields and data.volume_m3 is not None:
        _check_volume(db, order, vehicle, data.volume_m3, exclude_trip_id=trip.id)
        trip.volume_m3 = data.volume_m3
    if "rental_cost" in fields:
        _check_rental(vehicle, data.rental_cost)
        trip.rental_cost = data.rental_cost
    elif vehicle.ownership != VehicleOwnership.RENTED:
        trip.rental_cost = None  # o'z mashinasiga almashtirilganda ijara xarajati olib tashlanadi
    if "notes" in fields:
        trip.notes = data.notes
    db.commit()
    db.refresh(trip)
    return trip


def change_trip_status(db: Session, trip: OrderTrip, status: TripStatus) -> OrderTrip:
    if status not in TRIP_FLOW[trip.status]:
        raise OrderError("Qatnovni bu holatga o‘tkazib bo‘lmaydi.", field="status")
    now = datetime.now(UTC)
    if status in LOADED_OR_LATER and trip.loaded_at is None:
        trip.loaded_at = now
    if status in (T.EN_ROUTE, T.DELIVERED) and trip.departed_at is None:
        trip.departed_at = now
    if status == T.DELIVERED:
        trip.delivered_at = now
    trip.status = status
    db.flush()
    sync_vehicle_status(db, trip.vehicle_id)
    db.commit()
    db.refresh(trip)
    return trip


def delete_trip(db: Session, trip: OrderTrip) -> None:
    if trip.status != T.PLANNED:
        raise OrderError("Faqat rejalashtirilgan qatnovni o‘chirish mumkin. Boshqalarini bekor qiling.")
    vehicle_id = trip.vehicle_id
    db.delete(trip)
    db.flush()
    sync_vehicle_status(db, vehicle_id)
    db.commit()
