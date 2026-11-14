"""Telegram guruhlari → baza → Google Sheets (1-bosqich: xabarlar o'zgartirilmasdan saqlanadi)."""
import json

import httpx
import pytest
from sqlalchemy import text

from app.config import settings
from app.services import sheets, telegram, telegram_inbox

SHEETS_URL = "https://script.google.com/macros/s/TEST123/exec"
GROUP_ID = -1001234567890


class FakeSheets:
    def __init__(self):
        self.rows: list[dict] = []
        self.fail = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if body.get("secret") != sheets.secret():
            return httpx.Response(200, json={"ok": False, "error": "Ruxsat yo‘q"})
        if self.fail:
            return httpx.Response(200, json={"ok": False, "error": "Exception: Service unavailable"})
        if body["action"] == "ping":
            return httpx.Response(200, json={"ok": True, "spreadsheet": "BETON"})
        self.rows.append(body)
        return httpx.Response(200, json={"ok": True})


@pytest.fixture
def gs(monkeypatch):
    fake = FakeSheets()
    monkeypatch.setattr(sheets, "http_transport", httpx.MockTransport(fake.handler))
    return fake


def hook(client, update, secret=None):
    return client.post(
        "/api/v1/telegram/webhook",
        json=update,
        headers={"X-Telegram-Bot-Api-Secret-Token": secret if secret is not None else telegram_inbox.webhook_secret()},
    )


def msg(message_id=1, text_="B25 8 kub 01A123BC", chat_id=GROUP_ID, chat_type="supergroup", edited=False, **extra):
    key = "edited_message" if edited else "message"
    body = {
        "message_id": message_id,
        "date": 1794100000,
        "chat": {"id": chat_id, "type": chat_type, "title": "Ishlab chiqarish"},
        "from": {"id": 555, "first_name": "Akmal", "last_name": "Usta"},
        "text": text_,
        **extra,
    }
    if edited:
        body["edit_date"] = 1794100300
    return {"update_id": message_id, key: body}


def rows(db, sql):
    return db.execute(text(sql)).all()


def test_webhook_rejects_wrong_secret(client, db):
    assert hook(client, msg(), secret="xato").status_code == 403
    assert client.post("/api/v1/telegram/webhook", json=msg()).status_code == 403
    assert rows(db, "SELECT * FROM telegram_messages") == []


def test_group_messages_saved_private_ignored_duplicates_skipped(client, db):
    assert hook(client, msg(1)).json() == {"ok": True}
    hook(client, msg(1))  # Telegram qayta yubordi
    hook(client, msg(2, "salom", chat_id=555, chat_type="private"))  # shaxsiy chat
    hook(client, msg(3, None, caption="Nakladnoy rasmi", photo=[{"file_id": "x"}]))

    saved = rows(db, "SELECT message_id, from_name, content_type, text, sheets_status FROM telegram_messages ORDER BY message_id")
    assert [tuple(r) for r in saved] == [
        (1, "Akmal Usta", "text", "B25 8 kub 01A123BC", "skipped"),   # guruh vazifasi hali belgilanmagan
        (3, "Akmal Usta", "photo", "Nakladnoy rasmi", "skipped"),
    ]
    chat = rows(db, "SELECT chat_id, title, purpose FROM telegram_chats")
    assert [tuple(r) for r in chat] == [(GROUP_ID, "Ishlab chiqarish", None)]


def test_assign_purpose_pushes_old_messages_and_edits_update_row(client, db, login, gs):
    admin = login()
    hook(client, msg(1))
    client.put("/api/v1/admin/telegram/sheets", headers=admin, json={"url": SHEETS_URL})
    assert gs.rows == []  # vazifa belgilanmagan — jadvalga yuborilmaydi

    r = client.patch(f"/api/v1/admin/telegram/chats/{GROUP_ID}", headers=admin, json={"purpose": "production"})
    assert r.status_code == 200 and r.json()["pending_count"] == 0
    assert len(gs.rows) == 1
    sent = gs.rows[0]
    assert sent["sheet"] == "Xom — Ishlab chiqarish"
    assert sent["row"][2:5] == ["Ishlab chiqarish", "Akmal Usta", "B25 8 kub 01A123BC"]
    assert sent["row"][7] == "https://t.me/c/1234567890/1"
    assert sent["row"][-1] == f"{GROUP_ID}:1"

    hook(client, msg(1, "B25 9 kub 01A123BC", edited=True))
    assert len(gs.rows) == 2 and gs.rows[1]["row"][4] == "B25 9 kub 01A123BC" and gs.rows[1]["row"][-1] == f"{GROUP_ID}:1"
    assert rows(db, "SELECT text, sheets_status FROM telegram_messages")[0] == ("B25 9 kub 01A123BC", "sent")


def test_sheets_failure_is_recorded_and_resync_works(client, db, login, gs):
    admin = login()
    client.put("/api/v1/admin/telegram/sheets", headers=admin, json={"url": SHEETS_URL})
    hook(client, msg(1))
    client.patch(f"/api/v1/admin/telegram/chats/{GROUP_ID}", headers=admin, json={"purpose": "cash"})
    gs.fail = True
    hook(client, msg(2, "Kirim 5 000 000 so'm, bank"))
    status = dict(rows(db, "SELECT message_id, sheets_status FROM telegram_messages"))
    assert status == {1: "sent", 2: "failed"}

    gs.fail = False
    assert client.post("/api/v1/admin/telegram/sheets/resync", headers=admin).json() == {"sent": 1, "failed": 0}
    assert gs.rows[-1]["sheet"] == "Xom — Kassa-Bank"


def test_ignored_group_not_saved(client, db, login):
    admin = login()
    hook(client, msg(1))
    client.patch(f"/api/v1/admin/telegram/chats/{GROUP_ID}", headers=admin, json={"purpose": "ignore"})
    hook(client, msg(2, "shaxsiy gap"))
    assert [r[0] for r in rows(db, "SELECT message_id FROM telegram_messages")] == [1]


def test_sheets_url_validation_and_script(client, login, gs):
    admin = login()
    r = client.put("/api/v1/admin/telegram/sheets", headers=admin, json={"url": "https://evil.example/exec"})
    assert r.status_code == 422
    gs.fail = True
    r = client.put("/api/v1/admin/telegram/sheets", headers=admin, json={"url": SHEETS_URL})
    assert r.status_code == 422 and "ulanib bo‘lmadi" in r.json()["detail"][0]["msg"]

    data = client.get("/api/v1/admin/telegram/sheets", headers=admin).json()
    assert sheets.secret() in data["script"] and "{{SECRET}}" not in data["script"]
    assert data["url"] is None


def test_journal_and_permissions(client, login):
    admin = login()
    hook(client, msg(1))
    page = client.get("/api/v1/admin/telegram/messages", headers=admin).json()
    assert page["total"] == 1 and page["items"][0]["chat_title"] == "Ishlab chiqarish"

    manager = login("manager")
    for path in ("/api/v1/admin/telegram/messages", "/api/v1/admin/telegram/chats", "/api/v1/admin/telegram/sheets"):
        assert client.get(path, headers=manager).status_code == 403  # kassa ma'lumotlari faqat administratorga


def test_bot_token_not_logged(monkeypatch, caplog):
    """httpx so'rov URL'ini (ichida bot tokeni) INFO darajasida jurnalga yozmasligi kerak."""
    import logging

    import app.main  # noqa: F401  — jurnal sozlamalari shu yerda o'rnatiladi

    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "123:SECRET-TOKEN")
    monkeypatch.setattr(telegram, "http_transport", httpx.MockTransport(lambda r: httpx.Response(200, json={"ok": True, "result": {}})))
    with caplog.at_level(logging.INFO):
        telegram.call("getMe")
    assert "SECRET-TOKEN" not in caplog.text


def test_cli_installs_webhook(monkeypatch):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.url.path.rsplit("/", 1)[-1], json.loads(request.content)))
        return httpx.Response(200, json={"ok": True, "result": True})

    monkeypatch.setattr(settings, "TELEGRAM_BOT_TOKEN", "1:fake")
    monkeypatch.setattr(settings, "PUBLIC_BASE_URL", "https://beton.example")
    monkeypatch.setattr(telegram, "http_transport", httpx.MockTransport(handler))
    from app.cli import main

    assert main(["telegram-webhook"]) == 0
    method, body = calls[0]
    assert method == "setWebhook"
    assert body["url"] == "https://beton.example/api/v1/telegram/webhook"
    assert body["secret_token"] == telegram_inbox.webhook_secret()
    assert "edited_message" in body["allowed_updates"]
