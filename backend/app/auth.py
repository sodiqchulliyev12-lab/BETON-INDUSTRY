"""Parollarni hash qilish va JWT tokenlar.

Login endpointlari va rol tekshiruvi 3-bosqichda shu modul ustiga quriladi.
"""
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import jwt
from pwdlib import PasswordHash

from app.config import settings

TokenType = Literal["access", "refresh"]

_password_hasher = PasswordHash.recommended()  # Argon2id


class TokenError(Exception):
    """Token yaroqsiz, muddati o'tgan yoki turi noto'g'ri."""


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _password_hasher.verify(password, password_hash)
    except Exception:  # noto'g'ri formatdagi hash — kirish rad etiladi
        return False


def password_problems(password: str) -> list[str]:
    """Parol siyosati: kamida 10 belgi, harf va raqam."""
    problems = []
    if len(password) < 10:
        problems.append("kamida 10 ta belgi")
    if not any(ch.isalpha() for ch in password):
        problems.append("kamida bitta harf")
    if not any(ch.isdigit() for ch in password):
        problems.append("kamida bitta raqam")
    return problems


def create_token(user_id: int, role: str, token_type: TokenType = "access", version: int = 0) -> str:
    now = datetime.now(UTC)
    lifetime = (
        timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        if token_type == "access"
        else timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    )
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "role": role,
        "type": token_type,
        "ver": version,
        "iat": now,
        "exp": now + lifetime,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str, expected_type: TokenType = "access") -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise TokenError("Token yaroqsiz yoki muddati o'tgan.") from exc
    if payload.get("type") != expected_type or not str(payload.get("sub", "")).isdigit():
        raise TokenError("Token turi noto'g'ri.")
    return payload


# Foydalanuvchi topilmaganda ham parol tekshirilgandek vaqt sarflanadi (login mavjudligini taxmin qilib bo'lmasin)
DUMMY_PASSWORD_HASH = _password_hasher.hash("dummy-password-for-timing-only-1")
