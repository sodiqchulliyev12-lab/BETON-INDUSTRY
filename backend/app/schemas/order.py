from datetime import date, time, timedelta
from decimal import Decimal
from typing import Annotated

from pydantic import Field, ValidationInfo, field_validator

from app.config import settings
from app.models.enums import DeliveryPriceStatus, OrderStatus
from app.schemas.common import InputModel, JsonDecimal, OrmModel, clean_text, validate_person_name
from app.utils.geo import in_service_area
from app.utils.phone import normalize_phone
from app.utils.timezone import today_local


class OrderCreate(InputModel):
    """Saytdagi buyurtma formasi."""

    customer_name: Annotated[str, Field(max_length=100)]
    phone: Annotated[str, Field(max_length=30)]
    product_id: Annotated[int, Field(gt=0)]
    volume_m3: Annotated[Decimal, Field(max_digits=7, decimal_places=1)]
    delivery_required: bool = True
    delivery_address: Annotated[str | None, Field(default=None, max_length=500, validate_default=True)]
    # Xaritadan tanlangan nuqta (ixtiyoriy). Ikkalasi birga yuboriladi.
    delivery_lat: Annotated[float | None, Field(default=None, ge=-90, le=90)]
    delivery_lon: Annotated[float | None, Field(default=None, ge=-180, le=180, validate_default=True)]
    delivery_date: date
    delivery_time: time | None = None
    comment: Annotated[str | None, Field(default=None, max_length=1000)]
    # Bot'larga qarshi yashirin maydon: odam uchun doim bo'sh
    website: Annotated[str, Field(default="", max_length=200)]

    @field_validator("delivery_lon")
    @classmethod
    def _point(cls, lon: float | None, info: ValidationInfo) -> float | None:
        lat = info.data.get("delivery_lat")
        if not info.data.get("delivery_required", True):
            return None
        if (lat is None) != (lon is None):
            raise ValueError("Xaritadagi nuqta to‘liq emas.")
        if lat is not None and not in_service_area(lat, lon):
            raise ValueError("Tanlangan nuqta xizmat hududidan tashqarida.")
        return lon

    @field_validator("customer_name")
    @classmethod
    def _name(cls, value: str) -> str:
        return validate_person_name(value)

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str) -> str:
        return normalize_phone(value)

    @field_validator("volume_m3")
    @classmethod
    def _volume(cls, value: Decimal) -> Decimal:
        if value < settings.MIN_ORDER_VOLUME_M3:
            raise ValueError(f"Eng kam hajm — {settings.MIN_ORDER_VOLUME_M3} m³.")
        if value > settings.MAX_ORDER_VOLUME_M3:
            raise ValueError(
                f"Bitta buyurtmada ko‘pi bilan {settings.MAX_ORDER_VOLUME_M3} m³. "
                "Katta hajm uchun menejer bilan bog‘laning."
            )
        return value

    @field_validator("delivery_address")
    @classmethod
    def _address(cls, value: str | None, info: ValidationInfo) -> str | None:
        value = clean_text(value)
        if info.data.get("delivery_required", True):
            if not value or len(value) < 5:
                raise ValueError("Yetkazib berish manzilini kiriting.")
            return value
        return None  # o'zi olib ketsa manzil saqlanmaydi

    @field_validator("delivery_date")
    @classmethod
    def _date(cls, value: date) -> date:
        today = today_local()
        if value < today:
            raise ValueError("O‘tib ketgan sanani tanlab bo‘lmaydi.")
        if value > today + timedelta(days=settings.MAX_DELIVERY_DAYS_AHEAD):
            raise ValueError("Sana juda uzoq. Bir yil ichidagi sanani tanlang.")
        return value

    @field_validator("comment")
    @classmethod
    def _comment(cls, value: str | None) -> str | None:
        return clean_text(value)


class OrderCreated(OrmModel):
    """Mijozga qaytariladigan javob — faqat buyurtma raqami va holati.

    Summa qaytarilmaydi: narx ochiq emas, menejer mijozga telefon orqali aytadi.
    """

    order_number: str
    status: OrderStatus
