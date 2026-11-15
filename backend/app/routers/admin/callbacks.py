from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require
from app.models import CallbackRequest, User
from app.models.enums import CallbackStatus
from app.permissions import Perm
from app.schemas.admin_people import CallbackOut, CallbackStatusIn
from app.schemas.common import Page

router = APIRouter(prefix="/callbacks", tags=["Admin: qayta qo'ng'iroqlar"])



def _day_bounds(date_from, date_to):
    """Mahalliy kun chegaralari (UTC'ga o'tkazilgan): [from 00:00, to+1 00:00)."""
    from datetime import datetime as _dt, time as _t, timedelta as _td

    from app.utils.timezone import local_tz

    lo = _dt.combine(date_from, _t.min, tzinfo=local_tz()) if date_from else None
    hi = _dt.combine(date_to + _td(days=1), _t.min, tzinfo=local_tz()) if date_to else None
    return lo, hi


@router.get("", response_model=Page[CallbackOut])
def list_callbacks(
    db: Session = Depends(get_db),
    _: User = Depends(require(Perm.CALLBACKS_MANAGE)),
    status: CallbackStatus | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    stmt = select(CallbackRequest)
    if status:
        stmt = stmt.where(CallbackRequest.status == status)
    lo, hi = _day_bounds(date_from, date_to)
    if lo:
        stmt = stmt.where(CallbackRequest.created_at >= lo)
    if hi:
        stmt = stmt.where(CallbackRequest.created_at < hi)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(
        stmt.order_by(CallbackRequest.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return Page(items=[CallbackOut.model_validate(i) for i in items], total=total, page=page, page_size=page_size)


@router.patch("/{callback_id}", response_model=CallbackOut)
def update_callback(
    callback_id: int, payload: CallbackStatusIn, db: Session = Depends(get_db),
    user: User = Depends(require(Perm.CALLBACKS_MANAGE)),
):
    item = db.get(CallbackRequest, callback_id)
    if item is None:
        raise HTTPException(status_code=404, detail="So‘rov topilmadi.")
    item.status = payload.status
    if payload.status in (CallbackStatus.DONE, CallbackStatus.SPAM):
        item.processed_at, item.processed_by_id = datetime.now(UTC), user.id
    else:
        item.processed_at, item.processed_by_id = None, None
    db.commit()
    db.refresh(item)
    return item
