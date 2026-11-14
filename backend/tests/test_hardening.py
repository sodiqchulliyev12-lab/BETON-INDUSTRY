"""Production himoya qatlamlari: hajm chegarasi, kesh sarlavhalari, GZip, Host tekshiruvi."""
from fastapi.testclient import TestClient

from app.config import settings


def test_oversized_request_rejected(client):
    big = b"x" * (settings.MAX_REQUEST_BYTES + 1)
    r = client.post("/api/v1/public/callback-requests", content=big, headers={"Content-Type": "application/json"})
    assert r.status_code == 413
    assert "juda katta" in r.json()["detail"]


def test_cache_headers(client):
    assert client.get("/").headers["cache-control"] == "no-cache"
    # CSS/JS versiyasiz — deploydan keyin eski nusxa qolib ketmasligi uchun har safar tekshiriladi
    assert client.get("/css/base.css").headers["cache-control"] == "no-cache"
    assert client.get("/js/admin/app.js").headers["cache-control"] == "no-cache"
    assert client.get("/assets/icons/sprite.svg").headers["cache-control"] == "public, max-age=3600"
    assert client.get("/api/v1/health").headers["cache-control"] == "no-store"
    assert client.get("/api/v1/public/products").headers["cache-control"] == "public, max-age=30"


def test_csp_sent_on_304_revalidation(client):
    """Keshdagi sahifa 304 bilan tasdiqlanganda ham joriy CSP yuboriladi (CSP o'zgarsa darhol kuchga kiradi)."""
    first = client.get("/contact.html")
    etag = first.headers["etag"]
    again = client.get("/contact.html", headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert "tile.openstreetmap.org" in again.headers["content-security-policy"]


def test_gzip_for_large_responses(client):
    r = client.get("/css/components.css", headers={"Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip"


def test_trusted_hosts(monkeypatch):
    monkeypatch.setattr(settings, "ALLOWED_HOSTS", "beton.example")
    from app.main import create_app

    with TestClient(create_app(), base_url="http://beton.example") as ok_client:
        assert ok_client.get("/api/v1/health").status_code == 200
    with TestClient(create_app(), base_url="http://evil.example") as bad_client:
        assert bad_client.get("/").status_code == 400
        assert bad_client.get("/api/v1/public/products").status_code == 400
        # healthcheck (Railway / Docker) boshqa host bilan keladi — u ochiq qoladi
        assert bad_client.get("/api/v1/health").status_code == 200


def test_docs_disabled_in_production(monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "production")
    from app.main import create_app

    with TestClient(create_app()) as prod:
        assert prod.get("/api/docs").status_code == 404
        assert prod.get("/api/openapi.json").status_code == 404
        assert "strict-transport-security" in prod.get("/api/v1/health").headers
