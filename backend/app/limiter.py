"""Ochiq formalarga so'rovlar sonini cheklash (spam va bot'lardan himoya).

Server nginx/Railway proksi ortida ishlasa, haqiqiy IP to'g'ri aniqlanishi uchun uvicorn
--proxy-headers --forwarded-allow-ips="*" bilan ishga tushiriladi (README'ga qarang).
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import settings

limiter = Limiter(key_func=get_remote_address, enabled=settings.RATE_LIMIT_ENABLED)

ORDER_LIMIT = "5/minute;30/hour"
CALLBACK_LIMIT = "5/minute;20/hour"
