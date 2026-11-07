"""Rasm yuklash. Xavfsizlik:
- fayl turi kengaytmaga emas, faylning birinchi baytlariga (magic bytes) qarab aniqlanadi;
- faqat JPEG, PNG, WebP (SVG/HTML yo'q — ular ichida skript bo'lishi mumkin);
- hajmi cheklangan; fayl nomi tasodifiy (foydalanuvchi bergan nom ishlatilmaydi);
- o'chirishda yo'l faqat uploads papkasi ichida ekani tekshiriladi.
"""
import uuid
from pathlib import Path
from typing import BinaryIO

from app.config import settings
from app.services.orders import OrderError

MAX_IMAGE_BYTES = 5 * 1024 * 1024
URL_PREFIX = "/uploads"


def _detect(head: bytes) -> str | None:
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return None


def save_image(stream: BinaryIO, folder: str) -> str:
    """Rasmni saqlaydi va saytdagi URL'ini qaytaradi: /uploads/<folder>/<uuid>.<ext>"""
    data = stream.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise OrderError("Rasm hajmi 5 MB dan oshmasligi kerak.", field="file")
    if not data:
        raise OrderError("Fayl bo‘sh.", field="file")
    ext = _detect(data[:16])
    if ext is None:
        raise OrderError("Faqat JPG, PNG yoki WebP rasm yuklash mumkin.", field="file")

    target_dir = settings.UPLOAD_DIR / folder
    target_dir.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.{ext}"
    (target_dir / name).write_bytes(data)
    return f"{URL_PREFIX}/{folder}/{name}"


def delete_file(url: str | None) -> None:
    if not url or not url.startswith(URL_PREFIX + "/"):
        return
    root = settings.UPLOAD_DIR.resolve()
    path = (root / url[len(URL_PREFIX) + 1:]).resolve()
    if root in path.parents and path.is_file():
        path.unlink(missing_ok=True)


def ensure_upload_dir() -> Path:
    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    return settings.UPLOAD_DIR
