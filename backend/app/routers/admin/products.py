"""Beton markalari va narxlar."""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require
from app.models import User
from app.permissions import Perm
from app.schemas.admin_catalog import PriceHistoryItem, PriceIn, ProductAdmin, ProductIn, ProductPatch
from app.services import catalog_admin

router = APIRouter(prefix="/products", tags=["Admin: beton markalari va narxlar"])


def _load(db: Session, product_id: int):
    try:
        return catalog_admin.get_product(db, product_id)
    except catalog_admin.NotFound:
        raise HTTPException(status_code=404, detail="Beton markasi topilmadi.") from None


# Ro'yxatni buyurtma bilan ishlaydigan barcha xodimlar ko'ra oladi
@router.get("", response_model=list[ProductAdmin])
def list_products(db: Session = Depends(get_db), _: User = Depends(require(Perm.ORDERS_READ))):
    return catalog_admin.list_products(db)


@router.post("", response_model=ProductAdmin, status_code=status.HTTP_201_CREATED)
def create_product(payload: ProductIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.CATALOG_MANAGE))):
    return catalog_admin.product_admin(db, catalog_admin.create_product(db, payload))


@router.patch("/{product_id}", response_model=ProductAdmin)
def patch_product(
    product_id: int, payload: ProductPatch, db: Session = Depends(get_db), _: User = Depends(require(Perm.CATALOG_MANAGE))
):
    product = catalog_admin.patch_product(db, _load(db, product_id), payload)
    return catalog_admin.product_admin(db, product)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(product_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.CATALOG_MANAGE))):
    catalog_admin.delete_product(db, _load(db, product_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{product_id}/prices", response_model=list[PriceHistoryItem])
def price_history(product_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.ORDERS_READ))):
    return catalog_admin.price_history(db, _load(db, product_id))


@router.post("/{product_id}/prices", response_model=ProductAdmin, status_code=status.HTTP_201_CREATED)
def set_price(
    product_id: int, payload: PriceIn, db: Session = Depends(get_db), user: User = Depends(require(Perm.CATALOG_MANAGE))
):
    product = _load(db, product_id)
    catalog_admin.set_price(db, product, payload, user)
    return catalog_admin.product_admin(db, product)


@router.delete("/{product_id}/prices/current", response_model=ProductAdmin)
def clear_price(product_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.CATALOG_MANAGE))):
    product = _load(db, product_id)
    catalog_admin.clear_price(db, product)
    return catalog_admin.product_admin(db, product)
