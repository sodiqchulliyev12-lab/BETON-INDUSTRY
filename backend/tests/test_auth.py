from tests.conftest import TEST_PASSWORD


def test_login_success_sets_httponly_refresh_cookie(client, make_user):
    make_user("ali", role="manager")
    r = client.post("/api/v1/auth/login", json={"username": "ALI", "password": TEST_PASSWORD})
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["role"] == "manager"
    assert "orders.manage" in body["user"]["permissions"]
    assert "users.manage" not in body["user"]["permissions"]
    cookie = r.headers["set-cookie"]
    assert "beton_refresh=" in cookie and "HttpOnly" in cookie and "SameSite=strict" in cookie
    assert "Path=/api/v1/auth" in cookie


def test_login_wrong_password_and_unknown_user_same_message(client, make_user):
    make_user("ali")
    r1 = client.post("/api/v1/auth/login", json={"username": "ali", "password": "notogri"})
    r2 = client.post("/api/v1/auth/login", json={"username": "yoq", "password": "notogri"})
    assert r1.status_code == r2.status_code == 401
    assert r1.json() == r2.json()


def test_blocked_user_cannot_login(client, make_user):
    make_user("ali", is_active=False)
    assert client.post("/api/v1/auth/login", json={"username": "ali", "password": TEST_PASSWORD}).status_code == 403


def test_admin_endpoints_require_token(client):
    assert client.get("/api/v1/admin/dashboard").status_code == 401
    assert client.get("/api/v1/admin/dashboard", headers={"Authorization": "Bearer xato"}).status_code == 401


def test_refresh_and_logout(client, make_user):
    make_user("ali")
    client.post("/api/v1/auth/login", json={"username": "ali", "password": TEST_PASSWORD})
    r = client.post("/api/v1/auth/refresh")
    assert r.status_code == 200
    token = r.json()["access_token"]
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["username"] == "ali"

    assert client.post("/api/v1/auth/logout").status_code == 204
    client.cookies.clear()
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_password_reset_invalidates_old_tokens(client, login, db):
    admin = login("admin")
    other = login("manager", username="vali")
    users = client.get("/api/v1/admin/users", headers=admin).json()
    vali_id = next(u["id"] for u in users if u["username"] == "vali")

    r = client.post(f"/api/v1/admin/users/{vali_id}/password", headers=admin, json={"password": "YangiParol2026"})
    assert r.status_code == 204
    assert client.get("/api/v1/auth/me", headers=other).status_code == 401  # eski token endi ishlamaydi


def test_role_permissions(client, login):
    viewer = login("viewer")
    assert client.get("/api/v1/admin/orders", headers=viewer).status_code == 200
    assert client.get("/api/v1/admin/users", headers=viewer).status_code == 403
    assert client.post("/api/v1/admin/products", headers=viewer, json={"name": "X beton", "grade_class": "B1"}).status_code == 403
    assert client.put("/api/v1/admin/settings", headers=viewer, json={"values": {}}).status_code == 403
