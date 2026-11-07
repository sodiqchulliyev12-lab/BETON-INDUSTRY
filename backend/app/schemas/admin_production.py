from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

from app.models.enums import PlanStatus, QcStatus
from app.schemas.common import InputModel, JsonDecimal, clean_text


class PlanIn(InputModel):
    plan_date: date
    product_id: int
    order_id: int | None = None
    planned_volume_m3: Annotated[Decimal, Field(gt=0, max_digits=8, decimal_places=1)]
    status: PlanStatus = PlanStatus.PLANNED
    notes: Annotated[str | None, Field(default=None, max_length=1000)]

    @field_validator("notes")
    @classmethod
    def _clean(cls, v: str | None) -> str | None:
        return clean_text(v)


class PlanOut(BaseModel):
    id: int
    plan_date: date
    product_id: int
    grade_class: str
    product_name: str
    order_id: int | None
    order_number: str | None
    planned_volume_m3: JsonDecimal
    produced_volume_m3: JsonDecimal
    status: PlanStatus
    notes: str | None
    created_by: str | None
    created_at: datetime


class RecordIn(InputModel):
    plan_id: int | None = None
    order_id: int | None = None
    product_id: int | None = None  # reja tanlansa, marka rejadan olinadi
    batch_number: Annotated[str | None, Field(default=None, max_length=50)]
    produced_volume_m3: Annotated[Decimal, Field(gt=0, max_digits=8, decimal_places=1)]
    produced_at: datetime | None = None  # bo'sh bo'lsa — hozirgi vaqt

    @field_validator("batch_number")
    @classmethod
    def _clean(cls, v: str | None) -> str | None:
        return clean_text(v)


class QcIn(InputModel):
    qc_status: QcStatus
    qc_notes: Annotated[str | None, Field(default=None, max_length=1000)]

    @field_validator("qc_notes")
    @classmethod
    def _clean(cls, v: str | None) -> str | None:
        return clean_text(v)


class RecordOut(BaseModel):
    id: int
    plan_id: int | None
    order_id: int | None
    order_number: str | None
    product_id: int
    grade_class: str
    product_name: str
    batch_number: str | None
    produced_volume_m3: JsonDecimal
    produced_at: datetime
    qc_status: QcStatus
    qc_notes: str | None
    qc_by: str | None
    qc_at: datetime | None
    created_by: str | None


class ProductDaySummary(BaseModel):
    grade_class: str
    product_name: str
    planned_m3: JsonDecimal
    produced_m3: JsonDecimal


class ProductionSummary(BaseModel):
    date: date
    # None — quvvat belgilanmagan; tizim uni taxmin qilmaydi
    capacity_m3_per_day: JsonDecimal | None
    planned_m3: JsonDecimal
    utilization_percent: JsonDecimal | None
    produced_m3: JsonDecimal
    qc_passed_m3: JsonDecimal
    qc_failed_m3: JsonDecimal
    qc_pending_m3: JsonDecimal
    loaded_m3: JsonDecimal
    delivered_m3: JsonDecimal
    open_orders: int
    open_orders_remaining_m3: JsonDecimal
    by_product: list[ProductDaySummary]
