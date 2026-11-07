"""Testlar haqiqiy PostgreSQL'da ishlaydi (JSONB, ENUM, ketma-ketliklar SQLite'da yo'q).

Alohida test bazasi kerak — u har ishga tushirishda TOZALANADI:
    TEST_DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/beton_test pytest
"""
import os
import tempfile
from datetime import timedelta
from decimal import Decimal

import pytest

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
if not TEST_DATABASE_URL:
    pytest.skip("TEST_DATABASE_URL berilmagan — testlar o‘tkazib yuborildi.", allow_module_level=True)

# Ilova import qilinishidan OLDIN muhitni sozlaymiz
os.environ.update({
    "DATABASE_URL": TEST_DATABASE_URL,
    "APP_ENV": "test",
    "SECRET_KEY": "test-secret-key-only-for-automated-tests-0123456789",
    "RATE_LIMIT_ENABLED": "false",
    "ALLOWED_ORIGINS": "http://localhost:5500",
    "SERVE_FRONTEND": "true",
    "UPLOAD_DIR": tempfile.mkdtemp(prefix="beton-test-uploads-"),
})

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import BACKEND_DIR  # noqa: E402
from app.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import ConcretePrice, ConcreteProduct  # noqa: E402
from app.utils.timezone import today_local  # noqa: E402

DATA_TABLES = [
    "notification_logs", "order_trips", "production_records", "production_plans", "order_status_history", "order_items",
    "orders", "callback_requests", "customers", "concrete_prices", "concrete_products",
    "project_images", "projects", "vehicles", "drivers",
]
# users bu ro'yxatda yo'q: "TRUNCATE users CASCADE" unga FK bilan bog'langan
# system_settings va telegram_settings'ni ham tozalab yuboradi. Shuning uchun DELETE ishlatiladi.


@pytest.fixture(scope="session", autouse=True)
def migrated_database():
    """Sessiya boshida bazani noldan migratsiya qiladi (migratsiyaning o'zi ham shu bilan tekshiriladi)."""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL.replace("%", "%%"))
    cfg.attributes["configure_logger"] = False
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield
    engine.dispose()


@pytest.fixture(autouse=True)
def clean_tables():
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {', '.join(DATA_TABLES)} RESTART IDENTITY CASCADE"))
        conn.execute(text("UPDATE system_settings SET value = NULL, updated_by_id = NULL"))
        conn.execute(text(
            "UPDATE telegram_settings SET updated_by_id = NULL, is_enabled = false, chat_ids = '[]'::jsonb, "
            "notify_new_order = true, notify_status_change = false, notify_callback = true, message_template = NULL"
        ))
        conn.execute(text("DELETE FROM users"))
        conn.execute(text("ALTER SEQUENCE order_number_seq RESTART WITH 1"))
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


@pytest.fixture
def make_product(db):
    def _make(slug="b25", price: Decimal | None = Decimal("750000"), **kwargs):
        product = ConcreteProduct(
            slug=slug,
            name=kwargs.pop("name", f"Beton {slug.upper()}"),
            grade_class=kwargs.pop("grade_class", slug.upper()),
            **kwargs,
        )
        db.add(product)
        db.flush()
        if price is not None:
            db.add(ConcretePrice(product_id=product.id, price_per_m3=price))
        db.commit()
        return product

    return _make


@pytest.fixture
def tomorrow() -> str:
    return (today_local() + timedelta(days=1)).isoformat()


TEST_PASSWORD = "TestParol2026"


@pytest.fixture
def make_user(db):
    from app.auth import hash_password
    from app.models import User

    def _make(username="admin", role="admin", password=TEST_PASSWORD, is_active=True):
        user = User(username=username, full_name=f"{username.title()} Test", role=role,
                    password_hash=hash_password(password), is_active=is_active)
        db.add(user)
        db.commit()
        return user

    return _make


@pytest.fixture
def login(client, make_user):
    """Berilgan rol bilan foydalanuvchi yaratib, Authorization headerini qaytaradi."""

    def _login(role="admin", username=None):
        username = username or role
        make_user(username=username, role=role)
        r = client.post("/api/v1/auth/login", json={"username": username, "password": TEST_PASSWORD})
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    return _login
