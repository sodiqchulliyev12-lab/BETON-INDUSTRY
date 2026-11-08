"""Telegram xabarnomalari.

Asosiy tamoyillar:
- bot tokeni faqat .env da (settings.TELEGRAM_BOT_TOKEN); bazaga, logga, frontendga chiqmaydi;
- xabar fon vazifasida (BackgroundTasks) yuboriladi — mijoz javobni kutmaydi;
- Telegram ishlamasa ham buyurtma qabul qilinaveradi: xato faqat jurnalga yoziladi;
- foydalanuvchi kiritgan matnlar HTML-escape qilinadi (xabar formatini buzib bo'lmaydi).
"""
import html
import logging
import re
import string
import time
from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.database import SessionLocal
from app.models import CallbackRequest, NotificationLog, Order, TelegramSettings
from app.models.enums import LABELS, OrderStatus
from app.utils.geo import osm_link
from app.utils.timezone import local_tz

logger = logging.getLogger("beton.telegram")

# Testlarda soxta transport ulash uchun (httpx.MockTransport)
http_transport: httpx.BaseTransport | None = None

CHAT_ID_RE = re.compile(r"^(-?\d{5,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$")
MAX_MESSAGE_LEN = 4000  # Telegram chegarasi 4096

ORDER_STATUS_LABELS = LABELS[OrderStatus]

# Yangi buyurtma shablonida ishlatish mumkin bo'lgan o'zgaruvchilar
TEMPLATE_FIELDS: dict[str, str] = {
    "order_number": "Buyurtma raqami",
    "customer_name": "Mijoz ismi",
    "phone": "Telefon",
    "products": "Beton markasi va hajmi",
    "volume": "Jami hajm",
    "delivery": "Yetkazib berish manzili yoki «O‘zi olib ketadi»",
    "date": "Sana va vaqt",
    "total": "Taxminiy summa",
    "comment": "Izoh",
    "map_url": "Yetkazish nuqtasi xaritada (tanlangan bo‘lsa)",
    "admin_url": "Admin paneldagi havola",
}

DEFAULT_ORDER_TEMPLATE = (
    "🆕 <b>Yangi buyurtma: {order_number}</b>\n"
    "👤 {customer_name}\n"
    "📞 {phone}\n"
    "🧱 {products}\n"
    "🚚 {delivery}\n"
    "📅 {date}\n"
    "💰 {total}\n"
    "💬 {comment}\n"
    "{map_url}\n"
    "{admin_url}"
)


class TelegramError(Exception):
    pass


def token_configured() -> bool:
    return bool(settings.TELEGRAM_BOT_TOKEN)


def _sanitize(text: str) -> str:
    """Xato matnidan tokenni olib tashlash (httpx xatolarida URL to'liq ko'rinadi)."""
    token = settings.TELEGRAM_BOT_TOKEN
    return text.replace(token, "***") if token else text


# --- Telegram Bot API ------------------------------------------------------

def call(method: str, payload: dict[str, Any] | None = None) -> Any:
    if not token_configured():
        raise TelegramError("Bot tokeni sozlanmagan (.env → TELEGRAM_BOT_TOKEN).")
    url = f"{settings.TELEGRAM_API_BASE}/bot{settings.TELEGRAM_BOT_TOKEN}/{method}"
    last_error = "Noma’lum xato"
    for attempt in range(2):  # tarmoq xatosi, 429 yoki 5xx bo'lsa bir marta qayta urinadi
        try:
            with httpx.Client(transport=http_transport, timeout=settings.TELEGRAM_TIMEOUT_SECONDS) as client:
                response = client.post(url, json=payload or {})
        except httpx.HTTPError as exc:
            last_error = _sanitize(f"Telegram bilan aloqa yo‘q: {exc.__class__.__name__}")
            continue
        try:
            data = response.json()
        except ValueError:
            data = {}
        if response.status_code == 200 and data.get("ok"):
            return data.get("result")
        last_error = _sanitize(str(data.get("description") or f"HTTP {response.status_code}"))
        if response.status_code == 429 and attempt == 0:
            retry_after = (data.get("parameters") or {}).get("retry_after", 1)
            time.sleep(min(float(retry_after), 3.0))
            continue
        if response.status_code >= 500 and attempt == 0:
            continue
        break
    raise TelegramError(last_error)


def send_message(chat_id: str, text: str) -> None:
    if len(text) > MAX_MESSAGE_LEN:
        text = text[: MAX_MESSAGE_LEN - 1] + "…"
    try:
        call("sendMessage", {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        })
    except TelegramError as exc:
        # Shablondagi HTML noto'g'ri bo'lsa ham xabar yetib borsin — teglarsiz oddiy matn sifatida
        if "parse" not in str(exc).lower():
            raise
        plain = html.unescape(re.sub(r"<[^>]+>", "", text))
        call("sendMessage", {"chat_id": chat_id, "text": plain, "disable_web_page_preview": True})


def get_me() -> dict[str, Any]:
    return call("getMe")


def set_webhook(url: str, secret_token: str) -> None:
    """Telegram'ga xabarlarni shu manzilga yuborishni aytadi (guruh xabarlarini o'qish uchun)."""
    call("setWebhook", {
        "url": url,
        "secret_token": secret_token,
        "allowed_updates": ["message", "edited_message", "channel_post", "edited_channel_post", "my_chat_member"],
        "drop_pending_updates": False,
        "max_connections": 10,
    })


def webhook_info() -> dict[str, Any]:
    return call("getWebhookInfo") or {}


def recent_chats() -> list[dict[str, Any]]:
    """Botga yaqinda yozgan chatlar (chat ID'ni aniqlash uchun)."""
    updates = call("getUpdates", {"limit": 100, "allowed_updates": ["message", "channel_post", "my_chat_member"]}) or []
    chats: dict[int, dict[str, Any]] = {}
    for update in updates:
        for key in ("message", "channel_post", "my_chat_member"):
            chat = (update.get(key) or {}).get("chat")
            if chat and chat.get("id") is not None:
                chats[chat["id"]] = {
                    "id": str(chat["id"]),
                    "type": chat.get("type"),
                    "title": chat.get("title") or " ".join(filter(None, [chat.get("first_name"), chat.get("last_name")])) or None,
                    "username": chat.get("username"),
                }
    return list(chats.values())


# --- Shablonlar ------------------------------------------------------------

def _e(value: Any) -> str:
    return html.escape(str(value), quote=False) if value not in (None, "") else "—"


def _money(value: Decimal | None) -> str:
    return f"{int(round(value)):,}".replace(",", " ") + " so‘m" if value is not None else ""


def _volume(value: Decimal) -> str:
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return f"{text} m³"


def validate_template(template: str) -> None:
    """Noma'lum o'zgaruvchi yoki buzilgan {qavslar} bo'lsa ValueError."""
    try:
        names = {name for _, name, _, _ in string.Formatter().parse(template) if name is not None}
    except ValueError:
        raise ValueError("Shablonda { } qavslari noto‘g‘ri. Oddiy qavs uchun {{ yoki }} yozing.") from None
    unknown = sorted(n for n in names if n not in TEMPLATE_FIELDS)
    if unknown:
        raise ValueError("Noma’lum o‘zgaruvchi: " + ", ".join("{" + n + "}" for n in unknown))


def order_values(order: Order) -> dict[str, str]:
    volume = sum((i.volume_m3 for i in order.items), Decimal("0"))
    if order.concrete_total is None:
        total = "Narx belgilanmagan — menejer aytadi"
    elif order.grand_total is not None:
        total = _money(order.grand_total)
    else:
        total = f"{_money(order.concrete_total)} + yetkazib berish (tasdiqlanmagan)"
    date = order.delivery_date.strftime("%d.%m.%Y")
    if order.delivery_time:
        date += " " + order.delivery_time.strftime("%H:%M")
    admin_url = (
        f'<a href="{html.escape(settings.PUBLIC_BASE_URL)}/admin/#/orders/{order.id}">Admin panelda ochish</a>'
        if settings.PUBLIC_BASE_URL else ""
    )
    return {
        "order_number": _e(order.order_number),
        "customer_name": _e(order.customer.full_name),
        "phone": _e(order.customer.phone),
        "products": _e(", ".join(f"{i.grade_class} — {i.product_name}, {_volume(i.volume_m3)}" for i in order.items)),
        "volume": _e(_volume(volume)),
        "delivery": _e(order.delivery_address) if order.delivery_required else "O‘zi olib ketadi",
        "date": _e(date),
        "total": _e(total),
        "comment": _e(order.comment),
        "map_url": (
            f'<a href="{html.escape(osm_link(order.delivery_lat, order.delivery_lon))}">📍 Xaritada ochish</a>'
            if order.delivery_lat is not None and order.delivery_lon is not None else ""
        ),
        "admin_url": admin_url,
    }


def _drop_empty_lines(text: str) -> str:
    return "\n".join(line for line in text.splitlines() if line.strip())


def render_order_message(order: Order, template: str | None) -> str:
    values = order_values(order)
    if template:
        try:
            validate_template(template)
            return _drop_empty_lines(template.format_map(values))
        except (ValueError, KeyError, IndexError):
            logger.warning("Telegram shabloni noto‘g‘ri — standart shablon ishlatildi.")
    return _drop_empty_lines(DEFAULT_ORDER_TEMPLATE.format_map(values))


def render_status_message(order: Order, from_status: OrderStatus | None, to_status: OrderStatus, changed_by: str | None, note: str | None) -> str:
    lines = [
        f"🔄 <b>{_e(order.order_number)}</b>: {_e(ORDER_STATUS_LABELS.get(from_status, '—') if from_status else '—')} → <b>{_e(ORDER_STATUS_LABELS[to_status])}</b>",
        f"👤 Mijoz: {_e(order.customer.full_name)}, {_e(order.customer.phone)}",
    ]
    if changed_by:
        lines.append(f"✍️ O‘zgartirdi: {_e(changed_by)}")
    if to_status == OrderStatus.CANCELLED and order.cancel_reason:
        lines.append(f"❗ Sabab: {_e(order.cancel_reason)}")
    if note:
        lines.append(f"📝 {_e(note)}")
    return "\n".join(lines)


def render_callback_message(item: CallbackRequest) -> str:
    lines = [
        "📞 <b>Qayta qo‘ng‘iroq so‘rovi</b>",
        f"👤 {_e(item.name)}",
        f"☎️ {_e(item.phone)}",
    ]
    if item.message:
        lines.append(f"💬 {_e(item.message)}")
    created = item.created_at.astimezone(local_tz()).strftime("%d.%m.%Y %H:%M")
    lines.append(f"🕒 {created}")
    return "\n".join(lines)


# --- Yuborish va jurnal ----------------------------------------------------

@dataclass
class DeliveryResult:
    chat_id: str
    ok: bool
    error: str | None = None


def deliver(db: Session, event: str, text: str, chat_ids: Iterable[str], order_id: int | None = None) -> list[DeliveryResult]:
    results = []
    for chat_id in chat_ids:
        try:
            send_message(chat_id, text)
            results.append(DeliveryResult(chat_id, True))
        except TelegramError as exc:
            results.append(DeliveryResult(chat_id, False, str(exc)))
            logger.warning("Telegram xabari yuborilmadi (%s → %s): %s", event, chat_id, exc)
    for r in results:
        db.add(NotificationLog(channel="telegram", event=event, recipient=r.chat_id,
                               status="sent" if r.ok else "failed", error=r.error, order_id=order_id))
    db.commit()
    return results


def _active_config(db: Session, flag: str) -> TelegramSettings | None:
    cfg = db.get(TelegramSettings, 1)
    if cfg is None or not cfg.is_enabled or not getattr(cfg, flag) or not cfg.chat_ids or not token_configured():
        return None
    return cfg


def _load_order(db: Session, order_id: int) -> Order | None:
    return db.scalar(
        select(Order).where(Order.id == order_id).options(selectinload(Order.items), selectinload(Order.customer))
    )


# Quyidagi funksiyalar fon vazifasi sifatida chaqiriladi: o'z sessiyasini ochadi va HECH QACHON xato tashlamaydi.

def notify_new_order(order_id: int) -> None:
    try:
        with SessionLocal() as db:
            cfg = _active_config(db, "notify_new_order")
            order = _load_order(db, order_id) if cfg else None
            if cfg and order:
                deliver(db, "new_order", render_order_message(order, cfg.message_template), cfg.chat_ids, order.id)
    except Exception:
        logger.exception("Yangi buyurtma xabarnomasida kutilmagan xato (order_id=%s)", order_id)


def notify_status_change(order_id: int, from_status: str | None, to_status: str, changed_by: str | None, note: str | None) -> None:
    try:
        with SessionLocal() as db:
            cfg = _active_config(db, "notify_status_change")
            order = _load_order(db, order_id) if cfg else None
            if cfg and order:
                text = render_status_message(
                    order, OrderStatus(from_status) if from_status else None, OrderStatus(to_status), changed_by, note
                )
                deliver(db, "status_change", text, cfg.chat_ids, order.id)
    except Exception:
        logger.exception("Holat xabarnomasida kutilmagan xato (order_id=%s)", order_id)


def notify_callback(callback_id: int) -> None:
    try:
        with SessionLocal() as db:
            cfg = _active_config(db, "notify_callback")
            item = db.get(CallbackRequest, callback_id) if cfg else None
            if cfg and item:
                deliver(db, "callback", render_callback_message(item), cfg.chat_ids)
    except Exception:
        logger.exception("Qayta qo‘ng‘iroq xabarnomasida kutilmagan xato (id=%s)", callback_id)
