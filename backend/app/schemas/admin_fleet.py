"""Transport, haydovchilar va qatnovlar."""
import re
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

from app.models.enums import DriverEmployment, TripStatus, VehicleOwnership, VehicleStatus
from app.schemas.common import InputModel, JsonDecimal, OrmModel, clean_text, validate_person_name
from app.utils.phone import normalize_phone

_PLATE = re.compile(r"^[A-Z0-9]{4,12}$")


def normalize_plate(value: str) -> str:
    """'01 a 123 bc' → '01A123BC' (bo'shliq va chiziqlarsiz, katta harf)."""
    plate = re.sub(r"[\s\-]", "", value or "").upper()
    if not _PLATE.match(plate):
        raise ValueError("Davlat raqami noto‘g‘ri. Namuna: 01 A 123 BC")
    return plate


def _optional_phone(value: str | None) -> str | None:
    value = clean_text(value)
    return normalize_phone(value) if value else None


# --- Haydovchilar ----------------------------------------------------------

class DriverIn(InputModel):
    full_name: Annotated[str, Field(max_length=150)]
    phone: Annotated[str, Field(max_length=30)]
    license_number: Annotated[str | None, Field(default=None, max_length=30)]
    employment: DriverEmployment = DriverEmployment.STAFF
    is_active: bool = True
    notes: Annotated[str | None, Field(default=None, max_length=1000)]

    @field_validator("full_name")
    @classmethod
    def _name(cls, v: str) -> str:
        return validate_person_name(v)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)

    @field_validator("license_number", "notes")
    @classmethod
    def _clean(cls, v: str | None) -> str | None:
        return clean_text(v)


class DriverOut(OrmModel):
    id: int
    full_name: str
    phone: str
    license_number: str | None
    employment: DriverEmployment
    is_active: bool
    notes: str | None
    trips_count: int = 0
    created_at: datetime


# --- Transport -------------------------------------------------------------

class VehicleIn(InputModel):
    plate_number: Annotated[str, Field(max_length=20)]
    vehicle_type: Annotated[str, Field(min_length=2, max_length=50)]
    ownership: VehicleOwnership
    capacity_m3: Annotated[Decimal | None, Field(default=None, gt=0, max_digits=6, decimal_places=2)]
    default_driver_id: int | None = None
    contact_phone: Annotated[str | None, Field(default=None, max_length=30)]
    rental_company: Annotated[str | None, Field(default=None, max_length=200)]
    status: VehicleStatus = VehicleStatus.FREE
    is_active: bool = True
    notes: Annotated[str | None, Field(default=None, max_length=1000)]

    @field_validator("plate_number")
    @classmethod
    def _plate(cls, v: str) -> str:
        return normalize_plate(v)

    @field_validator("vehicle_type", "rental_company", "notes")
    @classmethod
    def _clean(cls, v: str | None) -> str | None:
        return clean_text(v)

    @field_validator("contact_phone")
    @classmethod
    def _phone(cls, v: str | None) -> str | None:
        return _optional_phone(v)


class VehicleStatusIn(InputModel):
    status: VehicleStatus


class VehicleOut(OrmModel):
    id: int
    plate_number: str
    vehicle_type: str
    ownership: VehicleOwnership
    capacity_m3: JsonDecimal | None
    default_driver_id: int | None
    default_driver_name: str | None = None
    default_driver_phone: str | None = None
    contact_phone: str | None
    rental_company: str | None
    status: VehicleStatus
    is_active: bool
    notes: str | None
    active_trips: int = 0
    trips_count: int = 0
    created_at: datetime


# --- Qatnovlar -------------------------------------------------------------

class TripIn(InputModel):
    vehicle_id: int
    driver_id: int | None = None  # bo'sh bo'lsa mashinaning doimiy haydovchisi olinadi
    volume_m3: Annotated[Decimal, Field(gt=0, max_digits=7, decimal_places=1)]
    rental_cost: Annotated[Decimal | None, Field(default=None, ge=0, max_digits=14, decimal_places=2)]
    notes: Annotated[str | None, Field(default=None, max_length=500)]

    @field_validator("notes")
    @classmethod
    def _clean(cls, v: str | None) -> str | None:
        return clean_text(v)


class TripUpdate(InputModel):
    vehicle_id: int | None = None
    driver_id: int | None = None
    volume_m3: Annotated[Decimal | None, Field(default=None, gt=0, max_digits=7, decimal_places=1)]
    rental_cost: Annotated[Decimal | None, Field(default=None, ge=0, max_digits=14, decimal_places=2)]
    notes: Annotated[str | None, Field(default=None, max_length=500)]

    @field_validator("notes")
    @classmethod
    def _clean(cls, v: str | None) -> str | None:
        return clean_text(v)


class TripStatusIn(InputModel):
    status: TripStatus


class TripOut(BaseModel):
    id: int
    order_id: int
    order_number: str | None = None
    trip_no: int
    vehicle_id: int
    plate_number: str
    vehicle_type: str
    ownership: VehicleOwnership
    driver_id: int | None
    driver_name: str | None
    driver_phone: str | None
    volume_m3: JsonDecimal
    status: TripStatus
    loaded_at: datetime | None
    departed_at: datetime | None
    delivered_at: datetime | None
    rental_cost: JsonDecimal | None
    notes: str | None
    allowed_statuses: list[TripStatus]
    created_at: datetime


class OrderVolumes(BaseModel):
    """Buyurtma bo'yicha hajmlar (m³). Hammasi bazadagi haqiqiy yozuvlardan hisoblanadi."""

    ordered: JsonDecimal
    in_trips: JsonDecimal        # bekor qilinmagan qatnovlarga biriktirilgan
    unassigned: JsonDecimal      # hali qatnovga biriktirilmagan
    produced: JsonDecimal        # ishlab chiqarish yozuvlari (sifat nazoratidan o'tmaganlarsiz)
    qc_passed: JsonDecimal
    loaded: JsonDecimal          # yuklangan / yo'lda / yetkazilgan qatnovlar
    delivered: JsonDecimal
    remaining: JsonDecimal       # buyurtma − yetkazilgan
    rental_cost_total: JsonDecimal
