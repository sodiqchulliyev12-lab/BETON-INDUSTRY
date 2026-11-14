from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select, text

from app.models import Customer, Order, OrderStatusHistory, Project
from app.utils.timezone import today_local


def order_payload(product_id: int, date: str, **overrides):
    payload = {
        "customer_name": "Test Mijoz",
        "phone": "+998 (90) 123-45-67",
        "product_id": product_id,
        "volume_m3": 12.5,
        "delivery_required": True,
        "delivery_address": "Toshkent sh., test ko‘chasi 1",
        "delivery_date": date,
        "delivery_time": "09:30",
        "comment": "Izoh",
        "website": "",
    }
    payload.update(overrides)
    return payload


def field_errors(response) -> dict[str, str]:
    return {err["loc"][-1]: err["msg"] for err in response.json()["detail"]}


# --- Tizim ---------------------------------------------------------------

def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["database"] == "ok"


def test_unknown_api_route_returns_json_404(client):
    r = client.get("/api/v1/does-not-exist")
    assert r.status_code == 404
    assert r.headers["content-type"].startswith("application/json")


def test_frontend_is_served_with_security_headers(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "BETON INDUSTRY" in r.text
    assert "Content-Security-Policy" in r.headers
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert client.get("/no-such-page.html").status_code == 404


def test_cors_allows_configured_origin_only(client):
    ok = client.options("/api/v1/public/products", headers={"Origin": "http://localhost:5500", "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5500"
    bad = client.options("/api/v1/public/products", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in bad.headers


# --- Sozlamalar ----------------------------------------------------------

def test_settings_are_empty_by_default_and_hide_private_keys(client, db):
    data = client.get("/api/v1/public/settings").json()
    assert data["company.phone"] is None  # zavod ma'lumoti o'ylab topilmaydi
    assert "production.capacity_m3_per_day" not in data  # maxfiy kalit

    db.execute(text("UPDATE system_settings SET value = '\"+998 71 000-00-00\"' WHERE key = 'company.phone'"))
    db.commit()
    assert client.get("/api/v1/public/settings").json()["company.phone"] == "+998 71 000-00-00"


# --- Mahsulotlar va loyihalar ---------------------------------------------

def test_products_list_shows_only_active_and_never_exposes_price(client, make_product):
    make_product("b25", price=Decimal("750000"), specs=[{"label": "Harakatchanlik", "value": "P3"}])
    make_product("b30", price=None)
    make_product("b10", is_active=False)

    data = client.get("/api/v1/public/products").json()
    by_slug = {p["slug"]: p for p in data}
    assert set(by_slug) == {"b25", "b30"}
    assert by_slug["b25"]["specs"] == [{"label": "Harakatchanlik", "value": "P3"}]
    # Narx ochiq saytda ko'rsatilmaydi (raqobatchilar uchun) — javobda umuman bo'lmasligi kerak
    assert all("price" not in p for p in data)
    assert "750000" not in client.get("/api/v1/public/products").text


def test_projects_only_published(client, db):
    db.add_all([
        Project(slug="a", title="Nashr etilgan", is_published=True),
        Project(slug="b", title="Qoralama", is_published=False),
    ])
    db.commit()
    titles = [p["title"] for p in client.get("/api/v1/public/projects").json()]
    assert titles == ["Nashr etilgan"]


# --- Buyurtmalar ---------------------------------------------------------

def test_create_order_with_delivery_keeps_total_pending(client, db, make_product, tomorrow):
    product = make_product(price=Decimal("750000"))
    r = client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow))
    assert r.status_code == 201, r.text
    body = r.json()

    assert body["order_number"] == f"BI-{today_local().year}-000001"
    assert body["status"] == "new"
    assert set(body) == {"order_number", "status"}  # summa mijozga qaytarilmaydi — narx telefon orqali

    order = db.scalars(select(Order)).one()
    # Ichki hisob saqlanadi (admin panel uchun)
    assert order.concrete_total == Decimal("9375000.00")  # 12.5 × 750 000
    assert order.delivery_price_status == "pending" and order.grand_total is None
    assert order.customer.phone == "+998901234567"
    assert order.items[0].unit_price == Decimal("750000.00")
    assert order.items[0].product_name == product.name
    history = db.scalars(select(OrderStatusHistory)).all()
    assert [(h.from_status, h.to_status) for h in history] == [(None, "new")]


def test_pickup_order_has_grand_total_and_no_address(client, db, make_product, tomorrow):
    product = make_product(price=Decimal("500000"))
    payload = order_payload(product.id, tomorrow, delivery_required=False, delivery_address="ixtiyoriy", volume_m3=2)
    assert client.post("/api/v1/public/orders", json=payload).status_code == 201
    order = db.scalars(select(Order)).one()
    assert order.delivery_price_status == "not_required"
    assert order.grand_total == Decimal("1000000.00")
    assert order.delivery_address is None


def test_order_for_product_without_price_is_accepted_with_null_totals(client, db, make_product, tomorrow):
    product = make_product(price=None)
    assert client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow)).status_code == 201
    order = db.scalars(select(Order)).one()
    assert order.concrete_total is None and order.grand_total is None


def test_same_phone_reuses_customer_and_numbers_increase(client, db, make_product, tomorrow):
    product = make_product()
    first = client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow)).json()
    second = client.post(
        "/api/v1/public/orders",
        json=order_payload(product.id, tomorrow, phone="998901234567", customer_name="Boshqa Ism"),
    ).json()
    assert first["order_number"] != second["order_number"]
    customers = db.scalars(select(Customer)).all()
    assert len(customers) == 1
    assert customers[0].full_name == "Test Mijoz"  # ism begona so'rov bilan almashtirilmaydi


def test_order_validation_errors_are_in_uzbek_per_field(client, make_product):
    product = make_product()
    yesterday = (today_local() - timedelta(days=1)).isoformat()
    r = client.post(
        "/api/v1/public/orders",
        json=order_payload(product.id, yesterday, phone="12345", volume_m3=0.2, delivery_address="", customer_name="1"),
    )
    assert r.status_code == 422
    errors = field_errors(r)
    assert set(errors) >= {"phone", "volume_m3", "delivery_address", "delivery_date", "customer_name"}
    assert "Telefon raqami" in errors["phone"]
    assert "O‘tib ketgan" in errors["delivery_date"]


def test_order_volume_precision_and_limits(client, make_product, tomorrow):
    product = make_product()
    assert field_errors(client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow, volume_m3=10.25)))["volume_m3"]
    assert field_errors(client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow, volume_m3=1001)))["volume_m3"]


def test_unavailable_or_inactive_product_is_rejected(client, make_product, tomorrow):
    unavailable = make_product("b20", is_available=False)
    inactive = make_product("b15", is_active=False)
    r1 = client.post("/api/v1/public/orders", json=order_payload(unavailable.id, tomorrow))
    r2 = client.post("/api/v1/public/orders", json=order_payload(inactive.id, tomorrow))
    r3 = client.post("/api/v1/public/orders", json=order_payload(99999, tomorrow))
    assert r1.status_code == r2.status_code == r3.status_code == 422
    assert "sotuvda yo‘q" in field_errors(r1)["product_id"]
    assert "topilmadi" in field_errors(r2)["product_id"]


def test_honeypot_and_extra_fields_are_rejected(client, db, make_product, tomorrow):
    product = make_product()
    assert client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow, website="http://spam")).status_code == 400
    r = client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow, grand_total=1))
    assert r.status_code == 422  # mijoz summani o'zi yubora olmaydi
    assert db.scalar(select(Order.id)) is None


def test_html_in_text_is_stored_as_plain_text(client, db, make_product, tomorrow):
    product = make_product()
    client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow, comment="<script>alert(1)</script>"))
    assert db.scalars(select(Order)).one().comment == "<script>alert(1)</script>"  # frontend escapeHtml qiladi


# --- Qayta qo'ng'iroq -----------------------------------------------------

def test_callback_request(client, db):
    r = client.post(
        "/api/v1/public/callback-requests",
        json={"name": "Ali", "phone": "+998 91 765 43 21", "message": "Savol", "source_page": "contact", "website": ""},
    )
    assert r.status_code == 201
    row = db.execute(text("SELECT phone, source_page, status FROM callback_requests")).one()
    assert tuple(row) == ("+998917654321", "contact", "new")


def test_callback_validation(client):
    r = client.post("/api/v1/public/callback-requests", json={"name": "", "phone": "1"})
    assert r.status_code == 422
    assert set(field_errors(r)) == {"name", "phone"}
