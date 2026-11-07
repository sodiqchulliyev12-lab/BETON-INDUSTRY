from decimal import Decimal

from app.utils.timezone import today_local
from tests.test_public_api import order_payload


def test_summary_without_capacity_does_not_guess(client, login):
    data = client.get("/api/v1/admin/production/summary", headers=login("production")).json()
    assert data["capacity_m3_per_day"] is None
    assert data["utilization_percent"] is None
    assert data["planned_m3"] == 0 and data["produced_m3"] == 0 and data["by_product"] == []


def test_plan_record_qc_and_summary(client, login, make_product, tomorrow):
    admin = login()
    client.put("/api/v1/admin/settings", headers=admin, json={"values": {"production.capacity_m3_per_day": "100"}})
    product = make_product(price=Decimal("700000"))
    other = make_product("b15")
    client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow, volume_m3=30))
    order_id = client.get("/api/v1/admin/orders", headers=admin).json()["items"][0]["id"]
    h = login("production", username="usta")
    today = today_local().isoformat()

    # buyurtmada yo'q markani rejalashtirib bo'lmaydi
    bad = client.post("/api/v1/admin/production/plans", headers=h, json={"plan_date": today, "product_id": other.id, "order_id": order_id, "planned_volume_m3": 5})
    assert bad.status_code == 422

    plan = client.post("/api/v1/admin/production/plans", headers=h, json={
        "plan_date": today, "product_id": product.id, "order_id": order_id, "planned_volume_m3": 30,
    }).json()
    assert plan["order_number"].startswith("BI-") and plan["status"] == "planned"

    rec1 = client.post("/api/v1/admin/production/records", headers=h, json={"plan_id": plan["id"], "produced_volume_m3": 20, "batch_number": "P-1"}).json()
    assert rec1["product_id"] == product.id and rec1["order_id"] == order_id  # rejadan olinadi
    rec2 = client.post("/api/v1/admin/production/records", headers=h, json={"plan_id": plan["id"], "produced_volume_m3": 10}).json()

    # sababsiz "o'tmadi" deb bo'lmaydi
    assert client.post(f"/api/v1/admin/production/records/{rec2['id']}/qc", headers=h, json={"qc_status": "failed"}).status_code == 422
    client.post(f"/api/v1/admin/production/records/{rec2['id']}/qc", headers=h, json={"qc_status": "failed", "qc_notes": "Konus cho‘kishi mos emas"})
    passed = client.post(f"/api/v1/admin/production/records/{rec1['id']}/qc", headers=h, json={"qc_status": "passed"}).json()
    assert passed["qc_by"] == "Usta Test" and passed["qc_at"]

    s = client.get("/api/v1/admin/production/summary", headers=h).json()
    assert s["capacity_m3_per_day"] == 100.0
    assert s["planned_m3"] == 30.0 and s["utilization_percent"] == 30.0
    assert s["produced_m3"] == 20.0 and s["qc_failed_m3"] == 10.0 and s["qc_passed_m3"] == 20.0
    assert s["open_orders"] == 1 and s["open_orders_remaining_m3"] == 30.0

    plans = client.get("/api/v1/admin/production/plans", headers=h).json()
    assert plans[0]["produced_volume_m3"] == 20.0 and plans[0]["status"] == "in_progress"

    logistics = client.get(f"/api/v1/admin/orders/{order_id}/logistics", headers=h).json()
    assert logistics["volumes"]["produced"] == 20.0 and logistics["volumes"]["qc_passed"] == 20.0

    # sifatdan o'tgan yozuv va yozuvi bor reja o'chirilmaydi
    assert client.delete(f"/api/v1/admin/production/records/{rec1['id']}", headers=h).status_code == 422
    assert client.delete(f"/api/v1/admin/production/plans/{plan['id']}", headers=h).status_code == 422


def test_production_permissions(client, login):
    dispatcher = login("dispatcher")
    assert client.get("/api/v1/admin/production/summary", headers=dispatcher).status_code == 200
    assert client.post("/api/v1/admin/production/plans", headers=dispatcher, json={}).status_code == 403
