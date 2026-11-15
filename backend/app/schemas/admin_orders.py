from datetime import date, datetime, time
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

from app.models.enums import DeliveryPriceStatus, OrderSource, OrderStatus
from app.schemas.common import InputModel, JsonDecimal, OrmModel, clean_text


class OrderListItem(BaseModel):
    id: int
    order_number: str
    status: OrderStatus
    created_at: datetime
    customer_id: int
    customer_name: str
    customer_phone: str
    products: str
    volume_m3: JsonDecimal
    delivery_required: bool
    delivery_date: date
    delivery_time: time | None
    concrete_total: JsonDecimal | None
    delivery_price_status: DeliveryPriceStatus
    grand_total: JsonDecimal | None
    currency: str


class OrderItemOut(OrmModel):
    id: int
    product_id: int
    product_name: str
    grade_class: str
    volume_m3: JsonDecimal
    unit_price: JsonDecimal | None
    line_total: JsonDecimal | None


class StatusHistoryOut(BaseModel):
    id: int
    from_status: OrderStatus | None
    to_status: OrderStatus
    note: str | None
    changed_by: str | None
    created_at: datetime


class CustomerShort(OrmModel):
    id: int
    full_name: str
    phone: str
    company_name: str | None


class OrderDetail(BaseModel):
    id: int
    order_number: str
    status: OrderStatus
    source: OrderSource
    created_at: datetime
    updated_at: datetime
    customer: CustomerShort
    delivery_required: bool
    delivery_address: str | None
    delivery_date: date
    delivery_time: time | None
    comment: str | None
    concrete_total: JsonDecimal | None
    delivery_price: JsonDecimal | None
    delivery_price_status: DeliveryPriceStatus
    grand_total: JsonDecimal | None
    currency: str
    cancel_reason: str | None
    delivery_lat: float | None
    delivery_lon: float | None
    factory_lat: float | None          # zavod joylashuvi (sozlamalardan)
    factory_lon: float | None
    distance_km: float | None          # zavod → yetkazish nuqtasi, to'g'ri chiziq bo'yicha
    items: list[OrderItemOut]
    history: list[StatusHistoryOut]
    allowed_statuses: list[OrderStatus]


class OrderUpdate(InputModel):
    """Menejer tahriri. Faqat yuborilgan maydonlar o'zgaradi."""

    delivery_price: Annotated[Decimal | None, Field(default=None, ge=0, max_digits=14, decimal_places=2)]
    delivery_address: Annotated[str | None, Field(default=None, max_length=500)]
    delivery_date: date | None = None
    delivery_time: time | None = None
    comment: Annotated[str | None, Field(default=None, max_length=1000)]
    # Ikkalasi birga yuboriladi; ikkalasi null — nuqtani olib tashlash
    delivery_lat: Annotated[float | None, Field(default=None, ge=-90, le=90)]
    delivery_lon: Annotated[float | None, Field(default=None, ge=-180, le=180)]

    @field_validator("delivery_address", "comment")
    @classmethod
    def _clean(cls, value: str | None) -> str | None:
        return clean_text(value)


class OrderItemUpdate(InputModel):
    unit_price: Annotated[Decimal | None, Field(default=None, ge=0, max_digits=12, decimal_places=2)]
    volume_m3: Annotated[Decimal | None, Field(default=None, gt=0, max_digits=7, decimal_places=1)]


class StatusChange(InputModel):
    status: OrderStatus
    note: Annotated[str | None, Field(default=None, max_length=500)]
    cancel_reason: Annotated[str | None, Field(default=None, max_length=500)]

    @field_validator("note", "cancel_reason")
    @classmethod
    def _clean(cls, value: str | None) -> str | None:
        return clean_text(value)


class AdminOrderCreate(InputModel):
    """Admin paneldan qo'lda kiritiladigan buyurtma (telefon yoki uchrashuvda kelishilgan)."""

    customer_name: Annotated[str, Field(max_length=100)]
    phone: Annotated[str, Field(max_length=30)]
    product_id: Annotated[int, Field(gt=0)]
    volume_m3: Annotated[Decimal, Field(max_digits=7, decimal_places=1, gt=0, le=1000)]
    delivery_required: bool = True
    delivery_address: Annotated[str | None, Field(default=None, max_length=500)]
    delivery_lat: float | None = None
    delivery_lon: float | None = None
    delivery_date: date
    delivery_time: time | None = None
    comment: Annotated[str | None, Field(default=None, max_length=1000)]
    # Narx har bir buyurtmada alohida: kiritilmasa buyurtma ochiq qoladi va «Narxlar» bo'limida kiritiladi
    unit_price: Annotated[Decimal | None, Field(default=None, ge=0, max_digits=12, decimal_places=2)]
    delivery_price: Annotated[Decimal | None, Field(default=None, ge=0, max_digits=12, decimal_places=2)]
    manager_id: Annotated[int | None, Field(default=None, gt=0)]

    @field_validator("customer_name")
    @classmethod
    def _name(cls, value: str) -> str:
        from app.schemas.common import validate_person_name

        return validate_person_name(value)

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str) -> str:
        from app.utils.phone import normalize_phone

        return normalize_phone(value)

    @field_validator("delivery_address", "comment")
    @classmethod
    def _text(cls, value: str | None) -> str | None:
        return clean_text(value)

    @field_validator("delivery_address")
    @classmethod
    def _address(cls, value: str | None, info) -> str | None:
        if info.data.get("delivery_required", True):
            if not value or len(value) < 5:
                raise ValueError("Yetkazib berish manzilini kiriting.")
            return value
        return None
