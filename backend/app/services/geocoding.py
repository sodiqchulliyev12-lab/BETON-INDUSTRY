"""Manzil qidirish va koordinatadan manzil aniqlash (OpenStreetMap Nominatim).

Nominatim foydalanish qoidalari (https://operations.osmfoundation.org/policies/nominatim/):
- sekundiga ko'pi bilan 1 so'rov — har bir jarayonda qulf bilan ta'minlanadi;
- tanituvchi User-Agent — ilova nomi va sayt manzili;
- natijalar keshlanadi; "yozish davomida avtomatik qidirish" qilinmaydi (faqat tugma bosilganda).
Mijozning IP manzili Nominatim'ga bormaydi — so'rovni server yuboradi.
"""
import threading
import time
from collections import OrderedDict
from typing import Any

import httpx

from app import __version__
from app.config import settings

http_transport: httpx.BaseTransport | None = None  # testlarda soxta transport

_MIN_INTERVAL = 1.1
_CACHE_TTL = 24 * 3600
_CACHE_MAX = 500

_lock = threading.Lock()
_last_request = 0.0
_cache: "OrderedDict[str, tuple[float, Any]]" = OrderedDict()


class GeocoderError(Exception):
    pass


def _user_agent() -> str:
    site = settings.PUBLIC_BASE_URL or "local-development"
    return f"BETON-INDUSTRY/{__version__} (+{site})"


def _cached(key: str) -> Any | None:
    item = _cache.get(key)
    if item and time.monotonic() - item[0] < _CACHE_TTL:
        _cache.move_to_end(key)
        return item[1]
    return None


def _store(key: str, value: Any) -> None:
    _cache[key] = (time.monotonic(), value)
    _cache.move_to_end(key)
    while len(_cache) > _CACHE_MAX:
        _cache.popitem(last=False)


def _get(path: str, params: dict[str, Any]) -> Any:
    if not settings.GEOCODER_ENABLED:
        raise GeocoderError("Manzil qidirish o‘chirilgan.")
    global _last_request
    with _lock:  # sekundiga 1 so'rovdan oshmasin
        wait = _MIN_INTERVAL - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        try:
            with httpx.Client(transport=http_transport, timeout=settings.GEOCODER_TIMEOUT_SECONDS) as client:
                response = client.get(
                    f"{settings.GEOCODER_URL.rstrip('/')}/{path}",
                    params={**params, "format": "jsonv2", "accept-language": "uz,ru,en"},
                    headers={"User-Agent": _user_agent()},
                )
        except httpx.HTTPError as exc:
            raise GeocoderError("Manzil qidiruv xizmati javob bermadi.") from exc
        finally:
            _last_request = time.monotonic()
    if response.status_code != 200:
        raise GeocoderError(f"Manzil qidiruv xizmati xatosi (HTTP {response.status_code}).")
    try:
        return response.json()
    except ValueError as exc:
        raise GeocoderError("Manzil qidiruv xizmatidan noto‘g‘ri javob keldi.") from exc


def search(query: str, limit: int = 5) -> list[dict[str, Any]]:
    key = f"s:{query.strip().lower()}"
    if (hit := _cached(key)) is not None:
        return hit
    raw = _get("search", {"q": query.strip(), "countrycodes": "uz", "limit": limit})
    results = []
    for item in raw if isinstance(raw, list) else []:
        try:
            results.append({"display_name": str(item["display_name"]), "lat": float(item["lat"]), "lon": float(item["lon"])})
        except (KeyError, TypeError, ValueError):
            continue
    _store(key, results)
    return results


def reverse(lat: float, lon: float) -> str | None:
    key = f"r:{lat:.5f},{lon:.5f}"
    if (hit := _cached(key)) is not None:
        return hit or None
    raw = _get("reverse", {"lat": f"{lat:.6f}", "lon": f"{lon:.6f}", "zoom": 18})
    name = raw.get("display_name") if isinstance(raw, dict) else None
    _store(key, name or "")
    return name


def clear_cache() -> None:
    _cache.clear()
