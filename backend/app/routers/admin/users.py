"""Foydalanuvchilarni boshqarish (faqat administrator)."""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.database import get_db
from app.deps import require
from app.models import User
from app.models.enums import UserRole
from app.permissions import Perm
from app.schemas.admin_people import PasswordReset, UserCreate, UserUpdate
from app.schemas.auth import UserOut

router = APIRouter(prefix="/users", tags=["Admin: foydalanuvchilar"])


def _error(field: str, message: str, code: int = status.HTTP_422_UNPROCESSABLE_CONTENT) -> HTTPException:
    return HTTPException(status_code=code, detail=[{"loc": ["body", field], "msg": message, "type": "business_rule"}])


def _active_admins(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(User).where(User.role == UserRole.ADMIN, User.is_active.is_(True))) or 0


def _load(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Foydalanuvchi topilmadi.")
    return user


@router.get("", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(require(Perm.USERS_MANAGE))):
    return db.scalars(select(User).order_by(User.is_active.desc(), User.full_name)).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: Session = Depends(get_db), _: User = Depends(require(Perm.USERS_MANAGE))):
    if db.scalar(select(User.id).where(func.lower(User.username) == payload.username)):
        raise _error("username", "Bu login band.", status.HTTP_409_CONFLICT)
    user = User(
        username=payload.username,
        full_name=payload.full_name,
        role=payload.role,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int, payload: UserUpdate, db: Session = Depends(get_db), current: User = Depends(require(Perm.USERS_MANAGE))
):
    user = _load(db, user_id)
    fields = payload.model_fields_set
    losing_admin = user.role == UserRole.ADMIN and user.is_active and (
        ("role" in fields and payload.role not in (None, UserRole.ADMIN))
        or ("is_active" in fields and payload.is_active is False)
    )
    if user.id == current.id and losing_admin:
        raise _error("role", "O‘zingizning administrator huquqingizni olib tashlay olmaysiz.")
    if losing_admin and _active_admins(db) <= 1:
        raise _error("role", "Tizimda kamida bitta faol administrator qolishi kerak.")

    if "full_name" in fields and payload.full_name:
        user.full_name = payload.full_name
    if "role" in fields and payload.role and payload.role != user.role:
        user.role = payload.role
        user.token_version += 1  # yangi rol darhol kuchga kirsin
    if "is_active" in fields and payload.is_active is not None and payload.is_active != user.is_active:
        user.is_active = payload.is_active
        user.token_version += 1  # bloklanganda sessiyalari darhol tugaydi
    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    user_id: int, payload: PasswordReset, db: Session = Depends(get_db), _: User = Depends(require(Perm.USERS_MANAGE))
):
    user = _load(db, user_id)
    user.password_hash = hash_password(payload.password)
    user.token_version += 1  # barcha qurilmalardagi sessiyalar tugaydi
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
