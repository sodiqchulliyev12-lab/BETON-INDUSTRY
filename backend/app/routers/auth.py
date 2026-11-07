"""Admin panelga kirish.

- access token (qisqa muddatli) — javob tanasida; frontend uni faqat xotirada saqlaydi
- refresh token — httpOnly, SameSite=Strict cookie; JavaScript uni o'qiy olmaydi (XSS'dan himoya)
"""
from datetime import UTC, datetime

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import DUMMY_PASSWORD_HASH, TokenError, create_token, decode_token, verify_password
from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.limiter import limiter
from app.models import User
from app.permissions import permissions_for
from app.schemas.auth import LoginIn, MeOut, TokenOut, UserOut

router = APIRouter(prefix="/api/v1/auth", tags=["Kirish"])

REFRESH_COOKIE = "beton_refresh"
COOKIE_PATH = "/api/v1/auth"

_INVALID_CREDENTIALS = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login yoki parol noto‘g‘ri.")
_SESSION_EXPIRED = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessiya tugagan. Qaytadan kiring.")


def me_out(user: User) -> MeOut:
    return MeOut(**UserOut.model_validate(user).model_dump(), permissions=permissions_for(user.role))


def _issue_tokens(response: Response, user: User) -> TokenOut:
    refresh = create_token(user.id, user.role.value, "refresh", user.token_version)
    response.set_cookie(
        REFRESH_COOKIE,
        refresh,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        httponly=True,
        secure=settings.is_production,
        samesite="strict",
        path=COOKIE_PATH,
    )
    return TokenOut(
        access_token=create_token(user.id, user.role.value, "access", user.token_version),
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=me_out(user),
    )


@router.post("/login", response_model=TokenOut, summary="Tizimga kirish")
@limiter.limit("10/minute;50/hour")
def login(request: Request, payload: LoginIn, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    user = db.scalar(select(User).where(func.lower(User.username) == payload.username.strip().lower()))
    if user is None:
        verify_password(payload.password, DUMMY_PASSWORD_HASH)
        raise _INVALID_CREDENTIALS
    if not verify_password(payload.password, user.password_hash):
        raise _INVALID_CREDENTIALS
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Foydalanuvchi bloklangan. Administratorga murojaat qiling.")

    user.last_login_at = datetime.now(UTC)
    db.commit()
    return _issue_tokens(response, user)


@router.post("/refresh", response_model=TokenOut, summary="Access tokenni yangilash")
def refresh(
    response: Response,
    db: Session = Depends(get_db),
    refresh_token: str | None = Cookie(default=None, alias=REFRESH_COOKIE),
) -> TokenOut:
    if not refresh_token:
        raise _SESSION_EXPIRED
    try:
        payload = decode_token(refresh_token, "refresh")
    except TokenError:
        raise _SESSION_EXPIRED from None
    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active or payload.get("ver") != user.token_version:
        response.delete_cookie(REFRESH_COOKIE, path=COOKIE_PATH)
        raise _SESSION_EXPIRED
    return _issue_tokens(response, user)  # refresh token ham yangilanadi (rotation)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="Chiqish")
def logout(response: Response) -> Response:
    response.delete_cookie(REFRESH_COOKIE, path=COOKIE_PATH, secure=settings.is_production, httponly=True, samesite="strict")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=MeOut, summary="Joriy foydalanuvchi")
def me(user: User = Depends(get_current_user)) -> MeOut:
    return me_out(user)
