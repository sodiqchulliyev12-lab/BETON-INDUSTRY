"""Telegram webhook: guruhlardagi xabarlar shu manzilga keladi.

Telegram tez javob kutadi, shuning uchun xabar fon vazifasida qayta ishlanadi va darhol 200 qaytariladi.
Maxfiy sarlavha mos kelmasa — 403 (soxta so'rovlar saqlanmaydi).
"""
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request, status

from app.services import telegram_inbox

router = APIRouter(prefix="/api/v1/telegram", tags=["Telegram webhook"])


@router.post("/webhook", include_in_schema=False)
async def telegram_webhook(
    request: Request,
    background: BackgroundTasks,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
) -> dict[str, Any]:
    if not telegram_inbox.verify_secret(x_telegram_bot_api_secret_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ruxsat yo‘q.")
    try:
        update = await request.json()
    except ValueError:
        return {"ok": True}  # buzilgan so'rov — Telegram qayta yubormasligi uchun baribir 200
    if isinstance(update, dict):
        background.add_task(telegram_inbox.process_update, update)
    return {"ok": True}
