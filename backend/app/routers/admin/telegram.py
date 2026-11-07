"""Telegram sozlamalari (faqat administrator o'zgartiradi). Bot tokeni bu yerda emas — .env faylida."""
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import require
from app.models import NotificationLog, TelegramSettings, User
from app.permissions import Perm
from app.schemas.common import InputModel
from app.services import telegram

router = APIRouter(prefix="/telegram", tags=["Admin: Telegram"])

MAX_CHATS = 10


class TelegramSettingsIn(InputModel):
    is_enabled: bool
    chat_ids: Annotated[list[str], Field(max_length=MAX_CHATS)]
    notify_new_order: bool = True
    notify_status_change: bool = False
    notify_callback: bool = True
    message_template: Annotated[str | None, Field(default=None, max_length=2000)]

    @field_validator("chat_ids")
    @classmethod
    def _chats(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        for raw in values:
            value = raw.strip()
            if not value:
                continue
            if not telegram.CHAT_ID_RE.match(value):
                raise ValueError(f"«{value}» — chat ID noto‘g‘ri. Raqam (masalan -1001234567890) yoki @kanal_nomi bo‘lishi kerak.")
            if value not in cleaned:
                cleaned.append(value)
        return cleaned

    @field_validator("message_template")
    @classmethod
    def _template(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        telegram.validate_template(value)
        return value.strip()


class LogOut(BaseModel):
    id: int
    event: str
    recipient: str
    status: str
    error: str | None
    order_id: int | None
    created_at: datetime


class TelegramOut(BaseModel):
    token_configured: bool
    public_base_url: str | None
    is_enabled: bool
    chat_ids: list[str]
    notify_new_order: bool
    notify_status_change: bool
    notify_callback: bool
    message_template: str | None
    default_template: str
    template_fields: dict[str, str]
    logs: list[LogOut]


class TestIn(InputModel):
    chat_id: str | None = None


class TestResult(BaseModel):
    chat_id: str
    ok: bool
    error: str | None


def _config(db: Session) -> TelegramSettings:
    cfg = db.get(TelegramSettings, 1)
    if cfg is None:  # migratsiya qatorni yaratadi; ehtiyot uchun
        cfg = TelegramSettings(id=1)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def _out(db: Session, cfg: TelegramSettings) -> TelegramOut:
    logs = db.scalars(
        select(NotificationLog).where(NotificationLog.channel == "telegram").order_by(NotificationLog.id.desc()).limit(20)
    ).all()
    return TelegramOut(
        token_configured=telegram.token_configured(),
        public_base_url=settings.PUBLIC_BASE_URL,
        is_enabled=cfg.is_enabled,
        chat_ids=list(cfg.chat_ids or []),
        notify_new_order=cfg.notify_new_order,
        notify_status_change=cfg.notify_status_change,
        notify_callback=cfg.notify_callback,
        message_template=cfg.message_template,
        default_template=telegram.DEFAULT_ORDER_TEMPLATE,
        template_fields=telegram.TEMPLATE_FIELDS,
        logs=[LogOut.model_validate(log, from_attributes=True) for log in logs],
    )


def _bad_request(message: str, field: str | None = None) -> HTTPException:
    detail = [{"loc": ["body", field], "msg": message, "type": "business_rule"}] if field else message
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


@router.get("", response_model=TelegramOut)
def get_telegram(db: Session = Depends(get_db), _: User = Depends(require(Perm.SETTINGS_READ))):
    return _out(db, _config(db))


@router.put("", response_model=TelegramOut)
def update_telegram(payload: TelegramSettingsIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.SETTINGS_WRITE))):
    if payload.is_enabled and not payload.chat_ids:
        raise _bad_request("Xabarnomalarni yoqish uchun kamida bitta chat ID kiriting.", "chat_ids")
    cfg = _config(db)
    for key, value in payload.model_dump().items():
        setattr(cfg, key, value)
    cfg.updated_by_id = user.id
    db.commit()
    db.refresh(cfg)
    return _out(db, cfg)


@router.post("/test", response_model=list[TestResult])
def send_test(payload: TestIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.SETTINGS_WRITE))):
    """Sinov xabari. Xabarnomalar o'chirilgan bo'lsa ham ishlaydi — yoqishdan oldin tekshirish uchun."""
    if not telegram.token_configured():
        raise _bad_request("Bot tokeni sozlanmagan. Serverdagi .env fayliga TELEGRAM_BOT_TOKEN qo‘shing va serverni qayta ishga tushiring.")
    if payload.chat_id:
        if not telegram.CHAT_ID_RE.match(payload.chat_id.strip()):
            raise _bad_request("Chat ID noto‘g‘ri.", "chat_id")
        chats = [payload.chat_id.strip()]
    else:
        chats = list(_config(db).chat_ids or [])
    if not chats:
        raise _bad_request("Avval chat ID kiriting va saqlang.", "chat_ids")
    text = (
        "✅ <b>BETON INDUSTRY</b>: sinov xabari.\n"
        f"Yubordi: {telegram._e(user.full_name)}.\n"
        "Bu chatga yangi buyurtmalar haqida xabarlar keladi."
    )
    results = telegram.deliver(db, "test", text, chats)
    return [TestResult(chat_id=r.chat_id, ok=r.ok, error=r.error) for r in results]


@router.post("/bot-info")
def bot_info(_: User = Depends(require(Perm.SETTINGS_WRITE))) -> dict:
    """Token to'g'riligini tekshirish: bot nomini qaytaradi."""
    try:
        me = telegram.get_me()
    except telegram.TelegramError as exc:
        raise _bad_request(str(exc)) from None
    return {"username": me.get("username"), "first_name": me.get("first_name")}


@router.post("/discover-chats")
def discover_chats(_: User = Depends(require(Perm.SETTINGS_WRITE))) -> list[dict]:
    """Botga yaqinda yozgan chatlar ro'yxati — chat ID'ni topish uchun."""
    try:
        return telegram.recent_chats()
    except telegram.TelegramError as exc:
        raise _bad_request(str(exc)) from None
