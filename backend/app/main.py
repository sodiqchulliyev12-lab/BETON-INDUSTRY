"""FastAPI ilovasi.

Ishga tushirish (backend/ papkasidan):
    uvicorn app.main:app --reload --port 8000

Production: deploy/entrypoint.sh (Docker/Railway) yoki deploy/beton-industry.service (VPS).
"""
import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.config import settings
from app.errors import register_exception_handlers
from app.limiter import limiter
from app.middleware import BodySizeLimitMiddleware, TrustedHostExceptHealth
from app.routers import admin, auth, health, public, telegram_webhook
from app.services.uploads import ensure_upload_dir

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# httpx har bir so'rov URL'ini INFO darajasida yozadi; Telegram URL'ida bot tokeni bor — jurnalga tushmasin
for _noisy in ("httpx", "httpcore"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

# HTML sahifalar uchun Content-Security-Policy: faqat o'z domenidan skript, Google Fonts'dan shrift
CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    # Xarita plitkalari OpenStreetMap'dan (faqat rasm). Leaflet skripti o'zimizda: assets/vendor/leaflet
    "img-src 'self' data: blob: https://tile.openstreetmap.org",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])


def create_app() -> FastAPI:
    docs_enabled = not settings.is_production
    app = FastAPI(
        title=f"{settings.APP_NAME} API",
        version=__version__,
        docs_url="/api/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if docs_enabled else None,
    )

    app.state.limiter = limiter
    register_exception_handlers(app)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        headers = response.headers
        headers.setdefault("X-Content-Type-Options", "nosniff")
        headers.setdefault("X-Frame-Options", "DENY")
        headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        path = request.url.path
        # 304 javobida Content-Type bo'lmaydi — lekin brauzer keshdagi sahifa uchun yangi CSP'ni aynan
        # shu javobdan oladi. Aks holda CSP o'zgarganda foydalanuvchilar eski siyosat bilan qolib ketadi.
        is_html = response.headers.get("content-type", "").startswith("text/html") or (
            response.status_code == 304 and (path.endswith("/") or path.endswith(".html"))
        )
        if is_html and not path.startswith("/api/docs"):
            headers.setdefault("Content-Security-Policy", CSP)
        if settings.is_production:
            headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        if "cache-control" not in headers:
            if path.startswith("/api/"):
                headers["Cache-Control"] = "no-store"
            elif response.status_code == 200:
                if path.startswith("/uploads/"):
                    # Fayl nomlari tasodifiy (uuid) va o'zgarmaydi — uzoq keshlash xavfsiz
                    headers["Cache-Control"] = "public, max-age=2592000, immutable"
                elif response.headers.get("content-type", "").startswith("text/html"):
                    headers["Cache-Control"] = "no-cache"  # har safar ETag bilan tekshiriladi
                else:
                    headers["Cache-Control"] = "public, max-age=3600"
        return response

    # Tartib: oxirgi qo'shilgan middleware eng tashqarida ishlaydi
    app.add_middleware(GZipMiddleware, minimum_size=1024)

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type"],
            max_age=600,
        )

    if settings.allowed_hosts:
        # Begona Host header bilan kelgan so'rovlar rad etiladi (Host header injection'dan himoya)
        app.add_middleware(TrustedHostExceptHealth, allowed_hosts=settings.allowed_hosts)
    elif settings.is_production:
        logging.getLogger("beton").warning("ALLOWED_HOSTS bo‘sh — production uchun domen nomlarini kiriting.")

    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.MAX_REQUEST_BYTES)

    app.include_router(health.router)
    app.include_router(public.router)
    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(telegram_webhook.router)

    # Noma'lum /api/... manzillari frontendning 404.html sahifasiga emas, JSON xatoga tushsin
    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    def api_not_found(path: str) -> None:
        raise HTTPException(status_code=404, detail="API manzili topilmadi.")

    # Yuklangan rasmlar (loyihalar galereyasi). Faqat rasm fayllari saqlanadi — services/uploads.py
    app.mount("/uploads", StaticFiles(directory=ensure_upload_dir()), name="uploads")

    # Frontend (statik fayllar). html=True: "/" → index.html, topilmasa → 404.html
    if settings.SERVE_FRONTEND and settings.FRONTEND_DIR.is_dir():
        app.mount("/", StaticFiles(directory=settings.FRONTEND_DIR, html=True), name="frontend")

    return app


app = create_app()
