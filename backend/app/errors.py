"""Xatolarni o'zbek tilida, frontend tushunadigan formatda qaytarish.

422 javobi formati (FastAPI bilan bir xil, faqat matnlar o'zbekcha):
    {"detail": [{"loc": ["body", "phone"], "msg": "...", "type": "value_error"}]}
"""
import logging

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

from app.services.orders import OrderError

logger = logging.getLogger("beton.errors")

_MESSAGES = {
    "missing": "Bu maydon to‘ldirilishi shart.",
    "string_too_short": "Matn juda qisqa.",
    "string_too_long": "Matn juda uzun.",
    "string_type": "Matn kiriting.",
    "int_parsing": "Butun son kiriting.",
    "int_type": "Butun son kiriting.",
    "decimal_parsing": "Raqam kiriting.",
    "decimal_type": "Raqam kiriting.",
    "float_parsing": "Raqam kiriting.",
    "decimal_max_places": "Hajm 0,1 m³ aniqlikda bo‘lishi kerak.",
    "decimal_max_digits": "Raqam juda katta.",
    "greater_than": "Qiymat juda kichik.",
    "greater_than_equal": "Qiymat juda kichik.",
    "less_than_equal": "Qiymat juda katta.",
    "bool_parsing": "Ha yoki yo‘q qiymatini tanlang.",
    "bool_type": "Ha yoki yo‘q qiymatini tanlang.",
    "date_parsing": "Sana noto‘g‘ri formatda.",
    "date_from_datetime_parsing": "Sana noto‘g‘ri formatda.",
    "date_type": "Sana noto‘g‘ri formatda.",
    "time_parsing": "Vaqt noto‘g‘ri formatda.",
    "time_type": "Vaqt noto‘g‘ri formatda.",
    "extra_forbidden": "Ruxsat etilmagan maydon.",
    "json_invalid": "So‘rov formati noto‘g‘ri.",
    "model_attributes_type": "So‘rov formati noto‘g‘ri.",
}


def _translate(error: dict) -> str:
    err_type = error.get("type", "")
    if err_type == "value_error":
        ctx_error = (error.get("ctx") or {}).get("error")
        return str(ctx_error) if ctx_error else str(error.get("msg", "Noto‘g‘ri qiymat."))
    return _MESSAGES.get(err_type, "Noto‘g‘ri qiymat.")


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    details = [
        {"loc": list(err.get("loc", [])), "msg": _translate(err), "type": err.get("type", "")}
        for err in exc.errors()
    ]
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, content={"detail": details})


async def order_error_handler(request: Request, exc: OrderError) -> JSONResponse:
    if exc.field:
        content = {"detail": [{"loc": ["body", exc.field], "msg": exc.message, "type": "business_rule"}]}
    else:
        content = {"detail": exc.message}
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, content=content)


async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={"detail": "Juda ko‘p so‘rov yuborildi. Bir necha daqiqadan so‘ng qayta urinib ko‘ring."},
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Ichki xato tafsilotlari foydalanuvchiga ko'rsatilmaydi, faqat logga yoziladi
    logger.exception("Kutilmagan xato: %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Serverda xatolik yuz berdi. Birozdan so‘ng qayta urinib ko‘ring."},
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(RequestValidationError, validation_exception_handler)  # type: ignore[arg-type]
    app.add_exception_handler(OrderError, order_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RateLimitExceeded, rate_limit_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unhandled_exception_handler)
