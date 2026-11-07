"""Tizim sozlamalari: kompaniya ma'lumotlari va ishlab chiqarish quvvati.

Faqat migratsiyada yaratilgan kalitlarni o'zgartirish mumkin — yangi kalit qo'shib bo'lmaydi.
"""
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require
from app.models import SystemSetting, User
from app.permissions import Perm
from app.schemas.common import clean_text

router = APIRouter(prefix="/settings", tags=["Admin: tizim sozlamalari"])

NUMERIC_KEYS = {"production.capacity_m3_per_day"}
# Koordinatalar: (eng kichik, eng katta)
COORD_KEYS = {"company.latitude": (-90, 90), "company.longitude": (-180, 180)}
LONG_TEXT_KEYS = {"about.text": 5000}
DEFAULT_TEXT_LIMIT = 300


class SettingOut(BaseModel):
    key: str
    value: Any
    is_public: bool
    description: str | None


def _normalize(key: str, value: Any) -> Any:
    """Bo'sh qiymat → None ("kiritilmagan"). Raqamli kalitlar musbat son bo'lishi kerak."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    if key in COORD_KEYS:
        try:
            number = float(str(value).replace(",", ".").strip())
        except ValueError:
            raise ValueError("Koordinata raqam bo‘lishi kerak (masalan 41.311081).") from None
        low, high = COORD_KEYS[key]
        if not (low <= number <= high):
            raise ValueError(f"Koordinata {low} va {high} oralig‘ida bo‘lishi kerak.")
        return round(number, 6)
    if key in NUMERIC_KEYS:
        try:
            number = Decimal(str(value).replace(",", ".").strip())
        except InvalidOperation:
            raise ValueError("Raqam kiriting.") from None
        if not number.is_finite() or number <= 0:
            raise ValueError("Musbat son kiriting yoki maydonni bo‘sh qoldiring.")
        return float(number)
    if not isinstance(value, str):
        raise ValueError("Matn kiriting.")
    text = clean_text(value)
    limit = LONG_TEXT_KEYS.get(key, DEFAULT_TEXT_LIMIT)
    if text and len(text) > limit:
        raise ValueError(f"Matn juda uzun (ko‘pi bilan {limit} belgi).")
    return text


@router.get("", response_model=list[SettingOut])
def list_settings(db: Session = Depends(get_db), _: User = Depends(require(Perm.SETTINGS_READ))):
    rows = db.scalars(select(SystemSetting).order_by(SystemSetting.key)).all()
    return [SettingOut(key=r.key, value=r.value, is_public=r.is_public, description=r.description) for r in rows]


@router.put("", response_model=list[SettingOut])
def update_settings(
    values: Annotated[dict[str, Any], Body(embed=True)],
    db: Session = Depends(get_db),
    user: User = Depends(require(Perm.SETTINGS_WRITE)),
):
    rows = {r.key: r for r in db.scalars(select(SystemSetting).where(SystemSetting.key.in_(list(values))))}
    errors = []
    for key, raw in values.items():
        if key not in rows:
            errors.append({"loc": ["body", "values", key], "msg": "Noma’lum sozlama.", "type": "unknown_key"})
            continue
        try:
            normalized = _normalize(key, raw)
        except ValueError as exc:
            errors.append({"loc": ["body", "values", key], "msg": str(exc), "type": "value_error"})
            continue
        rows[key].value = normalized
        rows[key].updated_by_id = user.id
    # Zavod joylashuvi: ikkala koordinata birga kiritiladi yoki ikkalasi ham bo'sh
    lat_row, lon_row = rows.get("company.latitude"), rows.get("company.longitude")
    if lat_row is not None and lon_row is not None and not errors and (lat_row.value is None) != (lon_row.value is None):
        missing = "company.longitude" if lon_row.value is None else "company.latitude"
        errors.append({"loc": ["body", "values", missing], "msg": "Ikkala koordinatani ham kiriting.", "type": "value_error"})
    if errors:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=errors)
    db.commit()
    return list_settings(db, user)
