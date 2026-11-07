"""Himoyalangan endpointlar uchun dependency'lar: joriy foydalanuvchi va ruxsat tekshiruvi."""
from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth import TokenError, decode_token
from app.database import get_db
from app.models import User
from app.permissions import Perm, has_perm

_bearer = HTTPBearer(auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Tizimga kirish talab qilinadi.",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _UNAUTHORIZED
    try:
        payload = decode_token(credentials.credentials, "access")
    except TokenError:
        raise _UNAUTHORIZED from None

    user = db.get(User, int(payload["sub"]))
    # Bloklangan, o'chirilgan yoki paroli almashtirilgan foydalanuvchining eski tokeni ishlamaydi
    if user is None or not user.is_active or payload.get("ver") != user.token_version:
        raise _UNAUTHORIZED
    return user


def require(perm: Perm) -> Callable[..., User]:
    """Endpointga ruxsat talabini qo'shadi: Depends(require(Perm.ORDERS_READ))."""

    def checker(user: User = Depends(get_current_user)) -> User:
        if not has_perm(user.role, perm):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bu amal uchun ruxsatingiz yo‘q.")
        return user

    return checker
