"""Telegram xabarnomalari. Haqiqiy Telegram'ga so'rov yuborilmaydi — soxta server (MockTransport)."""
import json
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import text

from app.config import settings
from app.services import telegram
from tests.test_public_api import order_payload

FAKE_TOKEN = "123456:TEST-token-never-real"


class FakeTelegram:
    def __init__(self):
        self.sent: list[dict] = []
        self.fail_with: tuple[int, str] | None = None
        self.reject_html = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        method = request.url.path.rsplit("/", 1)[-1]
        body = json.loads(request.content or b"{}")
        if self.fail_with:
            code, desc = self.fail_with
            return httpx.Response(code, json={"ok": False, "description": desc})
        if method == "sendMessage":
            if self.reject_html and body.get("parse_mode") == "HTML":
                return httpx.Response(400, json={"ok": False, "description": "Bad Request: can't parse entities"})
            self.sent.append(body)
            return httpx.Response(200, json={"ok": True, "result": {"message_id": len(self.sent)}})
        if method == "getMe":
            return httpx.Response(200, json={"ok": True, "result": {"username": "beton_test_bot", "first_name": "Beton"}})
        if method == "getUpdates":
            return httpx.Response(200, json={"ok": True, "result": [
                {"message": {"chat": {"id": -1001234567890, "type": "supergroup", "title": "Dispetcherlar"}}},
                {"message": {"chat": {"id": 555000111, "type": "private", "first_name": "Ali"}}},
            ]})
        return httpx.Response(404, json={"ok": False, "description": "Not Found"})


@pytest.fixture
def tg(monkeypatch):
    fake = FakeTelegram()
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", FAKE_TOKEN)
    monkeypatch.setattr(settings, "PUBLIC_BASE_URL", "https://beton.example")
    monkeypatch.setattr(telegram, "http_transport", httpx.MockTransport(fake.handler))
    return fake


def enable(client, headers, **overrides):
    body = {"is_enabled": True, "chat_ids": ["-1001234567890"], "notify_new_order": True,
            "notify_status_change": True, "notify_callback": True, "message_template": None}
    body.update(overrides)
    r = client.put("/api/v1/admin/telegram", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_settings_validation_and_token_never_exposed(client, login, tg):
    admin = login()
    data = client.get("/api/v1/admin/telegram", headers=admin).json()
    assert data["token_configured"] is True
    assert FAKE_TOKEN not in json.dumps(data)

    r = client.put("/api/v1/admin/telegram", headers=admin, json={"is_enabled": True, "chat_ids": []})
    assert r.status_code == 422  # chat'siz yoqib bo'lmaydi
    r = client.put("/api/v1/admin/telegram", headers=admin, json={"is_enabled": False, "chat_ids": ["salom dunyo"]})
    assert r.status_code == 422
    r = client.put("/api/v1/admin/telegram", headers=admin, json={"is_enabled": False, "chat_ids": [], "message_template": "{order_number} {parol}"})
    assert r.status_code == 422 and "{parol}" in r.json()["detail"][0]["msg"]

    saved = enable(client, admin, chat_ids=["-1001234567890", " @beton_kanal ", "-1001234567890"])
    assert saved["chat_ids"] == ["-1001234567890", "@beton_kanal"]  # bo'shliq va takror olib tashlandi


def test_new_order_notification_content_is_escaped(client, login, make_product, tomorrow, tg):
    enable(client, login())
    product = make_product(price=Decimal("750000"))
    r = client.post("/api/v1/public/orders", json=order_payload(
        product.id, tomorrow, volume_m3=10, comment="<b>shoshilinch</b> & tez", customer_name="Ali <script>",
    ))
    assert r.status_code == 201
    assert len(tg.sent) == 1
    msg = tg.sent[0]
    assert msg["chat_id"] == "-1001234567890" and msg["parse_mode"] == "HTML"
    assert r.json()["order_number"] in msg["text"]
    assert "&lt;b&gt;shoshilinch&lt;/b&gt; &amp; tez" in msg["text"]  # foydalanuvchi matni HTML sifatida ishlamaydi
    assert "<script>" not in msg["text"]
    assert "7 500 000 so‘m + yetkazib berish (tasdiqlanmagan)" in msg["text"]
    assert 'href="https://beton.example/admin/#/orders/' in msg["text"]


def test_custom_template(client, login, make_product, tomorrow, tg):
    enable(client, login(), message_template="Buyurtma {order_number}: {products}, {total}")
    product = make_product(price=None)
    client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow, volume_m3=3))
    assert tg.sent[0]["text"].startswith("Buyurtma BI-")
    assert "Narx belgilanmagan" in tg.sent[0]["text"]


def test_status_change_and_callback_notifications(client, login, make_product, tomorrow, tg):
    admin = login()
    enable(client, admin)
    product = make_product()
    client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow))
    oid = client.get("/api/v1/admin/orders", headers=admin).json()["items"][0]["id"]
    client.post(f"/api/v1/admin/orders/{oid}/status", headers=admin, json={"status": "cancelled", "cancel_reason": "Mijoz voz kechdi"})
    status_msg = tg.sent[-1]["text"]
    assert "Yangi → <b>Bekor qilindi</b>" in status_msg and "Mijoz voz kechdi" in status_msg and "Admin Test" in status_msg

    client.post("/api/v1/public/callback-requests", json={"name": "Vali", "phone": "+998911112233", "message": "Narx?"})
    assert "Qayta qo‘ng‘iroq" in tg.sent[-1]["text"] and "+998911112233" in tg.sent[-1]["text"]


def test_disabled_flags_send_nothing(client, login, make_product, tomorrow, tg):
    enable(client, login(), is_enabled=False)
    product = make_product()
    client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow))
    client.post("/api/v1/public/callback-requests", json={"name": "Vali", "phone": "+998911112233"})
    assert tg.sent == []


def test_telegram_failure_does_not_break_order_and_is_logged(client, login, make_product, tomorrow, tg, db):
    enable(client, login())
    tg.fail_with = (403, f"Forbidden: bot was blocked by the user (token {FAKE_TOKEN})")
    product = make_product()
    r = client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow))
    assert r.status_code == 201  # buyurtma baribir qabul qilindi
    row = db.execute(text("SELECT event, status, error FROM notification_logs")).one()
    assert row.event == "new_order" and row.status == "failed"
    assert "bot was blocked" in row.error and FAKE_TOKEN not in row.error  # token jurnalga tushmaydi


def test_invalid_html_falls_back_to_plain_text(client, login, make_product, tomorrow, tg):
    enable(client, login(), message_template="<b>{order_number}")
    tg.reject_html = True
    product = make_product()
    client.post("/api/v1/public/orders", json=order_payload(product.id, tomorrow))
    assert len(tg.sent) == 1 and "parse_mode" not in tg.sent[0]
    assert tg.sent[0]["text"].startswith("BI-")


def test_test_message_bot_info_and_chat_discovery(client, login, tg):
    admin = login()
    results = client.post("/api/v1/admin/telegram/test", headers=admin, json={"chat_id": "555000111"}).json()
    assert results == [{"chat_id": "555000111", "ok": True, "error": None}]
    assert "sinov xabari" in tg.sent[0]["text"]

    assert client.post("/api/v1/admin/telegram/bot-info", headers=admin).json()["username"] == "beton_test_bot"
    chats = client.post("/api/v1/admin/telegram/discover-chats", headers=admin).json()
    assert {c["id"] for c in chats} == {"-1001234567890", "555000111"}
    assert client.get("/api/v1/admin/telegram", headers=admin).json()["logs"][0]["event"] == "test"


def test_without_token(client, login, monkeypatch):
    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", None)
    admin = login()
    assert client.get("/api/v1/admin/telegram", headers=admin).json()["token_configured"] is False
    r = client.post("/api/v1/admin/telegram/test", headers=admin, json={"chat_id": "555000111"})
    assert r.status_code == 422 and "TELEGRAM_BOT_TOKEN" in r.json()["detail"]


def test_telegram_permissions(client, login):
    manager = login("manager")
    assert client.get("/api/v1/admin/telegram", headers=manager).status_code == 200  # ko'rish mumkin
    assert client.put("/api/v1/admin/telegram", headers=manager, json={"is_enabled": False, "chat_ids": []}).status_code == 403
    assert client.post("/api/v1/admin/telegram/test", headers=manager, json={}).status_code == 403
