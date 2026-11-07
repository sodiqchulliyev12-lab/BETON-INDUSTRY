"""Birinchi administratorni muhit o'zgaruvchilaridan yaratish (python -m app.cli bootstrap-admin)."""
from sqlalchemy import select

from app.auth import verify_password
from app.cli import main
from app.models import User


def run(monkeypatch, **env):
    for key in ("ADMIN_USERNAME", "ADMIN_PASSWORD", "ADMIN_FULL_NAME"):
        monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return main(["bootstrap-admin"])


def admins(db):
    db.expire_all()
    return db.scalars(select(User).where(User.role == "admin")).all()


def test_creates_first_admin_and_can_login(client, db, monkeypatch, capsys):
    assert run(monkeypatch, ADMIN_USERNAME="SodiqAdmin", ADMIN_PASSWORD="Parol12345x", ADMIN_FULL_NAME="Sodiq") == 0
    users = admins(db)
    assert len(users) == 1 and users[0].username == "sodiqadmin" and users[0].full_name == "Sodiq"
    assert verify_password("Parol12345x", users[0].password_hash)
    assert "Parol12345x" not in capsys.readouterr().out  # parol logga chiqmaydi
    r = client.post("/api/v1/auth/login", json={"username": "sodiqadmin", "password": "Parol12345x"})
    assert r.status_code == 200


def test_does_nothing_when_admin_exists(db, monkeypatch, make_user):
    make_user("bor_admin", role="admin")
    assert run(monkeypatch, ADMIN_USERNAME="yangi", ADMIN_PASSWORD="Parol12345x") == 0
    assert [u.username for u in admins(db)] == ["bor_admin"]  # mavjud admin parolini ham, ro'yxatni ham o'zgartirmaydi


def test_weak_password_or_missing_vars_skip_without_failing(db, monkeypatch):
    assert run(monkeypatch, ADMIN_USERNAME="admin", ADMIN_PASSWORD="45678") == 0
    assert run(monkeypatch) == 0
    assert run(monkeypatch, ADMIN_USERNAME="a!", ADMIN_PASSWORD="Parol12345x") == 0
    assert admins(db) == []
