"""Koordinatalar bilan ishlash."""
import math
from decimal import Decimal

# O'zbekiston va atrofi (biroz kengroq chegara). Saytdan kelgan nuqta shu hududda bo'lishi kerak.
UZ_BOUNDS = {"lat_min": 36.5, "lat_max": 46.5, "lon_min": 55.0, "lon_max": 74.5}


def in_service_area(lat: float, lon: float) -> bool:
    b = UZ_BOUNDS
    return b["lat_min"] <= lat <= b["lat_max"] and b["lon_min"] <= lon <= b["lon_max"]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Ikki nuqta orasidagi to'g'ri chiziq masofasi (km). Yo'l masofasi bundan uzunroq bo'ladi."""
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def round_coord(value: float | Decimal) -> Decimal:
    """6 xona (~0,1 m aniqlik) — bazadagi Numeric(9, 6) bilan bir xil."""
    return Decimal(str(value)).quantize(Decimal("0.000001"))


def osm_link(lat: float | Decimal, lon: float | Decimal) -> str:
    return f"https://www.openstreetmap.org/?mlat={float(lat):.6f}&mlon={float(lon):.6f}#map=17/{float(lat):.6f}/{float(lon):.6f}"
