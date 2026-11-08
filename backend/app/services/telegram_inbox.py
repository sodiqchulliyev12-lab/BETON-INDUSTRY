"""Telegram guruhlaridan keladigan xabarlarni qabul qilish (webhook).

Xavfsizlik:
- Telegram har bir so'rovda maxfiy sarlavha yuboradi (X-Telegram-Bot-Api-Secret-Token); u SECRET_KEY'dan
  hosil qilinadi va mos kelmasa so'rov rad etiladi — begona odam soxta xabar yubora olmaydi;
- faqat guruh/superguruh/kanal xabarlari saqlanadi; shaxsiy chatlar e'tiborsiz qoldiriladi;
- "ignore" deb belgilangan guruh xabarlari saqlanmaydi.
"""
import hashlib
import hmac
import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import TelegramChat, TelegramMessage
from app.models.enums import ChatPurpose
from app.services import sheets

logger = logging.getLogger("beton.telegram.inbox")

GROUP_TYPES = {"group", "supergroup", "channel"}
# Media turlari avval tekshiriladi: izohli rasm "text" emas, "photo" deb belgilanadi
CONTENT_TYPES = ("photo", "document", "video", "voice", "audio", "sticker", "location", "contact", "text")


def webhook_secret() -> str:
    """Telegram setWebhook'dagi secret_token (faqat A-Z, a-z, 0-9, _ va -)."""
    digest = hmac.new(settings.SECRET_KEY.encode(), b"telegram-webhook", hashlib.sha256).hexdigest()
    return digest[:48]


def verify_secret(header_value: str | None) -> bool:
    return bool(header_value) and hmac.compare_digest(header_value, webhook_secret())


def webhook_url() -> str | None:
    return f"{settings.PUBLIC_BASE_URL}/api/v1/telegram/webhook" if settings.PUBLIC_BASE_URL else None


def _content(message: dict[str, Any]) -> tuple[str, str | None]:
    text = message.get("text") or message.get("caption")
    for kind in CONTENT_TYPES:
        if message.get(kind):
            return kind, text
    return "other", text


def _sender(message: dict[str, Any]) -> tuple[int | None, str | None]:
    user = message.get("from") or {}
    if user:
        name = " ".join(filter(None, [user.get("first_name"), user.get("last_name")])) or user.get("username")
        return user.get("id"), name
    chat = message.get("sender_chat") or {}  # kanal nomidan yozilgan xabar
    return None, chat.get("title")


def save_update(db: Session, update: dict[str, Any]) -> TelegramMessage | None:
    """Update'ni saqlaydi. Saqlangan (yoki yangilangan) xabarni qaytaradi; e'tiborsiz qoldirilsa None."""
    edited = False
    message = update.get("message") or update.get("channel_post")
    if message is None:
        message = update.get("edited_message") or update.get("edited_channel_post")
        edited = message is not None
    if not message:
        return None

    chat = message.get("chat") or {}
    if chat.get("type") not in GROUP_TYPES or chat.get("id") is None:
        return None  # shaxsiy chatlar saqlanmaydi

    db.execute(
        insert(TelegramChat)
        .values(chat_id=chat["id"], title=chat.get("title"), chat_type=chat["type"])
        .on_conflict_do_update(
            index_elements=[TelegramChat.chat_id],
            set_={"title": chat.get("title"), "chat_type": chat["type"], "updated_at": datetime.now(UTC)},
        )
    )
    group = db.get(TelegramChat, chat["id"])
    if group is None or not group.is_active or group.purpose == ChatPurpose.IGNORE:
        db.commit()
        return None

    content_type, text = _content(message)
    user_id, name = _sender(message)
    sent_at = datetime.fromtimestamp(int(message.get("date", 0)), tz=UTC)
    edited_at = datetime.fromtimestamp(int(message["edit_date"]), tz=UTC) if message.get("edit_date") else None

    existing = db.scalar(
        select(TelegramMessage).where(
            TelegramMessage.chat_id == chat["id"], TelegramMessage.message_id == message.get("message_id")
        )
    )
    if existing:
        if not edited:
            db.commit()
            return None  # Telegram bir xabarni qayta yuborgan — takrorlanmaydi
        existing.text = text
        existing.edited_at = edited_at or datetime.now(UTC)
        existing.sheets_status = "pending"
        record = existing
    else:
        record = TelegramMessage(
            chat_id=chat["id"],
            message_id=message.get("message_id"),
            from_user_id=user_id,
            from_name=name,
            content_type=content_type,
            text=text,
            sent_at=sent_at,
            edited_at=edited_at,
            sheets_status="pending" if group.purpose else "skipped",
        )
        db.add(record)
    db.commit()
    db.refresh(record)
    return record


def process_update(update: dict[str, Any]) -> None:
    """Fon vazifasi: saqlash + Google Sheets'ga yuborish. Hech qachon xato tashlamaydi."""
    try:
        with SessionLocal() as db:
            record = save_update(db, update)
            if record is not None and record.sheets_status == "pending":
                sheets.push_message(db, record)
    except Exception:
        logger.exception("Telegram update'ni qayta ishlashda xato")
