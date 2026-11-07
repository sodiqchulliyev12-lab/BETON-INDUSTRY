import io
import struct
import zlib
from pathlib import Path

from app.config import settings


def tiny_png() -> bytes:
    """1×1 piksel PNG (testlar uchun)."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    raw = b"\x00\xff\xb5\x2b"
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def test_project_crud_upload_and_public_view(client, login):
    h = login("manager")
    project = client.post("/api/v1/admin/projects", headers=h, json={
        "title": "Turar-joy majmuasi", "location": "Toshkent", "volume_m3": 1200, "is_published": False,
    }).json()
    assert project["slug"] == "turar-joy-majmuasi"
    pid = project["id"]
    assert client.get("/api/v1/public/projects").json() == []  # nashr etilmagan

    r = client.post(f"/api/v1/admin/projects/{pid}/images", headers=h,
                    files={"file": ("foto.png", tiny_png(), "image/png")}, data={"caption": "Poydevor"})
    assert r.status_code == 201, r.text
    body = r.json()
    url = body["images"][0]["file_path"]
    assert url.startswith("/uploads/projects/") and url.endswith(".png")
    assert body["cover_image"] == url  # birinchi rasm — muqova
    assert (Path(settings.UPLOAD_DIR) / url.removeprefix("/uploads/")).is_file()

    served = client.get(url)
    assert served.status_code == 200 and served.headers["content-type"] == "image/png"

    project["is_published"] = True
    client.put(f"/api/v1/admin/projects/{pid}", headers=h, json={k: project[k] for k in (
        "title", "slug", "description", "location", "volume_m3", "completed_at", "is_published", "is_demo", "sort_order")})
    public = client.get("/api/v1/public/projects").json()
    assert public[0]["cover_image"] == url and public[0]["images"][0]["caption"] == "Poydevor"

    image_id = body["images"][0]["id"]
    after = client.delete(f"/api/v1/admin/projects/{pid}/images/{image_id}", headers=h).json()
    assert after["images"] == [] and after["cover_image"] is None
    assert not (Path(settings.UPLOAD_DIR) / url.removeprefix("/uploads/")).exists()


def test_upload_rejects_non_images_and_disguised_files(client, login):
    h = login("manager")
    pid = client.post("/api/v1/admin/projects", headers=h, json={"title": "Sinov loyiha"}).json()["id"]
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    for name, content, ctype in [
        ("rasm.svg", svg, "image/svg+xml"),
        ("rasm.png", b"<html><script>alert(1)</script></html>", "image/png"),  # nomi png, ichi HTML
        ("bosh.jpg", b"", "image/jpeg"),
    ]:
        r = client.post(f"/api/v1/admin/projects/{pid}/images", headers=h, files={"file": (name, io.BytesIO(content), ctype)})
        assert r.status_code == 422, name
    big = b"\x89PNG\r\n\x1a\n" + b"0" * (5 * 1024 * 1024)
    r = client.post(f"/api/v1/admin/projects/{pid}/images", headers=h, files={"file": ("katta.png", big, "image/png")})
    assert r.status_code == 422 and "5 MB" in r.json()["detail"][0]["msg"]


def test_projects_require_permission(client, login):
    dispatcher = login("dispatcher")
    assert client.get("/api/v1/admin/projects", headers=dispatcher).status_code == 403
