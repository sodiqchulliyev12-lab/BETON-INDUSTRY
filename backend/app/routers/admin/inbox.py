"""Telegram guruhlari, ularning xabarlari jurnali va Google Sheets ulanishi (faqat administrator).

Kassa-bank xabarlari moliyaviy va maxfiy — shuning uchun hamma endpointlar SETTINGS_WRITE talab qiladi.
"""
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require
from app.models import SystemSetting, TelegramChat, TelegramMessage, User
from app.models.enums import ChatPurpose
from app.permissions import Perm
from app.schemas.common import InputModel, Page
from app.services import sheets, telegram, telegram_inbox

router = APIRouter(prefix="/telegram", tags=["Admin: Telegram guruhlari va Google Sheets"])

PURPOSE_LABELS = {
    ChatPurpose.PRODUCTION: "Ishlab chiqarish",
    ChatPurpose.CASH: "Kassa va bank",
    ChatPurpose.MATERIALS: "Xomashyo kirimi",
    ChatPurpose.OTHER: "Boshqa",
    ChatPurpose.IGNORE: "E’tiborsiz (saqlanmaydi)",
}


def _error(message: str, field: str | None = None) -> HTTPException:
    detail = [{"loc": ["body", field], "msg": message, "type": "business_rule"}] if field else message
    return HTTPException(status_code=422, detail=detail)


# --- Guruhlar --------------------------------------------------------------

class ChatOut(BaseModel):
    chat_id: int
    title: str | None
    chat_type: str
    purpose: ChatPurpose | None
    is_active: bool
    messages_count: int
    pending_count: int
    last_message_at: datetime | None


class ChatUpdate(InputModel):
    purpose: ChatPurpose | None = None
    is_active: bool | None = None


@router.get("/chats", response_model=list[ChatOut])
def list_chats(db: Session = Depends(get_db), _: User = Depends(require(Perm.SETTINGS_WRITE))):
    stats = dict(
        (row[0], row[1:])
        for row in db.execute(
            select(
                TelegramMessage.chat_id,
                func.count(),
                func.count().filter(TelegramMessage.sheets_status.in_(("pending", "failed"))),
                func.max(TelegramMessage.sent_at),
            ).group_by(TelegramMessage.chat_id)
        )
    )
    chats = db.scalars(select(TelegramChat).order_by(TelegramChat.created_at)).all()
    return [
        ChatOut(
            chat_id=c.chat_id, title=c.title, chat_type=c.chat_type, purpose=c.purpose, is_active=c.is_active,
            messages_count=stats.get(c.chat_id, (0, 0, None))[0],
            pending_count=stats.get(c.chat_id, (0, 0, None))[1],
            last_message_at=stats.get(c.chat_id, (0, 0, None))[2],
        )
        for c in chats
    ]


@router.patch("/chats/{chat_id}", response_model=ChatOut)
def update_chat(chat_id: int, payload: ChatUpdate, db: Session = Depends(get_db), user: User = Depends(require(Perm.SETTINGS_WRITE))):
    chat = db.get(TelegramChat, chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Guruh topilmadi.")
    fields = payload.model_fields_set
    if "purpose" in fields:
        chat.purpose = payload.purpose
        # Vazifa belgilangach, oldin saqlangan xabarlar ham jadvalga yuboriladi
        if payload.purpose and payload.purpose != ChatPurpose.IGNORE:
            db.query(TelegramMessage).filter(
                TelegramMessage.chat_id == chat_id, TelegramMessage.sheets_status == "skipped"
            ).update({"sheets_status": "pending"})
    if "is_active" in fields and payload.is_active is not None:
        chat.is_active = payload.is_active
    db.commit()
    if "purpose" in fields and payload.purpose and payload.purpose != ChatPurpose.IGNORE:
        sheets.push_pending(db, chat_id=chat_id)
    return next(c for c in list_chats(db, user) if c.chat_id == chat_id)


# --- Xabarlar jurnali ------------------------------------------------------

class MessageOut(BaseModel):
    id: int
    chat_id: int
    chat_title: str | None
    message_id: int
    from_name: str | None
    content_type: str
    text: str | None
    sent_at: datetime
    edited_at: datetime | None
    sheets_status: str
    sheets_error: str | None
    link: str | None


@router.get("/messages", response_model=Page[MessageOut])
def list_messages(
    db: Session = Depends(get_db),
    _: User = Depends(require(Perm.SETTINGS_WRITE)),
    chat_id: int | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 30,
):
    stmt = select(TelegramMessage, TelegramChat.title).join(TelegramChat)
    if chat_id is not None:
        stmt = stmt.where(TelegramMessage.chat_id == chat_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(TelegramMessage.sent_at.desc(), TelegramMessage.id.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    items = [
        MessageOut(
            id=m.id, chat_id=m.chat_id, chat_title=title, message_id=m.message_id, from_name=m.from_name,
            content_type=m.content_type, text=m.text, sent_at=m.sent_at, edited_at=m.edited_at,
            sheets_status=m.sheets_status, sheets_error=m.sheets_error, link=sheets.message_link(m.chat_id, m.message_id),
        )
        for m, title in rows
    ]
    return Page(items=items, total=total, page=page, page_size=page_size)


# --- Webhook holati --------------------------------------------------------

@router.get("/webhook")
def get_webhook(_: User = Depends(require(Perm.SETTINGS_WRITE))) -> dict:
    expected = telegram_inbox.webhook_url()
    if not telegram.token_configured():
        return {"configured": False, "expected_url": expected, "reason": "Bot tokeni sozlanmagan."}
    try:
        info = telegram.webhook_info()
    except telegram.TelegramError as exc:
        return {"configured": False, "expected_url": expected, "reason": str(exc)}
    return {
        "configured": bool(expected) and info.get("url") == expected,
        "expected_url": expected,
        "pending_update_count": info.get("pending_update_count", 0),
        "last_error_message": info.get("last_error_message"),
        "last_error_date": info.get("last_error_date"),
    }


@router.post("/webhook")
def install_webhook(_: User = Depends(require(Perm.SETTINGS_WRITE))) -> dict:
    url = telegram_inbox.webhook_url()
    if not url:
        raise _error("PUBLIC_BASE_URL sozlanmagan — Telegram xabarlarni qayerga yuborishini bilmaydi.")
    try:
        telegram.set_webhook(url, telegram_inbox.webhook_secret())
    except telegram.TelegramError as exc:
        raise _error(str(exc)) from None
    return {"ok": True, "url": url}


# --- Google Sheets ---------------------------------------------------------

class SheetsIn(InputModel):
    url: Annotated[str | None, Field(default=None, max_length=300)]

    @field_validator("url")
    @classmethod
    def _url(cls, value: str | None) -> str | None:
        if value is None or not value.strip():
            return None
        value = value.strip()
        if not value.startswith("https://script.google.com/macros/s/") or not value.endswith("/exec"):
            raise ValueError("URL https://script.google.com/macros/s/.../exec ko‘rinishida bo‘lishi kerak (Deploy → Web app URL).")
        return value


@router.get("/sheets")
def get_sheets(db: Session = Depends(get_db), _: User = Depends(require(Perm.SETTINGS_WRITE))) -> dict:
    pending = db.scalar(
        select(func.count()).select_from(TelegramMessage).where(TelegramMessage.sheets_status.in_(("pending", "failed")))
    ) or 0
    return {
        "url": sheets.get_url(db),
        "script": sheets.script_text(),
        "sheet_names": {k.value: v for k, v in sheets.SHEET_NAMES.items()},
        "pending": pending,
        "purpose_labels": {k.value: v for k, v in PURPOSE_LABELS.items()},
    }


@router.put("/sheets")
def save_sheets(payload: SheetsIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.SETTINGS_WRITE))) -> dict:
    if payload.url:
        try:
            sheets.test_connection(payload.url)
        except sheets.SheetsError as exc:
            raise _error(f"Jadvalga ulanib bo‘lmadi: {exc}", "url") from None
    row = db.get(SystemSetting, sheets.URL_SETTING)
    if row is None:
        row = SystemSetting(key=sheets.URL_SETTING, is_public=False, description="Google Sheets Apps Script veb-ilova URL")
        db.add(row)
    row.value = payload.url
    row.updated_by_id = user.id
    db.commit()
    result = sheets.push_pending(db) if payload.url else {"sent": 0, "failed": 0}
    return {"ok": True, "pushed": result}


@router.post("/sheets/resync")
def resync(db: Session = Depends(get_db), _: User = Depends(require(Perm.SETTINGS_WRITE))) -> dict:
    if not sheets.get_url(db):
        raise _error("Avval Google Sheets URL'ini kiriting.")
    return sheets.push_pending(db)
