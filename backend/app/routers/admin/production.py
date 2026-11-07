from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require
from app.models import User
from app.permissions import Perm
from app.schemas.admin_production import PlanIn, PlanOut, ProductionSummary, QcIn, RecordIn, RecordOut
from app.services import production
from app.utils.timezone import today_local

router = APIRouter(prefix="/production", tags=["Admin: ishlab chiqarish"])


def _plan(db: Session, plan_id: int):
    try:
        return production.get_plan(db, plan_id)
    except production.NotFound:
        raise HTTPException(status_code=404, detail="Reja topilmadi.") from None


def _record(db: Session, record_id: int):
    try:
        return production.get_record(db, record_id)
    except production.NotFound:
        raise HTTPException(status_code=404, detail="Yozuv topilmadi.") from None


def _plan_out(db: Session, plan) -> PlanOut:
    return next(p for p in production.list_plans(db, plan.plan_date, plan.plan_date) if p.id == plan.id)


@router.get("/summary", response_model=ProductionSummary)
def get_summary(
    db: Session = Depends(get_db), _: User = Depends(require(Perm.PRODUCTION_READ)),
    day: Annotated[date | None, Query(alias="date")] = None,
):
    return production.summary(db, day or today_local())


@router.get("/plans", response_model=list[PlanOut])
def list_plans(
    db: Session = Depends(get_db), _: User = Depends(require(Perm.PRODUCTION_READ)),
    date_from: date | None = None, date_to: date | None = None,
):
    start = date_from or today_local()
    end = date_to or start
    if end < start or end - start > timedelta(days=92):
        raise HTTPException(status_code=422, detail="Sana oralig‘i noto‘g‘ri (ko‘pi bilan 3 oy).")
    return production.list_plans(db, start, end)


@router.post("/plans", response_model=PlanOut, status_code=status.HTTP_201_CREATED)
def create_plan(payload: PlanIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.PRODUCTION_MANAGE))):
    return _plan_out(db, production.save_plan(db, payload, user))


@router.put("/plans/{plan_id}", response_model=PlanOut)
def update_plan(plan_id: int, payload: PlanIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.PRODUCTION_MANAGE))):
    return _plan_out(db, production.save_plan(db, payload, user, _plan(db, plan_id)))


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(plan_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.PRODUCTION_MANAGE))):
    production.delete_plan(db, _plan(db, plan_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/records", response_model=list[RecordOut])
def list_records(
    db: Session = Depends(get_db), _: User = Depends(require(Perm.PRODUCTION_READ)),
    day: Annotated[date | None, Query(alias="date")] = None,
):
    return production.list_records(db, day or today_local())


def _record_out(db: Session, record) -> RecordOut:
    from app.utils.timezone import local_tz

    day = record.produced_at.astimezone(local_tz()).date()
    return next(r for r in production.list_records(db, day) if r.id == record.id)


@router.post("/records", response_model=RecordOut, status_code=status.HTTP_201_CREATED)
def create_record(payload: RecordIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.PRODUCTION_MANAGE))):
    try:
        record = production.create_record(db, payload, user)
    except production.NotFound:
        raise HTTPException(status_code=422, detail=[{"loc": ["body", "plan_id"], "msg": "Reja topilmadi.", "type": "not_found"}]) from None
    return _record_out(db, record)


@router.post("/records/{record_id}/qc", response_model=RecordOut)
def set_qc(record_id: int, payload: QcIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.PRODUCTION_MANAGE))):
    return _record_out(db, production.set_qc(db, _record(db, record_id), payload, user))


@router.delete("/records/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_record(record_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.PRODUCTION_MANAGE))):
    production.delete_record(db, _record(db, record_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
