"""TZ bo'yicha qo'shimchalar: admin buyurtma, oylik bonus va foizlar, nakladnoy, sotuv (qaytgan beton)."""
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select, update

from app.utils.timezone import today_local
from tests.test_fleet import setup  # noqa: F401  (fixture)

API = "/api/v1/admin"


def day(offset=0) -> str:
    return (today_local() + timedelta(days=offset)).isoformat()


def test_admin_creates_order(client, login, make_product, db):
    from app.models import Order

    h = login("manager")
    p = make_product(price=Decimal("700000"))
    body = {"customer_name": "Ahmad Karimov", "phone": "90 123 45 67", "product_id": p.id, "volume_m3": 12.5,
            "delivery_required": True, "delivery_address": "Chilonzor, 5-kvartal", "delivery_date": day(), "comment": "telefon orqali"}
    r = client.post(f"{API}/orders", headers=h, json=body)
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["source"] == "admin" and data["status"] == "new" and data["customer"]["phone"] == "+998901234567"
    order = db.get(Order, data["id"])
    assert order.manager_id is not None and float(order.items[0].volume_m3) == 12.5
    # xatolar
    assert client.post(f"{API}/orders", headers=h, json={**body, "phone": "123"}).status_code == 422
    assert client.post(f"{API}/orders", headers=h, json={**body, "delivery_address": None}).status_code == 422
    assert client.post(f"{API}/orders", headers=h, json={**body, "product_id": 9999}).status_code == 422
    assert client.post(f"{API}/orders", headers=h, json={**body, "volume_m3": 0}).status_code == 422
    # o'zi olib ketadi — manzil kerak emas
    ok = client.post(f"{API}/orders", headers=h, json={**body, "delivery_required": False, "delivery_address": None})
    assert ok.status_code == 201 and ok.json()["delivery_address"] is None
    # ko'rish huquqi bor, lekin boshqaruv yo'q rol — bu yerda faqat autentifikatsiyasiz tekshiramiz
    assert client.post(f"{API}/orders", json=body).status_code == 401


def test_driver_telegram_and_monthly_bonus(client, setup, login, db):
    from app.models import OrderTrip
    from app.models.enums import TripStatus

    h, oid, own = setup["h"], setup["order_id"], setup["own"]
    admin = login("admin")
    d = client.put(f"{API}/drivers/{setup['driver']['id']}", headers=h, json={"full_name": "Haydovchi Bir", "phone": "90 111 22 33", "telegram": "@bir_haydovchi"})
    assert d.status_code == 200 and d.json()["telegram"] == "@bir_haydovchi"
    for vol in (8, 8, 4):
        assert client.post(f"{API}/orders/{oid}/trips", headers=h, json={"vehicle_id": own["id"], "volume_m3": vol}).status_code == 201
    db.execute(update(OrderTrip).values(status=TripStatus.DELIVERED))
    db.commit()
    rng = f"date_from={day(-60)}&date_to={day(3)}"
    # bonus belgilanmagan — standart 10 000
    assert client.get(f"{API}/kpi/drivers?{rng}", headers=admin).json()["totals"]["bonus"] == 30000
    # buyurtma yetkazish sanasi oyi uchun alohida summa
    month = (today_local() + timedelta(days=1)).strftime("%Y-%m")
    cfg = client.put(f"{API}/kpi/config", headers=admin, json={"driver_bonus_per_trip": 15000, "month": month}).json()
    assert cfg["driver_bonus_per_trip"] == 15000 and cfg["month_is_set"] is True
    rep = client.get(f"{API}/kpi/drivers?{rng}", headers=admin).json()
    assert rep["totals"]["bonus"] == 45000 and rep["rows"][0]["bonus_per_trip"] == 15000
    # boshqa oy uchun belgilanmagan — umumiy/standart
    other = client.get(f"{API}/kpi/config?month=2020-01", headers=admin).json()
    assert other["driver_bonus_per_trip"] == 10000 and other["month_is_set"] is False
    assert client.put(f"{API}/kpi/config", headers=admin, json={"driver_bonus_per_trip": 5, "month": "2020-13"}).status_code == 422
    # haydovchi tanlansa — qaysi kuni qayerga qancha beton
    det = client.get(f"{API}/kpi/drivers?{rng}&driver_id={setup['driver']['id']}", headers=admin).json()
    assert len(det["details"]) == 3 and sum(x["volume_m3"] for x in det["details"]) == 20 and det["details"][0]["customer"]


def test_month_rates_approval(client, setup, login, db):
    from app.models import Order, User
    from app.models.enums import OrderStatus

    oid = setup["order_id"]
    admin = login("admin")
    seller = db.scalar(select(User).where(User.username == "admin"))
    order = db.get(Order, oid)
    total = float(order.grand_total if order.grand_total is not None else order.concrete_total)
    order.status = OrderStatus.DELIVERED
    order.delivery_date = today_local() - timedelta(days=3)
    db.commit()
    assert client.put(f"{API}/kpi/orders/{oid}/manager", headers=admin, json={"manager_id": seller.id}).status_code == 200
    assert client.post(f"{API}/kpi/orders/{oid}/payments", headers=admin, json={"amount": 10_000_000, "paid_on": day(-1)}).status_code == 201
    q = f"date_from={day(-10)}&date_to={day()}"
    g = client.get(f"{API}/kpi/sales?{q}", headers=admin).json()["rows"][0]
    assert g["bonus"] == 500000 and g["rates"]["source"] == "default" and total > 10_000_000
    cid = g["customer_id"]
    month = (today_local() - timedelta(days=3)).strftime("%Y-%m")
    # shu oy uchun alohida foiz
    assert client.put(f"{API}/kpi/customers/{cid}/rates?month={month}", headers=admin, json={"pct_10": 7, "pct_20": 4, "pct_30": 2, "pct_over": 1}).status_code == 200
    g = client.get(f"{API}/kpi/sales?{q}", headers=admin).json()["rows"][0]
    assert g["bonus"] == 700000 and g["rates"]["source"] == "month" and g["rates"]["approved"] is False
    # tasdiqlash — keyin o'zgartirib bo'lmaydi
    st = client.post(f"{API}/kpi/rates/approve", headers=admin, json={"month": month_of(day(-3))}).json()
    assert st["approved"] == 1
    locked = client.put(f"{API}/kpi/customers/{cid}/rates?month={month}", headers=admin, json={"pct_10": 1, "pct_20": 1, "pct_30": 1, "pct_over": 1})
    assert locked.status_code == 409
    # doimiy foiz o'zgarsa ham tasdiqlangan oy o'zgarmaydi
    client.put(f"{API}/kpi/customers/{cid}/rates", headers=admin, json={"pct_10": 1, "pct_20": 1, "pct_30": 1, "pct_over": 1})
    g = client.get(f"{API}/kpi/sales?{q}", headers=admin).json()
    assert g["rows"][0]["bonus"] == 700000 and g["rows"][0]["rates"]["approved"] is True and g["month_status"]["approved"] == 1
    # tasdiqni bekor qilish
    assert client.delete(f"{API}/kpi/rates/approve/{month}", headers=admin).json()["approved"] == 0
    assert client.delete(f"{API}/kpi/customers/{cid}/rates?month={month}", headers=admin).status_code == 204
    assert client.get(f"{API}/kpi/sales?{q}", headers=admin).json()["rows"][0]["bonus"] == 100000  # doimiy 1%


def month_of(iso: str) -> str:
    return iso[:7]


def test_production_consumes_materials_and_waybill(client, setup, login, make_product, db):
    from app.models import StockMovement

    admin = login("admin")
    oid = setup["order_id"]
    wh = client.post(f"{API}/warehouse/warehouses", headers=admin, json={"name": "Asosiy ombor"}).json()
    cement = client.post(f"{API}/warehouse/materials", headers=admin, json={"name": "Sement", "category": "cement", "unit": "ton", "norm_per_m3": 0.3}).json()
    no_norm = client.post(f"{API}/warehouse/materials", headers=admin, json={"name": "Boshqa", "category": "other", "unit": "kg"}).json()
    assert client.post(f"{API}/warehouse/movements", headers=admin, json={"kind": "in", "material_id": cement["id"], "warehouse_id": wh["id"], "quantity": 100, "movement_date": day()}).status_code == 201
    order = client.get(f"{API}/orders/{oid}", headers=admin).json()
    product_id = order["items"][0]["product_id"]
    mixer = setup["own"]
    prod = login("production", username="usta")
    # mikser ro'yxatdan tanlanishi shart
    pump = client.post(f"{API}/vehicles", headers=admin, json={"plate_number": "01P999PP", "vehicle_type": "Nasos", "kind": "pump", "ownership": "own"}).json()
    bad = client.post(f"{API}/production/records", headers=prod, json={"order_id": oid, "product_id": product_id, "produced_volume_m3": 10, "vehicle_id": pump["id"]})
    assert bad.status_code == 422
    r = client.post(f"{API}/production/records", headers=prod, json={"order_id": oid, "product_id": product_id, "produced_volume_m3": 10, "vehicle_id": mixer["id"]})
    assert r.status_code == 201, r.text
    rec = r.json()
    assert rec["waybill_no"].startswith("NK-") and rec["plate_number"] == mixer["plate_number"] and rec["customer_name"]
    # me'yor bo'yicha avtomat chiqim: 0.3 t × 10 m³ = 3 t; me'yori yo'q material tegilmaydi
    moves = list(db.scalars(select(StockMovement).where(StockMovement.production_record_id == rec["id"])))
    assert len(moves) == 1 and float(moves[0].quantity) == -3 and moves[0].material_id == cement["id"] and no_norm["id"] != moves[0].material_id
    stock = {m["id"]: m for m in client.get(f"{API}/warehouse/materials", headers=admin).json()["items"]}
    assert stock[cement["id"]]["stock"] == 97
    # nakladnoy
    wb = client.get(f"{API}/production/records/{rec['id']}/waybill", headers=prod).json()
    assert wb["number"] == rec["waybill_no"] and wb["volume_m3"] == 10 and wb["vehicle"] == mixer["plate_number"] and wb["driver"] == "Haydovchi Bir"
    assert wb["customer"] and wb["address"] and wb["materials"] == [{"name": "Sement", "unit": "ton", "quantity": 3.0}]
    assert "price" not in str(wb).lower()
    # yozuv o'chirilsa chiqim ham qaytariladi
    assert client.delete(f"{API}/production/records/{rec['id']}", headers=prod).status_code == 204
    assert {m["id"]: m for m in client.get(f"{API}/warehouse/materials", headers=admin).json()["items"]}[cement["id"]]["stock"] == 100


def test_sales_overview_and_returns(client, setup, login, db):
    from app.models import Order
    from app.models.enums import OrderStatus

    admin = login("admin")
    oid = setup["order_id"]
    order = client.get(f"{API}/orders/{oid}", headers=admin).json()
    product_id = order["items"][0]["product_id"]
    prod = login("production", username="usta")
    client.post(f"{API}/production/records", headers=prod, json={"order_id": oid, "product_id": product_id, "produced_volume_m3": 20})
    o = db.get(Order, oid)
    o.status = OrderStatus.DELIVERED
    o.delivery_date = today_local()
    db.commit()
    q = f"date_from={day(-5)}&date_to={day(1)}"
    ov = client.get(f"{API}/sales/overview?{q}", headers=admin).json()
    assert ov["totals"]["produced_m3"] == 20 and ov["totals"]["sold_m3"] == 20 and ov["totals"]["difference_m3"] == 0
    # mijoz 5 m³ olmadi — brak bo'ldi; yana 3 m³ boshqaga sotildi; 2 m³ kutilmoqda
    base = {"returned_on": day(), "order_id": oid, "reason": "Mijoz olmadi"}
    assert client.post(f"{API}/sales/returns", headers=admin, json={**base, "volume_m3": 5, "outcome": "brak"}).status_code == 201
    assert client.post(f"{API}/sales/returns", headers=admin, json={**base, "volume_m3": 3, "outcome": "resold"}).status_code == 422  # kimga?
    assert client.post(f"{API}/sales/returns", headers=admin, json={**base, "volume_m3": 3, "outcome": "resold", "resold_order_id": oid}).status_code == 201
    pend = client.post(f"{API}/sales/returns", headers=admin, json={**base, "volume_m3": 2}).json()
    assert client.post(f"{API}/sales/returns", headers=admin, json={**base, "volume_m3": 1, "returned_on": day(2)}).status_code == 422
    ov = client.get(f"{API}/sales/overview?{q}", headers=admin).json()
    t = ov["totals"]
    assert t["brak_m3"] == 5 and t["resold_m3"] == 3 and t["returned_pending_m3"] == 2 and t["difference_m3"] == 20 - 20 - 2 - 5
    assert len(ov["returns"]) == 3 and ov["rows"][0]["grade"]
    assert client.put(f"{API}/sales/returns/{pend['id']}", headers=admin, json={**base, "volume_m3": 2, "outcome": "brak"}).status_code == 200
    assert client.delete(f"{API}/sales/returns/{pend['id']}", headers=admin).status_code == 204
    assert client.get(f"{API}/sales/overview?{q}", headers=admin).json()["totals"]["returned_pending_m3"] == 0
    # davr noto'g'ri
    assert client.get(f"{API}/sales/overview?date_from={day()}&date_to={day(-1)}", headers=admin).status_code == 422


def test_admin_order_price_and_counts(client, login, make_product):
    h = login("manager")
    p = make_product(price=Decimal("700000"))
    body = {"customer_name": "Ahmad Karimov", "phone": "90 123 45 67", "product_id": p.id, "volume_m3": 10,
            "delivery_required": False, "delivery_date": day()}
    priced = client.post(f"{API}/orders", headers=h, json={**body, "unit_price": 650000}).json()
    assert priced["concrete_total"] == 6500000 and priced["items"][0]["unit_price"] == 650000  # katalog narxi emas, kiritilgani
    open_ = client.post(f"{API}/orders", headers=h, json=body).json()
    assert open_["concrete_total"] is None and open_["items"][0]["unit_price"] is None
    c = client.get(f"{API}/orders/counts", headers=h).json()
    assert c["total"] == 2 and c["statuses"]["new"] == 2 and c["priced"] == 1 and c["unpriced"] == 1
    miss = client.get(f"{API}/orders?price=missing", headers=h).json()
    assert [o["id"] for o in miss["items"]] == [open_["id"]]
    assert client.get(f"{API}/orders?price=set", headers=h).json()["total"] == 1
    # narxni keyin kiritish (Narxlar bo'limi)
    item = open_["items"][0]["id"]
    done = client.patch(f"{API}/orders/{open_['id']}/items/{item}", headers=h, json={"unit_price": 600000}).json()
    assert done["concrete_total"] == 6000000
    assert client.get(f"{API}/orders?price=missing", headers=h).json()["total"] == 0
