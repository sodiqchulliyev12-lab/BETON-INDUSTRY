from decimal import Decimal

import pytest

from tests.test_public_api import order_payload


@pytest.fixture
def order(client, make_product, tomorrow):
    product = make_product(price=Decimal("750000"))
    r = client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow, volume_m3=10))
    assert r.status_code == 201
    return r.json()


def find_order_id(client, headers):
    return client.get("/api/v1/admin/orders", headers=headers).json()["items"][0]["id"]


# --- Dashboard -------------------------------------------------------------

def test_dashboard_empty_has_no_fake_data(client, login):
    data = client.get("/api/v1/admin/dashboard", headers=login()).json()
    assert data["has_data"] is False
    assert data["totals"]["orders"] == 0
    assert data["by_product"] == []
    assert all(day["orders"] == 0 for day in data["daily"])
    assert data["production_capacity_m3_per_day"] is None  # belgilanmagan — taxmin qilinmaydi


def test_dashboard_counts_real_orders(client, login, order):
    data = client.get("/api/v1/admin/dashboard", headers=login()).json()
    assert data["has_data"] is True
    assert data["totals"]["orders"] == 1 and data["totals"]["new"] == 1
    assert data["totals"]["volume_m3"] == 10.0
    assert data["daily"][-1]["orders"] == 1
    assert data["by_product"][0]["volume_m3"] == 10.0


def test_value_stream_empty_has_no_fake_times(client, login):
    vs = client.get("/api/v1/admin/dashboard", headers=login()).json()["value_stream"]
    assert vs["has_data"] is False and vs["bottleneck"] is None
    assert vs["lead_time_hours"] is None and vs["efficiency_pct"] is None
    assert [s["status"] for s in vs["stages"]][0] == "new" and all(s["avg_hours"] is None for s in vs["stages"])


def test_value_stream_times_from_status_history(client, db, login, order):
    from sqlalchemy import text

    admin = login()
    oid = find_order_id(client, admin)
    client.patch(f"/api/v1/admin/orders/{oid}", headers=admin, json={"delivery_price": 0})
    for status in ("confirmed", "in_production", "quality_check", "loaded", "in_transit", "delivered"):
        assert client.post(f"/api/v1/admin/orders/{oid}/status", headers=admin, json={"status": status}).status_code == 200
    # Holatlar orasidagi vaqtni aniq belgilaymiz (soatlarda, zayafkadan boshlab)
    offsets = {"new": 0, "confirmed": 5, "in_production": 8, "quality_check": 9, "loaded": 10, "in_transit": 10.5, "delivered": 12}
    for status, hours in offsets.items():
        db.execute(text(
            "UPDATE order_status_history SET created_at = TIMESTAMPTZ '2026-11-01 08:00+00' + make_interval(secs => :s) "
            "WHERE order_id = :o AND to_status = :st"
        ), {"s": hours * 3600, "o": oid, "st": status})
    db.commit()

    vs = client.get("/api/v1/admin/dashboard", headers=admin).json()["value_stream"]
    stages = {s["status"]: s for s in vs["stages"]}
    assert stages["new"]["avg_hours"] == 5 and stages["confirmed"]["avg_hours"] == 3
    assert stages["scheduled"]["avg_hours"] is None  # bu bosqichdan o'tmagan — 0 deb ko'rsatilmaydi
    assert stages["delivered"]["wip_orders"] == 1 and stages["delivered"]["wip_volume_m3"] == 10.0
    assert vs["bottleneck"] == "new"
    assert vs["lead_time_hours"] == 12 and vs["work_time_hours"] == 4  # 1 + 1 + 0.5 + 1.5
    assert vs["wait_time_hours"] == 8 and vs["efficiency_pct"] == 33.3


def test_value_stream_counts_cancellations_by_stage(client, login, order):
    admin = login()
    oid = find_order_id(client, admin)
    client.post(f"/api/v1/admin/orders/{oid}/status", headers=admin, json={"status": "cancelled", "cancel_reason": "Mijoz voz kechdi"})
    vs = client.get("/api/v1/admin/dashboard", headers=admin).json()["value_stream"]
    assert vs["cancelled_total"] == 1 and vs["cancelled_volume_m3"] == 10.0
    assert next(s for s in vs["stages"] if s["status"] == "new")["cancelled_here"] == 1


# --- Buyurtmalar -----------------------------------------------------------

def test_order_list_search_and_detail(client, login, order):
    headers = login()
    page = client.get("/api/v1/admin/orders", headers=headers, params={"q": "1234567"}).json()
    assert page["total"] == 1
    assert page["items"][0]["volume_m3"] == 10.0
    assert client.get("/api/v1/admin/orders", headers=headers, params={"q": "yoq-bunday"}).json()["total"] == 0
    assert client.get("/api/v1/admin/orders", headers=headers, params={"q": "%"}).json()["total"] == 0

    detail = client.get(f"/api/v1/admin/orders/{page['items'][0]['id']}", headers=headers).json()
    assert detail["customer"]["phone"] == "+998901234567"
    assert detail["allowed_statuses"] == ["confirmed", "cancelled"]
    assert detail["history"][0]["to_status"] == "new"


def test_confirm_requires_delivery_price_then_totals_recalculate(client, login, order):
    headers = login("manager")
    oid = find_order_id(client, headers)

    r = client.post(f"/api/v1/admin/orders/{oid}/status", headers=headers, json={"status": "confirmed"})
    assert r.status_code == 422
    assert "yetkazib berish narxini" in r.json()["detail"][0]["msg"]

    detail = client.patch(f"/api/v1/admin/orders/{oid}", headers=headers, json={"delivery_price": 200000}).json()
    assert detail["delivery_price_status"] == "confirmed"
    assert detail["grand_total"] == 7700000.0  # 10 × 750 000 + 200 000

    detail = client.post(f"/api/v1/admin/orders/{oid}/status", headers=headers, json={"status": "confirmed", "note": "Qo‘ng‘iroq qilindi"}).json()
    assert detail["status"] == "confirmed"
    assert detail["history"][-1]["changed_by"] == "Manager Test"


def test_item_price_for_unpriced_product(client, login, make_product, tomorrow):
    product = make_product("b30", price=None)
    client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow, delivery_required=False, volume_m3=4))
    headers = login("manager")
    oid = find_order_id(client, headers)
    detail = client.get(f"/api/v1/admin/orders/{oid}", headers=headers).json()
    assert detail["concrete_total"] is None

    item_id = detail["items"][0]["id"]
    detail = client.patch(f"/api/v1/admin/orders/{oid}/items/{item_id}", headers=headers, json={"unit_price": 600000}).json()
    assert detail["concrete_total"] == 2400000.0
    assert detail["grand_total"] == 2400000.0  # o'zi olib ketadi


def test_invalid_transition_and_cancel_reason(client, login, order):
    headers = login()
    oid = find_order_id(client, headers)
    assert client.post(f"/api/v1/admin/orders/{oid}/status", headers=headers, json={"status": "delivered"}).status_code == 422
    r = client.post(f"/api/v1/admin/orders/{oid}/status", headers=headers, json={"status": "cancelled"})
    assert r.json()["detail"][0]["loc"][-1] == "cancel_reason"
    r = client.post(f"/api/v1/admin/orders/{oid}/status", headers=headers, json={"status": "cancelled", "cancel_reason": "Mijoz voz kechdi"})
    assert r.json()["status"] == "cancelled"
    # bekor qilingan buyurtmani tahrirlab bo'lmaydi
    assert client.patch(f"/api/v1/admin/orders/{oid}", headers=headers, json={"comment": "x"}).status_code == 422


def test_production_role_limited_statuses(client, login, order):
    admin = login()
    oid = find_order_id(client, admin)
    client.patch(f"/api/v1/admin/orders/{oid}", headers=admin, json={"delivery_price": 0})
    client.post(f"/api/v1/admin/orders/{oid}/status", headers=admin, json={"status": "confirmed"})

    production = login("production")
    detail = client.get(f"/api/v1/admin/orders/{oid}", headers=production).json()
    assert detail["allowed_statuses"] == ["in_production"]  # bekor qilish ruxsati yo'q
    assert client.post(f"/api/v1/admin/orders/{oid}/status", headers=production, json={"status": "cancelled", "cancel_reason": "x"}).status_code == 422
    assert client.post(f"/api/v1/admin/orders/{oid}/status", headers=production, json={"status": "in_production"}).status_code == 200
    assert client.patch(f"/api/v1/admin/orders/{oid}", headers=production, json={"comment": "x"}).status_code == 403


# --- Markalar va narxlar ---------------------------------------------------

def test_product_crud_and_price_history(client, login):
    headers = login("manager")
    r = client.post("/api/v1/admin/products", headers=headers, json={
        "name": "Beton B25 P3", "grade_class": "b25", "specs": [{"label": "Harakatchanlik", "value": "P3"}],
    })
    assert r.status_code == 201, r.text
    product = r.json()
    assert product["grade_class"] == "B25" and product["slug"] == "b25-beton-b25-p3"
    assert product["price"] is None

    pid = product["id"]
    client.post(f"/api/v1/admin/products/{pid}/prices", headers=headers, json={"price_per_m3": 700000})
    updated = client.post(f"/api/v1/admin/products/{pid}/prices", headers=headers, json={"price_per_m3": 720000, "note": "Sement qimmatladi"}).json()
    assert updated["price"]["price_per_m3"] == 720000.0

    history = client.get(f"/api/v1/admin/products/{pid}/prices", headers=headers).json()
    assert [h["price_per_m3"] for h in history] == [720000.0, 700000.0]
    assert history[0]["valid_to"] is None and history[1]["valid_to"] is not None
    assert history[0]["created_by"] == "Manager Test"

    public = client.get("/api/v1/public/products").json()
    assert public[0]["price"]["price_per_m3"] == 720000.0

    cleared = client.delete(f"/api/v1/admin/products/{pid}/prices/current", headers=headers).json()
    assert cleared["price"] is None

    patched = client.patch(f"/api/v1/admin/products/{pid}", headers=headers, json={"is_available": False}).json()
    assert patched["is_available"] is False and patched["name"] == "Beton B25 P3"
    assert client.delete(f"/api/v1/admin/products/{pid}", headers=headers).status_code == 204


def test_used_product_cannot_be_deleted(client, login, make_product, tomorrow):
    product = make_product()
    client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow))
    r = client.delete(f"/api/v1/admin/products/{product.id}", headers=login())
    assert r.status_code == 422


# --- Mijozlar --------------------------------------------------------------

def test_customers_list_and_update(client, login, order):
    headers = login("manager")
    page = client.get("/api/v1/admin/customers", headers=headers, params={"q": "90123"}).json()
    assert page["total"] == 1
    customer = page["items"][0]
    assert customer["orders_count"] == 1 and customer["total_volume_m3"] == 10.0

    r = client.put(f"/api/v1/admin/customers/{customer['id']}", headers=headers, json={
        "full_name": "Test Mijoz", "phone": "+998901234567", "company_name": "Qurilish MChJ", "notes": "Doimiy mijoz",
    })
    assert r.json()["company_name"] == "Qurilish MChJ"
    dup = client.post("/api/v1/admin/customers", headers=headers, json={"full_name": "Boshqa", "phone": "901234567"})
    assert dup.status_code == 409


# --- Foydalanuvchilar ------------------------------------------------------

def test_user_management_rules(client, login):
    admin = login()
    r = client.post("/api/v1/admin/users", headers=admin, json={"username": "Dispetcher1", "full_name": "Dispetcher Bir", "role": "dispatcher", "password": "qisqa"})
    assert r.status_code == 422
    r = client.post("/api/v1/admin/users", headers=admin, json={"username": "Dispetcher1", "full_name": "Dispetcher Bir", "role": "dispatcher", "password": "Dispetcher2026"})
    assert r.status_code == 201 and r.json()["username"] == "dispetcher1"
    assert client.post("/api/v1/admin/users", headers=admin, json={"username": "dispetcher1", "full_name": "Ikkinchi", "role": "viewer", "password": "Dispetcher2026"}).status_code == 409

    me = client.get("/api/v1/auth/me", headers=admin).json()
    r = client.patch(f"/api/v1/admin/users/{me['id']}", headers=admin, json={"is_active": False})
    assert r.status_code == 422  # o'zini bloklay olmaydi


# --- Sozlamalar ------------------------------------------------------------

def test_settings_update_validation(client, login):
    admin = login()
    r = client.put("/api/v1/admin/settings", headers=admin, json={"values": {"production.capacity_m3_per_day": "-5"}})
    assert r.status_code == 422
    r = client.put("/api/v1/admin/settings", headers=admin, json={"values": {"yangi.kalit": "x"}})
    assert r.status_code == 422

    r = client.put("/api/v1/admin/settings", headers=admin, json={"values": {
        "company.phone": " +998 71 200-00-00 ", "production.capacity_m3_per_day": "60,5", "company.email": "",
    }})
    assert r.status_code == 200
    values = {s["key"]: s["value"] for s in r.json()}
    assert values["company.phone"] == "+998 71 200-00-00"
    assert values["production.capacity_m3_per_day"] == 60.5
    assert values["company.email"] is None
    assert client.get("/api/v1/public/settings").json()["company.phone"] == "+998 71 200-00-00"


# --- Qayta qo'ng'iroqlar ---------------------------------------------------

def test_callbacks_admin(client, login):
    client.post("/api/v1/public/callback-requests", json={"name": "Ali", "phone": "+998917654321"})
    headers = login("dispatcher")
    page = client.get("/api/v1/admin/callbacks", headers=headers, params={"status": "new"}).json()
    assert page["total"] == 1
    item = client.patch(f"/api/v1/admin/callbacks/{page['items'][0]['id']}", headers=headers, json={"status": "done"}).json()
    assert item["status"] == "done" and item["processed_at"] is not None
