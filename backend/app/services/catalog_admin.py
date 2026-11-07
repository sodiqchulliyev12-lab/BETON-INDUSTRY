"""Admin panel: beton markalari va narxlar."""
import re

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models import ConcretePrice, ConcreteProduct, OrderItem, User
from app.schemas.admin_catalog import PriceHistoryItem, PriceIn, ProductAdmin, ProductIn, ProductPatch
from app.schemas.product import PriceOut
from app.services.catalog import _specs
from app.services.orders import OrderError
from app.services.pricing import current_prices

_TRANSLIT = str.maketrans({"‘": "", "’": "", "ʻ": "", "ʼ": "", "'": "", "`": ""})


class NotFound(Exception):
    pass


def slugify(text: str) -> str:
    text = text.translate(_TRANSLIT).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text[:150] or "marka"


def _unique_slug(db: Session, base: str, exclude_id: int | None = None) -> str:
    slug, n = base, 2
    while True:
        stmt = select(ConcreteProduct.id).where(ConcreteProduct.slug == slug)
        if exclude_id:
            stmt = stmt.where(ConcreteProduct.id != exclude_id)
        if not db.scalar(stmt):
            return slug
        slug, n = f"{base}-{n}", n + 1


def _to_admin(product: ConcreteProduct, price: ConcretePrice | None, orders_count: int) -> ProductAdmin:
    return ProductAdmin(
        id=product.id,
        slug=product.slug,
        name=product.name,
        grade_class=product.grade_class,
        description=product.description,
        specs=_specs(product.specs),
        is_active=product.is_active,
        is_available=product.is_available,
        is_demo=product.is_demo,
        sort_order=product.sort_order,
        price=PriceOut(price_per_m3=price.price_per_m3, currency=price.currency) if price else None,
        price_updated_at=price.valid_from if price else None,
        orders_count=orders_count,
        created_at=product.created_at,
        updated_at=product.updated_at,
    )


def _orders_counts(db: Session, ids: list[int]) -> dict[int, int]:
    if not ids:
        return {}
    return dict(
        db.execute(
            select(OrderItem.product_id, func.count(func.distinct(OrderItem.order_id)))
            .where(OrderItem.product_id.in_(ids))
            .group_by(OrderItem.product_id)
        ).all()
    )


def list_products(db: Session) -> list[ProductAdmin]:
    products = list(db.scalars(select(ConcreteProduct).order_by(ConcreteProduct.sort_order, ConcreteProduct.grade_class, ConcreteProduct.id)))
    ids = [p.id for p in products]
    prices, counts = current_prices(db, ids), _orders_counts(db, ids)
    return [_to_admin(p, prices.get(p.id), counts.get(p.id, 0)) for p in products]


def get_product(db: Session, product_id: int) -> ConcreteProduct:
    product = db.get(ConcreteProduct, product_id)
    if product is None:
        raise NotFound
    return product


def product_admin(db: Session, product: ConcreteProduct) -> ProductAdmin:
    return _to_admin(product, current_prices(db, [product.id]).get(product.id), _orders_counts(db, [product.id]).get(product.id, 0))


def create_product(db: Session, data: ProductIn) -> ConcreteProduct:
    slug = _unique_slug(db, data.slug or slugify(f"{data.grade_class} {data.name}"))
    if data.slug and slug != data.slug:
        raise OrderError("Bu slug band.", field="slug")
    product = ConcreteProduct(
        slug=slug,
        name=data.name.strip(),
        grade_class=data.grade_class.strip().upper(),
        description=data.description,
        specs=[s.model_dump() for s in data.specs],
        is_active=data.is_active,
        is_available=data.is_available,
        is_demo=data.is_demo,
        sort_order=data.sort_order,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def patch_product(db: Session, product: ConcreteProduct, data: ProductPatch) -> ConcreteProduct:
    fields = data.model_fields_set
    for name in ("name", "grade_class", "is_active", "is_available", "is_demo", "sort_order"):
        if name in fields:
            value = getattr(data, name)
            if value is None:
                raise OrderError("Bu maydonni bo‘sh qoldirib bo‘lmaydi.", field=name)
            if name == "grade_class":
                value = value.strip().upper()
            setattr(product, name, value)
    if "description" in fields:
        product.description = data.description
    if "specs" in fields:
        product.specs = [s.model_dump() for s in (data.specs or [])]
    if "slug" in fields and data.slug:
        if _unique_slug(db, data.slug, exclude_id=product.id) != data.slug:
            raise OrderError("Bu slug band.", field="slug")
        product.slug = data.slug
    db.commit()
    db.refresh(product)
    return product


def delete_product(db: Session, product: ConcreteProduct) -> None:
    """Buyurtmalarda ishlatilgan marka o'chirilmaydi — uni nofaol qilish kerak."""
    if db.scalar(select(func.count()).select_from(OrderItem).where(OrderItem.product_id == product.id)):
        raise OrderError("Bu marka buyurtmalarda ishlatilgan. O‘chirish o‘rniga uni nofaol qiling.")
    db.delete(product)
    db.commit()


# --- Narxlar ---------------------------------------------------------------

def _close_current(db: Session, product_id: int) -> None:
    db.execute(
        update(ConcretePrice)
        .where(ConcretePrice.product_id == product_id, ConcretePrice.valid_to.is_(None))
        .values(valid_to=func.now())
    )


def set_price(db: Session, product: ConcreteProduct, data: PriceIn, user: User) -> None:
    """Joriy narxni yopadi va yangisini ochadi — tarix saqlanadi."""
    # Bir vaqtda ikki menejer narx o'zgartirsa ham amaldagi narx bitta qoladi (FOR UPDATE)
    db.scalar(select(ConcreteProduct.id).where(ConcreteProduct.id == product.id).with_for_update())
    _close_current(db, product.id)
    db.add(ConcretePrice(product_id=product.id, price_per_m3=data.price_per_m3, note=data.note, created_by_id=user.id))
    db.commit()


def clear_price(db: Session, product: ConcreteProduct) -> None:
    """Narxni olib tashlash: saytda "Narx belgilanmagan" ko'rinadi."""
    _close_current(db, product.id)
    db.commit()


def price_history(db: Session, product: ConcreteProduct) -> list[PriceHistoryItem]:
    rows = db.execute(
        select(ConcretePrice, User.full_name)
        .outerjoin(User, User.id == ConcretePrice.created_by_id)
        .where(ConcretePrice.product_id == product.id)
        .order_by(ConcretePrice.valid_from.desc(), ConcretePrice.id.desc())
    ).all()
    return [PriceHistoryItem.model_validate(price).model_copy(update={"created_by": name}) for price, name in rows]
