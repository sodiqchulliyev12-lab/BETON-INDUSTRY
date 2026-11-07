"""Transport va haydovchilar. Ularning soni va sig'imi kodda emas — shu yerdan kiritiladi."""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require
from app.models import Driver, OrderTrip, User, Vehicle
from app.models.enums import VehicleOwnership, VehicleStatus
from app.permissions import Perm
from app.schemas.admin_fleet import DriverIn, DriverOut, VehicleIn, VehicleOut, VehicleStatusIn
from app.services.fleet import ACTIVE_TRIP, sync_vehicle_status

router = APIRouter(tags=["Admin: transport va haydovchilar"])


def _error(field: str, message: str, code: int = status.HTTP_422_UNPROCESSABLE_CONTENT) -> HTTPException:
    return HTTPException(status_code=code, detail=[{"loc": ["body", field], "msg": message, "type": "business_rule"}])


# --- Haydovchilar ----------------------------------------------------------

def _driver_out(db: Session, drivers: list[Driver]) -> list[DriverOut]:
    ids = [d.id for d in drivers]
    counts = dict(db.execute(
        select(OrderTrip.driver_id, func.count()).where(OrderTrip.driver_id.in_(ids)).group_by(OrderTrip.driver_id)
    ).all()) if ids else {}
    return [DriverOut.model_validate(d).model_copy(update={"trips_count": counts.get(d.id, 0)}) for d in drivers]


def _load_driver(db: Session, driver_id: int) -> Driver:
    driver = db.get(Driver, driver_id)
    if driver is None:
        raise HTTPException(status_code=404, detail="Haydovchi topilmadi.")
    return driver


@router.get("/drivers", response_model=list[DriverOut])
def list_drivers(db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_READ))):
    return _driver_out(db, list(db.scalars(select(Driver).order_by(Driver.is_active.desc(), Driver.full_name))))


@router.post("/drivers", response_model=DriverOut, status_code=status.HTTP_201_CREATED)
def create_driver(payload: DriverIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_MANAGE))):
    driver = Driver(**payload.model_dump())
    db.add(driver)
    db.commit()
    db.refresh(driver)
    return _driver_out(db, [driver])[0]


@router.put("/drivers/{driver_id}", response_model=DriverOut)
def update_driver(driver_id: int, payload: DriverIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_MANAGE))):
    driver = _load_driver(db, driver_id)
    for key, value in payload.model_dump().items():
        setattr(driver, key, value)
    db.commit()
    db.refresh(driver)
    return _driver_out(db, [driver])[0]


@router.delete("/drivers/{driver_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_driver(driver_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_MANAGE))):
    driver = _load_driver(db, driver_id)
    if db.scalar(select(func.count()).select_from(OrderTrip).where(OrderTrip.driver_id == driver.id)):
        raise _error("id", "Haydovchi qatnovlarda qayd etilgan. O‘chirish o‘rniga nofaol qiling.")
    db.delete(driver)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Transport -------------------------------------------------------------

def _vehicle_out(db: Session, vehicles: list[Vehicle]) -> list[VehicleOut]:
    ids = [v.id for v in vehicles]
    total = dict(db.execute(
        select(OrderTrip.vehicle_id, func.count()).where(OrderTrip.vehicle_id.in_(ids)).group_by(OrderTrip.vehicle_id)
    ).all()) if ids else {}
    active = dict(db.execute(
        select(OrderTrip.vehicle_id, func.count())
        .where(OrderTrip.vehicle_id.in_(ids), OrderTrip.status.in_(ACTIVE_TRIP))
        .group_by(OrderTrip.vehicle_id)
    ).all()) if ids else {}
    return [
        VehicleOut.model_validate(v).model_copy(update={
            "default_driver_name": v.default_driver.full_name if v.default_driver else None,
            "default_driver_phone": v.default_driver.phone if v.default_driver else None,
            "trips_count": total.get(v.id, 0),
            "active_trips": active.get(v.id, 0),
        })
        for v in vehicles
    ]


def _load_vehicle(db: Session, vehicle_id: int) -> Vehicle:
    vehicle = db.get(Vehicle, vehicle_id)
    if vehicle is None:
        raise HTTPException(status_code=404, detail="Transport topilmadi.")
    return vehicle


def _apply_vehicle(db: Session, vehicle: Vehicle, payload: VehicleIn) -> None:
    if payload.default_driver_id is not None:
        driver = db.get(Driver, payload.default_driver_id)
        if driver is None or not driver.is_active:
            raise _error("default_driver_id", "Haydovchi topilmadi yoki nofaol.")
    data = payload.model_dump()
    if payload.ownership == VehicleOwnership.OWN:
        data["rental_company"] = None
    for key, value in data.items():
        setattr(vehicle, key, value)


def _commit_unique(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _error("plate_number", "Bu davlat raqamli transport allaqachon mavjud.", status.HTTP_409_CONFLICT) from None


@router.get("/vehicles", response_model=list[VehicleOut])
def list_vehicles(db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_READ))):
    vehicles = list(db.scalars(select(Vehicle).order_by(Vehicle.is_active.desc(), Vehicle.ownership, Vehicle.plate_number)))
    return _vehicle_out(db, vehicles)


@router.post("/vehicles", response_model=VehicleOut, status_code=status.HTTP_201_CREATED)
def create_vehicle(payload: VehicleIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_MANAGE))):
    vehicle = Vehicle()
    _apply_vehicle(db, vehicle, payload)
    db.add(vehicle)
    _commit_unique(db)
    db.refresh(vehicle)
    return _vehicle_out(db, [vehicle])[0]


@router.put("/vehicles/{vehicle_id}", response_model=VehicleOut)
def update_vehicle(vehicle_id: int, payload: VehicleIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_MANAGE))):
    vehicle = _load_vehicle(db, vehicle_id)
    _apply_vehicle(db, vehicle, payload)
    if payload.status != VehicleStatus.REPAIR:
        sync_vehicle_status(db, vehicle.id)  # band/bo'sh holati qatnovlarga qarab aniqlanadi
    _commit_unique(db)
    db.refresh(vehicle)
    return _vehicle_out(db, [vehicle])[0]


@router.post("/vehicles/{vehicle_id}/status", response_model=VehicleOut)
def set_vehicle_status(
    vehicle_id: int, payload: VehicleStatusIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_MANAGE))
):
    """Asosan ta'mirga yuborish / ta'mirdan qaytarish uchun."""
    vehicle = _load_vehicle(db, vehicle_id)
    if payload.status == VehicleStatus.REPAIR:
        active = db.scalar(
            select(func.count()).select_from(OrderTrip).where(OrderTrip.vehicle_id == vehicle.id, OrderTrip.status.in_(ACTIVE_TRIP))
        )
        if active:
            raise _error("status", "Mashinada yakunlanmagan qatnov bor. Avval qatnovni yakunlang.")
        vehicle.status = VehicleStatus.REPAIR
    else:
        vehicle.status = VehicleStatus.FREE
        sync_vehicle_status(db, vehicle.id)
    db.commit()
    db.refresh(vehicle)
    return _vehicle_out(db, [vehicle])[0]


@router.delete("/vehicles/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vehicle(vehicle_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.FLEET_MANAGE))):
    vehicle = _load_vehicle(db, vehicle_id)
    if db.scalar(select(func.count()).select_from(OrderTrip).where(OrderTrip.vehicle_id == vehicle.id)):
        raise _error("id", "Transport qatnovlarda qayd etilgan. O‘chirish o‘rniga nofaol qiling.")
    db.delete(vehicle)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
