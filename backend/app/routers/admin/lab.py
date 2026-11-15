"""Laboratoriya: beton namunalari va siqilishga sinov natijalari.

Qoida (hisob-kitob, taxmin emas):
- kub 150×150×150 mm: mustahkamlik MPa = kuch (kN) / 22,5;
- "M300" markasi = 300 kgf/sm² ≈ 29,4 MPa (1 kgf/sm² = 0,0980665 MPa); "B25" sinfi = 25 MPa;
- namuna 28 kunlik sinovda maqsadli mustahkamlikka yetsa "O‘tdi", yetmasa "O‘tmadi"; 28 kunlik sinov bo‘lmasa — "Kutilmoqda".
  Boshqa yoshdagi (3, 7, 14 kun) natijalar faqat ko‘rsatiladi, ularga me’yor taxmin qilinmaydi.
"""
import re
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.deps import require
from app.models import ConcreteProduct, LabSample, LabTest, User
from app.permissions import Perm
from app.schemas.common import InputModel, clean_text
from app.services.orders import OrderError
from app.utils.timezone import today_local

router = APIRouter(prefix="/lab", tags=["Admin: laboratoriya"])
KGF_TO_MPA = Decimal("0.0980665")
CUBE_AREA_CM2_KN = Decimal("22.5")  # 150×150 mm = 22 500 mm² → kN / 22,5 = MPa
CONTROL_AGE = 28


def target_mpa(grade_class: str) -> float | None:
    m = re.match(r"^\s*([MmМм])\s*(\d{2,4})\s*$", grade_class or "")
    if m:
        return round(float(Decimal(m.group(2)) * KGF_TO_MPA), 1)
    b = re.match(r"^\s*([BbВв])\s*(\d{1,3}(?:[.,]\d)?)\s*$", grade_class or "")
    if b:
        return float(b.group(2).replace(",", "."))
    return None


def _f(v) -> float:
    return float(v or 0)


def _result(sample: LabSample) -> str:
    """pass / fail / pending / no_target"""
    target = target_mpa(sample.product.grade_class)
    control = next((t for t in sample.tests if t.age_days == CONTROL_AGE), None)
    if control is None:
        return "pending"
    if target is None:
        return "no_target"
    return "pass" if float(control.strength_mpa) >= target else "fail"


def _sample_out(s: LabSample) -> dict:
    today = today_local()
    result = _result(s)
    due = s.sampled_on + timedelta(days=CONTROL_AGE)
    return {
        "id": s.id, "sample_no": s.sample_no, "product_id": s.product_id, "grade_class": s.product.grade_class,
        "product_name": s.product.name, "order_id": s.order_id, "production_record_id": s.production_record_id,
        "sampled_on": s.sampled_on.isoformat(), "operator": s.operator,
        "slump_cm": _f(s.slump_cm) if s.slump_cm is not None else None, "notes": s.notes,
        "target_mpa": target_mpa(s.product.grade_class), "result": result,
        "control_due": due.isoformat(), "overdue": result == "pending" and due < today,
        "tests": [{"id": t.id, "age_days": t.age_days, "tested_on": t.tested_on.isoformat(), "force_kn": _f(t.force_kn),
                   "strength_mpa": _f(t.strength_mpa), "operator": t.operator, "notes": t.notes} for t in s.tests],
    }


def _get_sample(db: Session, sample_id: int) -> LabSample:
    s = db.scalar(select(LabSample).where(LabSample.id == sample_id).options(selectinload(LabSample.tests)).execution_options(populate_existing=True))
    if s is None:
        raise HTTPException(status_code=404, detail="Namuna topilmadi.")
    return s


class SampleIn(InputModel):
    product_id: int
    sampled_on: date
    operator: Annotated[str | None, Field(default=None, max_length=100)]
    slump_cm: Annotated[Decimal | None, Field(default=None, ge=0, le=30, max_digits=5, decimal_places=1)]
    order_id: int | None = None
    production_record_id: int | None = None
    notes: Annotated[str | None, Field(default=None, max_length=500)]

    @field_validator("operator", "notes")
    @classmethod
    def _clean(cls, v):
        return clean_text(v)


class TestIn(InputModel):
    age_days: Annotated[int, Field(ge=1, le=365)]
    tested_on: date
    force_kn: Annotated[Decimal, Field(gt=0, le=5000, max_digits=8, decimal_places=1)]
    operator: Annotated[str | None, Field(default=None, max_length=100)]
    notes: Annotated[str | None, Field(default=None, max_length=300)]

    @field_validator("operator", "notes")
    @classmethod
    def _clean(cls, v):
        return clean_text(v)


@router.get("/samples")
def list_samples(date_from: date | None = None, date_to: date | None = None, product_id: int | None = None,
                 result: str | None = None, limit: int = Query(300, le=1000), db: Session = Depends(get_db),
                 _: User = Depends(require(Perm.LAB_READ))):
    q = (select(LabSample).options(selectinload(LabSample.tests), selectinload(LabSample.product))
         .order_by(LabSample.sampled_on.desc(), LabSample.id.desc()).limit(limit))
    if date_from:
        q = q.where(LabSample.sampled_on >= date_from)
    if date_to:
        q = q.where(LabSample.sampled_on <= date_to)
    if product_id:
        q = q.where(LabSample.product_id == product_id)
    items = [_sample_out(s) for s in db.scalars(q)]
    if result:
        items = [i for i in items if i["result"] == result or (result == "overdue" and i["overdue"])]
    return {"items": items}


def _check_sample(db: Session, payload: SampleIn) -> None:
    if db.get(ConcreteProduct, payload.product_id) is None:
        raise OrderError("Beton markasi topilmadi.", field="product_id")
    if payload.sampled_on > today_local():
        raise OrderError("Kelajak sanasini kiritib bo‘lmaydi.", field="sampled_on")


@router.post("/samples", status_code=201)
def create_sample(payload: SampleIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.LAB_MANAGE))):
    _check_sample(db, payload)
    s = LabSample(**payload.model_dump(), sample_no="TMP", created_by_id=user.id)
    db.add(s)
    db.flush()
    s.sample_no = f"NAM-{s.sampled_on.year}-{s.id:05d}"
    db.commit()
    return _sample_out(_get_sample(db, s.id))


@router.put("/samples/{sample_id}")
def update_sample(sample_id: int, payload: SampleIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.LAB_MANAGE))):
    s = _get_sample(db, sample_id)
    _check_sample(db, payload)
    for k, v in payload.model_dump().items():
        setattr(s, k, v)
    db.commit()
    return _sample_out(_get_sample(db, sample_id))


@router.delete("/samples/{sample_id}", status_code=204)
def delete_sample(sample_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.LAB_MANAGE))):
    db.delete(_get_sample(db, sample_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/samples/{sample_id}/tests", status_code=201)
def add_test(sample_id: int, payload: TestIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.LAB_MANAGE))):
    s = _get_sample(db, sample_id)
    if payload.tested_on > today_local():
        raise OrderError("Kelajak sanasini kiritib bo‘lmaydi.", field="tested_on")
    if payload.tested_on < s.sampled_on:
        raise OrderError("Sinov sanasi namuna olingan sanadan oldin bo‘lishi mumkin emas.", field="tested_on")
    if any(t.age_days == payload.age_days for t in s.tests):
        raise HTTPException(status_code=409, detail=[{"loc": ["body", "age_days"], "msg": f"{payload.age_days} kunlik sinov allaqachon kiritilgan.", "type": "business_rule"}])
    mpa = (payload.force_kn / CUBE_AREA_CM2_KN).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    db.add(LabTest(sample_id=s.id, strength_mpa=mpa, **payload.model_dump()))
    db.commit()
    return _sample_out(_get_sample(db, sample_id))


@router.delete("/tests/{test_id}", status_code=204)
def delete_test(test_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.LAB_MANAGE))):
    t = db.get(LabTest, test_id)
    if t is None:
        raise HTTPException(status_code=404, detail="Sinov topilmadi.")
    db.delete(t)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/summary")
def summary(date_from: date | None = None, date_to: date | None = None, db: Session = Depends(get_db),
            _: User = Depends(require(Perm.LAB_READ))):
    today = today_local()
    date_to = date_to or today
    date_from = date_from or (date_to - timedelta(days=29))
    samples = list(db.scalars(
        select(LabSample).options(selectinload(LabSample.tests), selectinload(LabSample.product))
        .where(LabSample.sampled_on >= date_from - timedelta(days=CONTROL_AGE), LabSample.sampled_on <= date_to)
    ))
    in_period = [s for s in samples if s.sampled_on >= date_from]
    outs = [_sample_out(s) for s in samples]
    # Davr ichida o'tkazilgan 28 kunlik sinovlar bo'yicha natija
    controls = [(s, t) for s in samples for t in s.tests if t.age_days == CONTROL_AGE and date_from <= t.tested_on <= date_to]
    judged = [(s, t, target_mpa(s.product.grade_class)) for s, t in controls]
    judged = [(s, t, tg) for s, t, tg in judged if tg is not None]
    passed = sum(1 for _, t, tg in judged if float(t.strength_mpa) >= tg)
    tests_done = sum(1 for s in samples for t in s.tests if date_from <= t.tested_on <= date_to)

    by_grade: dict[str, dict] = {}
    for s, t, tg in judged:
        g = by_grade.setdefault(s.product.grade_class, {"grade_class": s.product.grade_class, "target_mpa": tg, "n": 0, "sum": 0.0, "min": None, "max": None})
        v = float(t.strength_mpa)
        g["n"] += 1
        g["sum"] += v
        g["min"] = v if g["min"] is None else min(g["min"], v)
        g["max"] = v if g["max"] is None else max(g["max"], v)
    grades = [{"grade_class": g["grade_class"], "target_mpa": g["target_mpa"], "n": g["n"], "avg_mpa": round(g["sum"] / g["n"], 2),
               "min_mpa": g["min"], "max_mpa": g["max"]} for g in sorted(by_grade.values(), key=lambda x: x["grade_class"])]
    return {
        "date_from": date_from.isoformat(), "date_to": date_to.isoformat(),
        "samples_today": sum(1 for s in samples if s.sampled_on == today),
        "samples_period": len(in_period),
        "tests_done": tests_done,
        "control_tests": len(judged),
        "pass_pct": round(100 * passed / len(judged), 1) if judged else None,
        "failed": len(judged) - passed,
        "pending": sum(1 for o in outs if o["result"] == "pending"),
        "overdue": sum(1 for o in outs if o["overdue"]),
        "by_grade": grades,
        "latest": next((_sample_out(s) for s in sorted((s for s in samples if s.tests), key=lambda s: max(t.tested_on for t in s.tests), reverse=True)), None),
    }
