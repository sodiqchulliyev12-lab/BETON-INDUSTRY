"""Ochiq (autentifikatsiyasiz) API — sayt shu endpointlardan foydalanadi."""
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.limiter import CALLBACK_LIMIT, ORDER_LIMIT, limiter
from app.schemas.callback import CallbackCreate, CallbackCreated
from app.schemas.order import OrderCreate, OrderCreated
from app.schemas.product import ProductPublic
from app.schemas.project import ProjectPublic
from app.services import callbacks, catalog, geocoding, orders, telegram
from app.utils.geo import in_service_area

router = APIRouter(prefix="/api/v1/public", tags=["Ommaviy API"])

_REJECTED = "So‘rov rad etildi."


@router.get("/settings", summary="Kompaniya ma'lumotlari (telefon, manzil...)")
def get_settings(response: Response, db: Session = Depends(get_db)) -> dict[str, Any]:
    response.headers["Cache-Control"] = "public, max-age=60"
    return catalog.public_settings(db)


@router.get("/products", response_model=list[ProductPublic], summary="Faol beton markalari")
def get_products(response: Response, db: Session = Depends(get_db)) -> list[ProductPublic]:
    response.headers["Cache-Control"] = "public, max-age=30"
    return catalog.list_public_products(db)


@router.get("/projects", response_model=list[ProjectPublic], summary="Nashr etilgan loyihalar")
def get_projects(response: Response, db: Session = Depends(get_db)) -> list[ProjectPublic]:
    response.headers["Cache-Control"] = "public, max-age=60"
    return catalog.list_public_projects(db)


class GeocodeResult(BaseModel):
    display_name: str
    lat: float
    lon: float


class ReverseResult(BaseModel):
    display_name: str | None


def _geocoder_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc) or "Manzil qidirish vaqtincha ishlamayapti.")


@router.get("/geocode", response_model=list[GeocodeResult], summary="Manzil bo'yicha qidirish (O'zbekiston)")
@limiter.limit("20/minute")
def geocode(request: Request, q: Annotated[str, Query(min_length=3, max_length=200)]) -> list[GeocodeResult]:
    try:
        return [GeocodeResult(**item) for item in geocoding.search(q)]
    except geocoding.GeocoderError as exc:
        raise _geocoder_unavailable(exc) from None


@router.get("/reverse-geocode", response_model=ReverseResult, summary="Koordinata bo'yicha manzil")
@limiter.limit("30/minute")
def reverse_geocode(
    request: Request,
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
) -> ReverseResult:
    if not in_service_area(lat, lon):
        raise HTTPException(status_code=422, detail="Nuqta xizmat hududidan tashqarida.")
    try:
        return ReverseResult(display_name=geocoding.reverse(lat, lon))
    except geocoding.GeocoderError as exc:
        raise _geocoder_unavailable(exc) from None


@router.post(
    "/orders",
    response_model=OrderCreated,
    status_code=status.HTTP_201_CREATED,
    summary="Buyurtma yaratish",
)
@limiter.limit(ORDER_LIMIT)
def create_order(
    request: Request, payload: OrderCreate, background: BackgroundTasks, db: Session = Depends(get_db)
) -> OrderCreated:
    if payload.website:  # honeypot to'ldirilgan — bot
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_REJECTED)
    order = orders.create_public_order(db, payload)
    # Telegram xabari javob yuborilgandan keyin ketadi; xato bo'lsa ham buyurtma saqlangan
    background.add_task(telegram.notify_new_order, order.id)
    return OrderCreated.model_validate(order)


@router.post(
    "/callback-requests",
    response_model=CallbackCreated,
    status_code=status.HTTP_201_CREATED,
    summary="Qayta qo'ng'iroq so'rovi",
)
@limiter.limit(CALLBACK_LIMIT)
def create_callback_request(
    request: Request, payload: CallbackCreate, background: BackgroundTasks, db: Session = Depends(get_db)
) -> CallbackCreated:
    if payload.website:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_REJECTED)
    created = callbacks.create_callback(db, payload)
    background.add_task(telegram.notify_callback, created.id)
    return CallbackCreated(id=created.id)
