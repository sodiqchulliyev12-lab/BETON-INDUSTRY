"""Past darajadagi (ASGI) himoya qatlamlari."""
import json

from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

HEALTH_PATH = "/api/v1/health"


class TrustedHostExceptHealth(TrustedHostMiddleware):
    """Host tekshiruvi, lekin /api/v1/health bundan mustasno.

    Railway healthcheck so'rovlari "healthcheck.railway.app" hosti bilan, Docker HEALTHCHECK esa
    127.0.0.1 bilan keladi — ular rad etilsa, deploy "ishlamayapti" deb hisoblanadi.
    """

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope.get("path") == HEALTH_PATH:
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


class BodySizeLimitMiddleware:
    """Juda katta so'rovlarni rad etadi (413). Content-Length bo'lmasa ham oqim davomida sanaydi.

    Railway'da oldinda nginx yo'q, shuning uchun bu chegara ilovaning o'zida bo'lishi kerak.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        for name, value in scope.get("headers", []):
            if name == b"content-length":
                try:
                    if int(value) > self.max_bytes:
                        await self._reject(send)
                        return
                except ValueError:
                    await self._reject(send, 400, "Content-Length noto‘g‘ri.")
                    return

        received = 0
        too_large = False

        async def limited_receive() -> Message:
            nonlocal received, too_large
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    too_large = True
                    raise _TooLarge
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _TooLarge:
            if too_large:
                await self._reject(send)

    async def _reject(self, send: Send, status: int = 413, detail: str = "So‘rov hajmi juda katta.") -> None:
        body = json.dumps({"detail": detail}, ensure_ascii=False).encode()
        await send({
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        })
        await send({"type": "http.response.body", "body": body})


class _TooLarge(Exception):
    pass
