"""Xarita: yetkazish nuqtasi, zavod joylashuvi, masofa va manzil qidirish (Nominatim soxtalashtirilgan)."""
import json
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import text

from app.services import geocoding
from app.utils.geo import haversine_km
from tests.test_public_api import field_errors, order_payload

TASHKENT = (41.311081, 69.240562)
CHIRCHIQ = (41.468911, 69.582249)


def test_haversine():
    km = haversine_km(*TASHKENT, *CHIRCHIQ)
    assert 30 < km < 36
    assert haversine_km(*TASHKENT, *TASHKENT) == 0


def test_order_with_map_point_and_admin_distance(client, login, make_product, tomorrow, db):
    product = make_product()
    r = client.post("/api/v1/public/orders", json=order_payload(
        product.id, tomorrow, delivery_lat=CHIRCHIQ[0] + 0.00000049, delivery_lon=CHIRCHIQ[1],
    ))
    assert r.status_code == 201, r.text
    lat, lon = db.execute(text("SELECT delivery_lat, delivery_lon FROM orders")).one()
    assert lat == Decimal("41.468911") and lon == Decimal("69.582249")  # 6 xonaga yaxlitlangan

    admin = login()
    oid = client.get("/api/v1/admin/orders", headers=admin).json()["items"][0]["id"]
    detail = client.get(f"/api/v1/admin/orders/{oid}", headers=admin).json()
    assert detail["delivery_lat"] == CHIRCHIQ[0]
    assert detail["factory_lat"] is None and detail["distance_km"] is None  # zavod joylashuvi kiritilmagan

    client.put("/api/v1/admin/settings", headers=admin, json={"values": {
        "company.latitude": str(TASHKENT[0]), "company.longitude": str(TASHKENT[1]).replace(".", ","),
    }})
    detail = client.get(f"/api/v1/admin/orders/{oid}", headers=admin).json()
    assert detail["factory_lon"] == TASHKENT[1]
    assert 30 < detail["distance_km"] < 36

    public = client.get("/api/v1/public/settings").json()
    assert public["company.latitude"] == TASHKENT[0]

    # admin nuqtani o'zgartiradi va olib tashlaydi
    moved = client.patch(f"/api/v1/admin/orders/{oid}", headers=admin, json={"delivery_lat": 41.3, "delivery_lon": 69.3}).json()
    assert moved["delivery_lat"] == 41.3
    r = client.patch(f"/api/v1/admin/orders/{oid}", headers=admin, json={"delivery_lat": 41.3})
    assert r.status_code == 422
    cleared = client.patch(f"/api/v1/admin/orders/{oid}", headers=admin, json={"delivery_lat": None, "delivery_lon": None}).json()
    assert cleared["delivery_lat"] is None and cleared["distance_km"] is None


def test_invalid_points_rejected(client, make_product, tomorrow, db):
    product = make_product()
    r = client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow, delivery_lat=41.3))
    assert "to‘liq emas" in field_errors(r)["delivery_lon"]
    r = client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow, delivery_lat=48.85, delivery_lon=2.35))
    assert "hududidan tashqarida" in field_errors(r)["delivery_lon"]  # Parij
    # o'zi olib ketsa nuqta saqlanmaydi
    client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow, delivery_required=False, delivery_lat=41.3, delivery_lon=69.3))
    assert db.execute(text("SELECT delivery_lat FROM orders")).scalar() is None


def test_factory_coordinates_validation(client, login):
    admin = login()
    r = client.put("/api/v1/admin/settings", headers=admin, json={"values": {"company.latitude": "95", "company.longitude": "69"}})
    assert r.status_code == 422
    r = client.put("/api/v1/admin/settings", headers=admin, json={"values": {"company.latitude": "41.3", "company.longitude": ""}})
    assert r.status_code == 422 and r.json()["detail"][0]["loc"][-1] == "company.longitude"
    r = client.put("/api/v1/admin/settings", headers=admin, json={"values": {"company.latitude": "abc", "company.longitude": "69"}})
    assert r.status_code == 422


# --- Manzil qidirish -------------------------------------------------------

class FakeNominatim:
    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.fail = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.fail:
            return httpx.Response(503, text="busy")
        if request.url.path.endswith("/search"):
            return httpx.Response(200, json=[
                {"display_name": "Chirchiq, Toshkent viloyati, O‘zbekiston", "lat": str(CHIRCHIQ[0]), "lon": str(CHIRCHIQ[1])},
                {"display_name": "buzilgan yozuv"},
            ])
        return httpx.Response(200, json={"display_name": "Amir Temur ko‘chasi, Toshkent"})


@pytest.fixture
def nominatim(monkeypatch):
    fake = FakeNominatim()
    monkeypatch.setattr(geocoding, "http_transport", httpx.MockTransport(fake.handler))
    monkeypatch.setattr(geocoding, "_MIN_INTERVAL", 0)
    geocoding.clear_cache()
    yield fake
    geocoding.clear_cache()


def test_geocode_search_cache_and_headers(client, nominatim):
    r = client.get("/api/v1/public/geocode", params={"q": "Chirchiq"}, headers={"X-Forwarded-For": "203.0.113.7"})
    assert r.status_code == 200
    assert r.json() == [{"display_name": "Chirchiq, Toshkent viloyati, O‘zbekiston", "lat": CHIRCHIQ[0], "lon": CHIRCHIQ[1]}]
    req = nominatim.requests[0]
    assert req.url.params["countrycodes"] == "uz"
    assert req.headers["user-agent"].startswith("BETON-INDUSTRY/")
    assert "203.0.113.7" not in json.dumps(dict(req.headers))  # mijoz IP'si uchinchi tomonga ketmaydi

    client.get("/api/v1/public/geocode", params={"q": "  chirchiq "})
    assert len(nominatim.requests) == 1  # keshdan

    assert client.get("/api/v1/public/geocode", params={"q": "ab"}).status_code == 422


def test_reverse_geocode(client, nominatim):
    r = client.get("/api/v1/public/reverse-geocode", params={"lat": TASHKENT[0], "lon": TASHKENT[1]})
    assert r.json() == {"display_name": "Amir Temur ko‘chasi, Toshkent"}
    assert client.get("/api/v1/public/reverse-geocode", params={"lat": 48.85, "lon": 2.35}).status_code == 422


def test_geocoder_failure_returns_503(client, nominatim):
    nominatim.fail = True
    r = client.get("/api/v1/public/geocode", params={"q": "Navoiy"})
    assert r.status_code == 503 and "xizmat" in r.json()["detail"]


def test_telegram_message_has_map_link(client, login, make_product, tomorrow, monkeypatch):
    from tests.test_telegram import FakeTelegram, enable
    from app.config import settings
    from app.services import telegram

    fake = FakeTelegram()
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "1:fake")
    monkeypatch.setattr(telegram, "http_transport", httpx.MockTransport(fake.handler))
    enable(client, login())
    product = make_product()
    client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow, delivery_lat=CHIRCHIQ[0], delivery_lon=CHIRCHIQ[1]))
    client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow))
    assert "openstreetmap.org/?mlat=41.468911&amp;mlon=69.582249" in fake.sent[0]["text"]
    assert "Xaritada" not in fake.sent[1]["text"] and "\n\n" not in fake.sent[1]["text"]
