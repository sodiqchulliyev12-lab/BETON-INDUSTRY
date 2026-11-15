"""Transport bo'limi, ombor, laboratoriya, ishlab chiqarish paneli va analiz."""
from datetime import timedelta
from decimal import Decimal

import pytest

from app.utils.timezone import today_local
from tests.test_fleet import setup  # noqa: F401  (fixture)

API = "/api/v1/admin"


def day(offset=0) -> str:
    return (today_local() + timedelta(days=offset)).isoformat()


# --- Transport -------------------------------------------------------------

def test_vehicle_kind_summary_expenses_report(client, login):
    h = login("manager")
    mixer = client.post(f"{API}/vehicles", headers=h, json={"plate_number": "01A111AA", "vehicle_type": "Mikser", "ownership": "own", "capacity_m3": 9}).json()
    pump = client.post(f"{API}/vehicles", headers=h, json={"plate_number": "01A222AA", "vehicle_type": "Avtonasos", "kind": "pump", "ownership": "rented", "rental_company": "X"}).json()
    assert mixer["kind"] == "mixer" and pump["kind"] == "pump"
    bad = client.post(f"{API}/vehicles", headers=h, json={"plate_number": "01A333AA", "vehicle_type": "Mikser", "kind": "rocket", "ownership": "own"})
    assert bad.status_code == 422

    s = client.get(f"{API}/fleet/summary", headers=h).json()
    assert s["total"] == 2 and s["by_kind"] == {"mixer": 1, "pump": 1, "other": 0, "car": 0}
    assert s["by_ownership"]["rented"]["pump"] == 1 and len(s["daily"]) == 14

    e = client.post(f"{API}/fleet/expenses", headers=h, json={"vehicle_id": mixer["id"], "expense_date": day(), "category": "fuel", "fuel_type": "diesel", "amount": 250000})
    assert e.status_code == 201
    future = client.post(f"{API}/fleet/expenses", headers=h, json={"vehicle_id": mixer["id"], "expense_date": day(2), "category": "fuel", "fuel_type": "diesel", "amount": 1})
    assert future.status_code == 422
    assert client.post(f"{API}/fleet/expenses", headers=h, json={"vehicle_id": mixer["id"], "expense_date": day(), "category": "fuel", "fuel_type": "diesel", "amount": 0}).status_code == 422
    lst = client.get(f"{API}/fleet/expenses", headers=h).json()
    assert lst["total"] == 250000 and lst["by_category"] == {"fuel": 250000}

    rep = client.get(f"{API}/fleet/report", headers=h).json()
    row = next(r for r in rep["rows"] if r["id"] == mixer["id"])
    assert row["expenses_total"] == 250000 and row["trips"] == 0 and rep["totals"]["cost_total"] == 250000
    assert client.delete(f"{API}/fleet/expenses/{lst['items'][0]['id']}", headers=h).status_code == 204


def test_fleet_planning(client, login, make_product, tomorrow):
    from tests.test_public_api import order_payload
    h = login("manager")
    p = make_product()
    client.post("/api/v1/public/orders", json=order_payload(p.id, tomorrow, volume_m3=16))
    plan = client.get(f"{API}/fleet/planning?date={tomorrow}", headers=h).json()
    assert len(plan["orders"]) == 1 and plan["orders"][0]["unassigned_m3"] == 16 and plan["unassigned_total_m3"] == 16
    mon = client.get(f"{API}/fleet/monitor?date={tomorrow}&kind=mixer&ownership=own&page=1", headers=h).json()
    assert mon["total"] == 0 and mon["items"] == []
    summ = client.get(f"{API}/fleet/summary", headers=h).json()
    assert summ["hourly"] == {} and "fuel_cost" in summ["daily"][0] and summ["ready_by_ownership"]["own"]["mixer"] == 0


# --- Ombor -----------------------------------------------------------------

@pytest.fixture
def wh_setup(client, login):
    h = login("manager")
    w1 = client.post(f"{API}/warehouse/warehouses", headers=h, json={"name": "Asosiy"}).json()
    w2 = client.post(f"{API}/warehouse/warehouses", headers=h, json={"name": "Ikkinchi"}).json()
    cement = client.post(f"{API}/warehouse/materials", headers=h, json={"name": "Sement M400", "category": "cement", "unit": "ton", "min_stock": 50, "norm_per_m3": 0.3}).json()
    return {"h": h, "w1": w1["id"], "w2": w2["id"], "cement": cement["id"], "sku": cement["sku"]}


def _move(client, s, kind, qty, wid=None, **extra):
    body = {"material_id": s["cement"], "warehouse_id": wid or s["w1"], "kind": kind, "quantity": qty, "movement_date": day()}
    body.update(extra)
    return client.post(f"{API}/warehouse/movements", headers=s["h"], json=body)


def test_warehouse_flow(client, wh_setup):
    s, h = wh_setup, wh_setup["h"]
    assert s["sku"] == "CEM-001"
    assert _move(client, s, "in", 100, unit_price=900000).status_code == 201
    over = _move(client, s, "out", 150)
    assert over.status_code == 422 and "yetarli qoldiq" in over.text
    assert _move(client, s, "out", 30).status_code == 201
    assert _move(client, s, "production", 25).status_code == 201

    row = client.get(f"{API}/warehouse/materials", headers=h).json()["items"][0]
    assert row["stock"] == 45 and row["incoming"] == 100 and row["outgoing"] == 55 and row["status"] == "low"  # 45 < min 50
    assert row["avg_price"] == 900000

    summ = client.get(f"{API}/warehouse/summary", headers=h).json()
    assert [m["sku"] for m in summ["low"]] == ["CEM-001"] and summ["value"] == 45 * 900000

    tr = client.post(f"{API}/warehouse/transfers", headers=h, json={
        "material_id": s["cement"], "from_warehouse_id": s["w1"], "to_warehouse_id": s["w2"], "quantity": 20, "movement_date": day()})
    assert tr.status_code == 201
    same = client.post(f"{API}/warehouse/transfers", headers=h, json={
        "material_id": s["cement"], "from_warehouse_id": s["w1"], "to_warehouse_id": s["w1"], "quantity": 1, "movement_date": day()})
    assert same.status_code == 422
    assert client.get(f"{API}/warehouse/materials?warehouse_id={s['w2']}", headers=h).json()["items"][0]["stock"] == 20
    assert client.get(f"{API}/warehouse/materials", headers=h).json()["items"][0]["stock"] == 45  # ko'chirish umumiyni o'zgartirmaydi

    # inventarizatsiya: hisobda 25 (w1), sanaldi 22 → -3 tuzatish
    inv = client.post(f"{API}/warehouse/inventory", headers=h, json={"warehouse_id": s["w1"], "movement_date": day(), "lines": [{"material_id": s["cement"], "counted": 22}]})
    assert inv.json()["adjusted"] == 1
    assert client.get(f"{API}/warehouse/stock?warehouse_id={s['w1']}", headers=h).json()[0]["book"] == 22

    kinds = {m["kind"] for m in client.get(f"{API}/warehouse/movements", headers=h).json()["items"]}
    assert {"in", "out", "production", "transfer_in", "transfer_out", "adjust"} <= kinds
    assert client.get(f"{API}/warehouse/movements?kind=transfer", headers=h).json()["items"][0]["kind"].startswith("transfer")


def test_warehouse_rules(client, wh_setup, login):
    s, h = wh_setup, wh_setup["h"]
    assert _move(client, s, "in", 10, movement_date=day(3)).status_code == 422  # kelajak sana
    _move(client, s, "in", 10)
    _move(client, s, "out", 4)
    assert client.delete(f"{API}/warehouse/materials/{s['cement']}", headers=h).status_code == 409  # harakat bor
    in_id = client.get(f"{API}/warehouse/movements?kind=input", headers=h).json()["items"][0]["id"]
    _move(client, s, "out", 6)
    assert client.delete(f"{API}/warehouse/movements/{in_id}", headers=h).status_code == 409  # keyingi chiqimlar ishlatgan
    assert client.put(f"{API}/warehouse/materials/{s['cement']}", headers=h, json={"name": "Sement", "category": "cement", "unit": "kg"}).status_code == 409
    viewer = login("viewer")
    assert client.get(f"{API}/warehouse/materials", headers=viewer).status_code == 200
    assert _move(client, {**s, "h": viewer}, "in", 1).status_code == 403


def test_consumption_vs_norm(client, wh_setup, db, make_product):
    from app.models import ProductionRecord
    from app.models.enums import QcStatus
    s, h = wh_setup, wh_setup["h"]
    p = make_product()
    db.add(ProductionRecord(product_id=p.id, produced_volume_m3=Decimal("100"), qc_status=QcStatus.PASSED))
    db.commit()
    _move(client, s, "in", 100)
    _move(client, s, "production", 33)
    c = client.get(f"{API}/warehouse/report", headers=h).json()["consumption"][0]
    assert c["expected"] == 30 and c["actual"] == 33 and c["diff_pct"] == 10.0  # norma 0.3 t/m3 x 100 m3


# --- Laboratoriya ----------------------------------------------------------

def test_lab_flow(client, login, make_product):
    h = login("manager")
    p = make_product(slug="m300", grade_class="M300")
    s = client.post(f"{API}/lab/samples", headers=h, json={"product_id": p.id, "sampled_on": day(-30), "operator": "Aliyev", "slump_cm": 14}).json()
    assert s["sample_no"].startswith("NAM-") and s["target_mpa"] == 29.4 and s["result"] == "pending" and s["overdue"] is True

    t7 = client.post(f"{API}/lab/samples/{s['id']}/tests", headers=h, json={"age_days": 7, "tested_on": day(-23), "force_kn": 450}).json()
    assert t7["tests"][0]["strength_mpa"] == 20.0 and t7["result"] == "pending"  # 450 / 22.5
    dup = client.post(f"{API}/lab/samples/{s['id']}/tests", headers=h, json={"age_days": 7, "tested_on": day(-23), "force_kn": 450})
    assert dup.status_code == 409
    early = client.post(f"{API}/lab/samples/{s['id']}/tests", headers=h, json={"age_days": 28, "tested_on": day(-31), "force_kn": 700})
    assert early.status_code == 422

    ok = client.post(f"{API}/lab/samples/{s['id']}/tests", headers=h, json={"age_days": 28, "tested_on": day(-2), "force_kn": 700}).json()
    assert ok["result"] == "pass" and ok["tests"][-1]["strength_mpa"] == 31.11 and ok["overdue"] is False

    s2 = client.post(f"{API}/lab/samples", headers=h, json={"product_id": p.id, "sampled_on": day(-29)}).json()
    bad = client.post(f"{API}/lab/samples/{s2['id']}/tests", headers=h, json={"age_days": 28, "tested_on": day(-1), "force_kn": 600}).json()
    assert bad["result"] == "fail"  # 26.67 < 29.4

    sm = client.get(f"{API}/lab/summary", headers=h).json()
    assert sm["control_tests"] == 2 and sm["pass_pct"] == 50.0 and sm["failed"] == 1
    assert sm["by_grade"][0]["avg_mpa"] == round((31.11 + 26.67) / 2, 2)
    assert client.get(f"{API}/lab/samples?result=fail", headers=h).json()["items"][0]["id"] == s2["id"]
    assert client.post(f"{API}/lab/samples", headers=h, json={"product_id": p.id, "sampled_on": day(1)}).status_code == 422


def test_lab_target_rules():
    from app.routers.admin.lab import target_mpa
    assert target_mpa("M100") == 9.8 and target_mpa("B25") == 25.0 and target_mpa("B22.5") == 22.5 and target_mpa("DEMO") is None


# --- Panel va analiz -------------------------------------------------------

def test_panels_and_actions(client, login, db, make_product):
    from app.models import ProductionPlan, ProductionRecord
    h = login("manager")
    p = make_product()
    db.add(ProductionPlan(plan_date=today_local(), product_id=p.id, planned_volume_m3=Decimal("50")))
    db.add(ProductionRecord(product_id=p.id, produced_volume_m3=Decimal("40")))
    db.commit()
    panel = client.get(f"{API}/production/panel", headers=h).json()
    assert panel["today_m3"] == 40 and panel["plan_today_m3"] == 50 and panel["plan_pct_month"] == 80.0
    assert panel["shares"][0]["pct"] == 100.0 and len(panel["daily"]) == 14

    a = client.post(f"{API}/analysis/actions", headers=h, json={"title": "Tasdiqlash vaqtini qisqartirish", "assignee": "Menejer", "due_date": day(-1)}).json()
    assert a["overdue"] is True and a["status"] == "planned"
    done = client.put(f"{API}/analysis/actions/{a['id']}", headers=h, json={"title": "Tasdiqlash vaqtini qisqartirish", "status": "done"}).json()
    assert done["overdue"] is False
    assert client.get(f"{API}/analysis/actions", headers=h).json()["items"][0]["status"] == "done"
    ov = client.get(f"{API}/analysis/overview", headers=h).json()
    assert ov["lab_pass_pct"] is None and ov["on_time_pct"] is None and ov["vsm"]["has_data"] is False
    assert client.delete(f"{API}/analysis/actions/{a['id']}", headers=h).status_code == 204
    viewer = login("viewer")
    assert client.post(f"{API}/analysis/actions", headers=viewer, json={"title": "Yangi chora"}).status_code == 403


# --- Transport turlari: mikser/yuk, nasos, yengil ---------------------------

def test_kind_reports(client, login):
    h = login("manager")

    def mk(plate, kind, own, **extra):
        return client.post(f"{API}/vehicles", headers=h, json={"plate_number": plate, "vehicle_type": "Tr", "kind": kind, "ownership": own, **extra}).json()

    mixer = mk("01A100AA", "mixer", "own", inspection_date=day(-300), inspection_due=day(10))
    pump = mk("01A200AA", "pump", "per_trip", rental_company="Soatbay MChJ")
    car = mk("01A300AA", "car", "own", inspection_date=day(-100), inspection_due=day(-5))
    assert client.post(f"{API}/vehicles", headers=h, json={"plate_number": "01A400AA", "vehicle_type": "Tr", "kind": "car", "ownership": "per_trip"}).status_code == 422
    bad = client.post(f"{API}/vehicles", headers=h, json={"plate_number": "01A500AA", "vehicle_type": "Tr", "ownership": "own", "inspection_date": day(), "inspection_due": day(-1)})
    assert bad.status_code == 422
    assert mixer["inspection_status"] == "soon" and car["inspection_status"] == "overdue" and pump["inspection_status"] == "unknown"

    def expense(v, cat, amount):
        assert client.post(f"{API}/fleet/expenses", headers=h, json={"vehicle_id": v["id"], "expense_date": day(), "category": cat, "fuel_type": "diesel" if cat == "fuel" else None, "amount": amount}).status_code == 201

    expense(mixer, "fuel", 400000); expense(mixer, "parts", 150000); expense(mixer, "other", 50000)
    expense(pump, "fuel", 300000); expense(car, "parts", 80000)
    assert client.post(f"{API}/fleet/breakdowns", headers=h, json={"vehicle_id": mixer["id"], "occurred_on": day(), "description": "Gidravlika oqdi"}).status_code == 201
    assert client.post(f"{API}/fleet/breakdowns", headers=h, json={"vehicle_id": mixer["id"], "occurred_on": day(1), "description": "Kelajak"}).status_code == 422

    def hours(h_, billed):
        return client.post(f"{API}/fleet/work-logs", headers=h, json={"vehicle_id": pump["id"], "work_date": day(), "hours": h_, "billed_to": billed})

    assert hours(6, "company").status_code == 201 and hours(10, "client").status_code == 201
    over = hours(9, "client")
    assert over.status_code == 422 and "24 soat" in over.text
    assert client.post(f"{API}/fleet/taxi", headers=h, json={"ride_date": day(), "amount": 45000, "purpose": "Bank"}).status_code == 201
    assert client.post(f"{API}/fleet/taxi", headers=h, json={"ride_date": day(), "amount": 30000}).status_code == 201

    m = client.get(f"{API}/fleet/kind/mixer", headers=h).json()
    assert m["totals"]["day"]["fuel"] == 400000 and m["totals"]["day"]["parts"] == 150000 and m["totals"]["day"]["other_costs"] == 50000
    assert m["totals"]["month"]["breakdowns"] == 1 and m["totals"]["day"]["expenses_total"] == 600000 and m["inspection"]["soon"] == 1

    p = client.get(f"{API}/fleet/kind/pump", headers=h).json()
    assert p["totals"]["day"]["hours_company"] == 6 and p["totals"]["day"]["hours_client"] == 10 and p["totals"]["month"]["hours"] == 16
    assert p["inspection"]["unknown"] == 1 and p["daily"][-1]["hours"] == 16

    c = client.get(f"{API}/fleet/kind/car", headers=h).json()
    assert c["taxi"]["day"] == {"rides": 2, "amount": 75000} and c["taxi"]["month"]["rides"] == 2 and c["inspection"]["overdue"] == 1
    assert c["totals"]["day"]["parts"] == 80000
    summ = client.get(f"{API}/fleet/summary", headers=h).json()
    assert summ["by_kind"]["car"] == 1 and summ["taxi_month"]["rides"] == 2
    # eski kun: bugungi yozuvlar o'sha kunda ko'rinmaydi
    old = client.get(f"{API}/fleet/kind/mixer?date={day(-40)}", headers=h).json()
    assert old["totals"]["day"]["fuel"] == 0 and old["totals"]["month"]["trips"] == 0
    wl = client.get(f"{API}/fleet/work-logs", headers=h).json()["items"]
    assert client.delete(f"{API}/fleet/work-logs/{wl[0]['id']}", headers=h).status_code == 204
    viewer = login("viewer")
    assert client.get(f"{API}/fleet/kind/pump", headers=viewer).status_code == 200
    assert client.post(f"{API}/fleet/taxi", headers=viewer, json={"ride_date": day(), "amount": 1000}).status_code == 403


# --- Yoqilg'i turlari va haydovchi almashinuvi --------------------------------

def test_fuel_types_and_driver_rotation(client, setup, tomorrow):
    h, oid, own = setup["h"], setup["order_id"], setup["own"]
    d2 = client.post(f"{API}/drivers", headers=h, json={"full_name": "Haydovchi Ikki", "phone": "90 222 33 44"}).json()
    url = f"{API}/orders/{oid}/trips"
    assert client.post(url, headers=h, json={"vehicle_id": own["id"], "volume_m3": 8}).status_code == 201  # odatdagi haydovchi
    assert client.post(url, headers=h, json={"vehicle_id": own["id"], "driver_id": d2["id"], "volume_m3": 8}).status_code == 201

    # bitta mashinani bir kunda ikki haydovchi haydadi
    u = client.get(f"{API}/fleet/usage?date={tomorrow}&vehicle_id={own['id']}", headers=h).json()
    assert u["totals"]["day"]["trips"] == 2 and u["drivers_count"]["day"] == 2
    assert {r["name"] for r in u["by_driver"]} == {"Haydovchi Bir", "Haydovchi Ikki"} and len(u["trips_day"]) == 2
    # haydovchi bo'yicha filtr
    u2 = client.get(f"{API}/fleet/usage?date={tomorrow}&driver_id={d2['id']}", headers=h).json()
    assert u2["totals"]["day"]["trips"] == 1 and len(u2["by_vehicle"]) == 1 and u2["fuel"] is None
    k = client.get(f"{API}/fleet/kind/mixer?date={tomorrow}", headers=h).json()
    row = next(r for r in k["vehicles"] if r["id"] == own["id"])
    assert {d["name"] for d in row["drivers"]} == {"Haydovchi Bir", "Haydovchi Ikki"} and row["default_driver"] == "Haydovchi Bir"
    # bitta haydovchi ikki mashinani haydashi: ikkinchi mashina (ijara)
    client.post(url, headers=h, json={"vehicle_id": setup["rented"]["id"], "driver_id": d2["id"], "volume_m3": 4})
    u3 = client.get(f"{API}/fleet/usage?date={tomorrow}&driver_id={d2['id']}", headers=h).json()
    assert len(u3["by_vehicle"]) == 2 and u3["vehicles_count"]["day"] == 2

    # yoqilg'i: tur majburiy
    base = {"vehicle_id": own["id"], "expense_date": day(), "category": "fuel"}
    assert client.post(f"{API}/fleet/expenses", headers=h, json={**base, "amount": 100000}).status_code == 422
    for ft, amount, qty in (("diesel", 700000, 55), ("diesel", 300000, 25), ("gas", 200000, 120), ("petrol", 150000, 14)):
        assert client.post(f"{API}/fleet/expenses", headers=h, json={**base, "fuel_type": ft, "amount": amount, "quantity": qty}).status_code == 201
    # boshqa kategoriyada yoqilg'i turi saqlanmaydi
    client.post(f"{API}/fleet/expenses", headers=h, json={**base, "category": "parts", "fuel_type": "gas", "amount": 5000})
    assert client.get(f"{API}/fleet/expenses?category=parts", headers=h).status_code == 200
    f = client.get(f"{API}/fleet/fuel?date={day()}", headers=h).json()
    assert f["types"]["day"]["diesel"] == {"cost": 1000000.0, "qty": 80.0, "count": 2}
    assert f["types"]["period"]["gas"]["qty"] == 120 and f["types"]["period"]["petrol"]["cost"] == 150000 and f["total"]["day"] == 1350000
    assert f["vehicles"][0]["by_type"]["diesel"]["cost"] == 1000000 and f["vehicles"][0]["total"] == 1350000
    k2 = client.get(f"{API}/fleet/kind/mixer?date={day()}", headers=h).json()
    assert k2["fuel_types"]["day"]["gas"]["cost"] == 200000 and k2["totals"]["day"]["fuel"] == 1350000
    # eski sana: davr bo'yicha
    old = client.get(f"{API}/fleet/fuel?date={day(-60)}&date_from={day(-90)}&date_to={day(-30)}", headers=h).json()
    assert old["total"]["period"] == 0
    assert client.get(f"{API}/fleet/fuel?date_from={day()}&date_to={day(-5)}", headers=h).status_code == 422


def test_period_params(client, login):
    h = login("manager")
    assert client.get(f"{API}/production/panel?date={day(-40)}", headers=h).json()["today_m3"] == 0
    a = client.get(f"{API}/analysis/overview?date_from={day(-100)}&date_to={day(-70)}", headers=h).json()
    assert a["period_from"] == day(-100) and a["period_to"] == day(-70)
    assert client.get(f"{API}/analysis/overview?date_from={day()}&date_to={day(-3)}", headers=h).status_code == 422
    d = client.get(f"{API}/dashboard?days=60&date_to={day(-10)}", headers=h).json()
    assert len(d["daily"]) == 60 and d["daily"][-1]["date"] == day(-10)
