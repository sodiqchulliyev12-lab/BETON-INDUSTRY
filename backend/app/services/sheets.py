"""Google Sheets bilan bog'lanish — Google Apps Script veb-ilovasi orqali.

Nega Apps Script: Google Cloud loyihasi, servis akkaunt va JSON kalit kerak emas. Admin jadval ichiga
tayyor skriptni joylab "Deploy" qiladi va hosil bo'lgan URL'ni admin panelga kiritadi.
Har bir so'rovda maxfiy kalit yuboriladi (SECRET_KEY'dan hosil qilinadi) — skript boshqa so'rovlarni rad etadi.

Bir xabar tahrirlansa, jadvaldagi qator yangilanadi (kalit: chat_id:message_id) — takrorlanmaydi.
"""
import hashlib
import hmac
import logging
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import SystemSetting, TelegramChat, TelegramMessage
from app.models.enums import ChatPurpose
from app.utils.timezone import local_tz

logger = logging.getLogger("beton.sheets")

http_transport: httpx.BaseTransport | None = None  # testlarda soxta transport

URL_SETTING = "integrations.sheets_webhook_url"
SCRIPT_TEMPLATE = Path(__file__).resolve().parent.parent / "google-apps-script.gs"

SHEET_NAMES: dict[ChatPurpose, str] = {
    ChatPurpose.PRODUCTION: "Xom — Ishlab chiqarish",
    ChatPurpose.CASH: "Xom — Kassa-Bank",
    ChatPurpose.MATERIALS: "Xom — Xomashyo kirimi",
    ChatPurpose.OTHER: "Xom — Boshqa",
}
HEADERS = ["Sana", "Vaqt", "Guruh", "Yozgan", "Xabar", "Turi", "Tahrirlangan", "Telegram havola", "Kalit"]


class SheetsError(Exception):
    pass


def secret() -> str:
    return hmac.new(settings.SECRET_KEY.encode(), b"google-sheets", hashlib.sha256).hexdigest()[:40]


def get_url(db: Session) -> str | None:
    value = db.scalar(select(SystemSetting.value).where(SystemSetting.key == URL_SETTING))
    return value if isinstance(value, str) and value.startswith("https://script.google.com/") else None


def script_text() -> str:
    """Admin jadvalga joylaydigan Apps Script — maxfiy kalit ichiga qo'yilgan holda."""
    return SCRIPT_TEMPLATE.read_text(encoding="utf-8").replace("{{SECRET}}", secret())


def message_link(chat_id: int, message_id: int) -> str | None:
    """Superguruh xabariga havola: https://t.me/c/<ichki id>/<xabar>. Oddiy guruhda havola bo'lmaydi."""
    text = str(chat_id)
    return f"https://t.me/c/{text[4:]}/{message_id}" if text.startswith("-100") else None


def row_for(message: TelegramMessage, chat: TelegramChat) -> list[Any]:
    local = message.sent_at.astimezone(local_tz())
    return [
        local.strftime("%d.%m.%Y"),
        local.strftime("%H:%M"),
        chat.title or str(chat.chat_id),
        message.from_name or "",
        message.text or f"[{message.content_type}]",
        message.content_type,
        message.edited_at.astimezone(local_tz()).strftime("%d.%m.%Y %H:%M") if message.edited_at else "",
        message_link(message.chat_id, message.message_id) or "",
        f"{message.chat_id}:{message.message_id}",
    ]


def _post(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        # Apps Script javobni boshqa manzilga yo'naltiradi (302) — follow_redirects kerak
        with httpx.Client(transport=http_transport, timeout=20, follow_redirects=True) as client:
            response = client.post(url, json={**payload, "secret": secret()})
    except httpx.HTTPError as exc:
        raise SheetsError(f"Google Sheets bilan aloqa yo‘q: {exc.__class__.__name__}") from exc
    try:
        data = response.json()
    except ValueError:
        raise SheetsError(f"Google Sheets javobi noto‘g‘ri (HTTP {response.status_code}). Skript to‘g‘ri joylanganini tekshiring.") from None
    if not data.get("ok"):
        raise SheetsError(str(data.get("error") or "Noma’lum xato")[:300])
    return data


def push_message(db: Session, message: TelegramMessage) -> bool:
    chat = message.chat
    if chat.purpose is None or chat.purpose == ChatPurpose.IGNORE:
        message.sheets_status = "skipped"
        db.commit()
        return False
    url = get_url(db)
    if not url:
        message.sheets_status, message.sheets_error = "pending", "Google Sheets ulanmagan"
        db.commit()
        return False
    try:
        _post(url, {"action": "upsert", "sheet": SHEET_NAMES[chat.purpose], "headers": HEADERS, "row": row_for(message, chat)})
    except SheetsError as exc:
        message.sheets_status, message.sheets_error = "failed", str(exc)
        db.commit()
        logger.warning("Sheets'ga yozilmadi (%s:%s): %s", message.chat_id, message.message_id, exc)
        return False
    message.sheets_status, message.sheets_error = "sent", None
    db.commit()
    return True


def push_pending(db: Session, chat_id: int | None = None, limit: int = 200) -> dict[str, int]:
    """Yuborilmagan (pending/failed) xabarlarni qayta yuborish — eski xabarlar ham jadvalga tushadi."""
    stmt = (
        select(TelegramMessage)
        .join(TelegramChat)
        .where(TelegramMessage.sheets_status.in_(("pending", "failed", "skipped")), TelegramChat.purpose.is_not(None),
               TelegramChat.purpose != ChatPurpose.IGNORE)
        .order_by(TelegramMessage.sent_at)
        .limit(limit)
    )
    if chat_id is not None:
        stmt = stmt.where(TelegramMessage.chat_id == chat_id)
    sent = failed = 0
    for message in db.scalars(stmt).all():
        if push_message(db, message):
            sent += 1
        else:
            failed += 1
            if not get_url(db):
                break
    return {"sent": sent, "failed": failed}


def test_connection(url: str) -> None:
    _post(url, {"action": "ping"})
