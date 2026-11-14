from decimal import Decimal

import pytest

from tests.test_public_api import order_payload


@pytest.fixture
def setup(client, login, make_product, tomorrow):
    """Menejer, 20 m³ li buyurtma, haydovchi va ikki mashina (o'z va ijara)."""
    headers = login("manager")
    product = make_product(price=Decimal("700000"))
    client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow, volume_m3=20))
    order_id = client.get("/api/v1/admin/orders", headers=headers).json()["items"][0]["id"]

    driver = client.post("/api/v1/admin/drivers", headers=headers, json={"full_name": "Haydovchi Bir", "phone": "90 111 22 33"}).json()
    own = client.post("/api/v1/admin/vehicles", headers=headers, json={
        "plate_number": "01 a 123 bc", "vehicle_type": "Beton mikser", "ownership": "own",
        "capacity_m3": 8, "default_driver_id": driver["id"],
    }).json()
    rented = client.post("/api/v1/admin/vehicles", headers=headers, json={
        "plate_number": "10B777AA", "vehicle_type": "Beton mikser", "ownership": "rented",
        "rental_company": "Ijara MChJ",
    }).json()
    return {"h": headers, "order_id": order_id, "driver": driver, "own": own, "rented": rented}


def test_vehicle_and_driver_crud(client, setup):
    h = setup["h"]
    assert setup["own"]["plate_number"] == "01A123BC"
    assert setup["own"]["default_driver_name"] == "Haydovchi Bir"
    assert setup["driver"]["phone"] == "+998901112233"
    assert setup["rented"]["capacity_m3"] is None  # sig'im noma'lum — taxmin qilinmaydi

    dup = client.post("/api/v1/admin/vehicles", headers=h, json={"plate_number": "01A 123BC", "vehicle_type": "Mikser", "ownership": "own"})
    assert dup.status_code == 409
    bad = client.post("/api/v1/admin/vehicles", headers=h, json={"plate_number": "!!", "vehicle_type": "Mikser", "ownership": "own"})
    assert bad.status_code == 422
    assert len(client.get("/api/v1/admin/vehicles", headers=h).json()) == 2


def test_trips_volume_capacity_and_rental_rules(client, setup):
    h, oid = setup["h"], setup["order_id"]
    url = f"/api/v1/admin/orders/{oid}/trips"

    # sig'imdan katta
    r = client.post(url, headers=h, json={"vehicle_id": setup["own"]["id"], "volume_m3": 9})
    assert r.status_code == 422 and "sig‘imidan" in r.json()["detail"][0]["msg"]
    # o'z mashinasiga ijara xarajati yozib bo'lmaydi
    r = client.post(url, headers=h, json={"vehicle_id": setup["own"]["id"], "volume_m3": 8, "rental_cost": 100})
    assert r.json()["detail"][0]["loc"][-1] == "rental_cost"

    r = client.post(url, headers=h, json={"vehicle_id": setup["own"]["id"], "volume_m3": 8})
    assert r.status_code == 201
    data = r.json()
    assert data["trips"][0]["driver_name"] == "Haydovchi Bir"  # doimiy haydovchi avtomatik
    assert data["volumes"]["in_trips"] == 8.0 and data["volumes"]["unassigned"] == 12.0

    r = client.post(url, headers=h, json={"vehicle_id": setup["rented"]["id"], "volume_m3": 12, "rental_cost": 250000})
    assert r.status_code == 201
    assert [t["trip_no"] for t in r.json()["trips"]] == [1, 2]
    assert r.json()["volumes"]["rental_cost_total"] == 250000.0

    # buyurtma hajmidan oshib ketadi
    r = client.post(url, headers=h, json={"vehicle_id": setup["rented"]["id"], "volume_m3": 1})
    assert r.status_code == 422 and "oshib ketadi" in r.json()["detail"][0]["msg"]


def test_per_trip_vehicle_takes_trip_cost(client, setup):
    """Reys bay transport: egasi (tashuvchi) saqlanadi va har qatnovga to'lov yoziladi."""
    h, oid = setup["h"], setup["order_id"]
    vehicle = client.post("/api/v1/admin/vehicles", headers=h, json={
        "plate_number": "30C555CC", "vehicle_type": "Beton mikser", "ownership": "per_trip", "rental_company": "Aliyev T.",
    }).json()
    assert vehicle["ownership"] == "per_trip" and vehicle["rental_company"] == "Aliyev T."

    r = client.post(f"/api/v1/admin/orders/{oid}/trips", headers=h, json={"vehicle_id": vehicle["id"], "volume_m3": 6, "rental_cost": 180000})
    assert r.status_code == 201, r.text
    assert r.json()["trips"][0]["ownership"] == "per_trip"
    assert r.json()["volumes"]["rental_cost_total"] == 180000.0

    # o'zimiznikiga o'tkazilsa, egasi tozalanadi
    own = client.put(f"/api/v1/admin/vehicles/{vehicle['id']}", headers=h, json={
        "plate_number": "30C555CC", "vehicle_type": "Beton mikser", "ownership": "own", "rental_company": "Aliyev T.",
    }).json()
    assert own["rental_company"] is None


def test_trip_status_flow_updates_vehicle_and_volumes(client, setup):
    h, oid = setup["h"], setup["order_id"]
    trip = client.post(f"/api/v1/admin/orders/{oid}/trips", headers=h, json={"vehicle_id": setup["own"]["id"], "volume_m3": 8}).json()["trips"][0]

    assert client.post(f"/api/v1/admin/trips/{trip['id']}/status", headers=h, json={"status": "delivered"}).status_code == 422
    client.post(f"/api/v1/admin/trips/{trip['id']}/status", headers=h, json={"status": "loaded"})
    vehicle = next(v for v in client.get("/api/v1/admin/vehicles", headers=h).json() if v["id"] == setup["own"]["id"])
    assert vehicle["status"] == "busy"

    # band mashinani ta'mirga yuborib bo'lmaydi
    r = client.post(f"/api/v1/admin/vehicles/{setup['own']['id']}/status", headers=h, json={"status": "repair"})
    assert r.status_code == 422

    data = client.post(f"/api/v1/admin/trips/{trip['id']}/status", headers=h, json={"status": "en_route"}).json()
    data = client.post(f"/api/v1/admin/trips/{trip['id']}/status", headers=h, json={"status": "delivered"}).json()
    t = data["trips"][0]
    assert t["loaded_at"] and t["departed_at"] and t["delivered_at"]
    assert data["volumes"]["loaded"] == 8.0 and data["volumes"]["delivered"] == 8.0
    assert data["volumes"]["remaining"] == 12.0

    vehicle = next(v for v in client.get("/api/v1/admin/vehicles", headers=h).json() if v["id"] == setup["own"]["id"])
    assert vehicle["status"] == "free"
    # yetkazilgan qatnovni o'chirib bo'lmaydi
    assert client.delete(f"/api/v1/admin/trips/{trip['id']}", headers=h).status_code == 422


def test_repair_vehicle_cannot_be_assigned(client, setup):
    h = setup["h"]
    client.post(f"/api/v1/admin/vehicles/{setup['rented']['id']}/status", headers=h, json={"status": "repair"})
    r = client.post(f"/api/v1/admin/orders/{setup['order_id']}/trips", headers=h, json={"vehicle_id": setup["rented"]["id"], "volume_m3": 5})
    assert r.status_code == 422 and "ta’mirda" in r.json()["detail"][0]["msg"]


def test_used_vehicle_and_driver_cannot_be_deleted(client, setup):
    h = setup["h"]
    client.post(f"/api/v1/admin/orders/{setup['order_id']}/trips", headers=h, json={"vehicle_id": setup["own"]["id"], "volume_m3": 4})
    assert client.delete(f"/api/v1/admin/vehicles/{setup['own']['id']}", headers=h).status_code == 422
    assert client.delete(f"/api/v1/admin/drivers/{setup['driver']['id']}", headers=h).status_code == 422
    assert client.delete(f"/api/v1/admin/vehicles/{setup['rented']['id']}", headers=h).status_code == 204


def test_pickup_order_has_no_trips(client, login, make_product, tomorrow):
    h = login("dispatcher")
    product = make_product()
    client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow, delivery_required=False))
    oid = client.get("/api/v1/admin/orders", headers=h).json()["items"][0]["id"]
    vehicle = client.post("/api/v1/admin/vehicles", headers=h, json={"plate_number": "01X001XX", "vehicle_type": "Mikser", "ownership": "own"}).json()
    r = client.post(f"/api/v1/admin/orders/{oid}/trips", headers=h, json={"vehicle_id": vehicle["id"], "volume_m3": 2})
    assert r.status_code == 422


def test_fleet_permissions(client, login):
    viewer = login("viewer")
    assert client.get("/api/v1/admin/vehicles", headers=viewer).status_code == 200
    assert client.post("/api/v1/admin/drivers", headers=viewer, json={"full_name": "Ali Vali", "phone": "901112233"}).status_code == 403
    production = login("production")
    assert client.post("/api/v1/admin/orders/1/trips", headers=production, json={"vehicle_id": 1, "volume_m3": 1}).status_code == 403
