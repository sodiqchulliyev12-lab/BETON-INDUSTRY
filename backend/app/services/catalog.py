"""Saytdagi katalog, loyihalar va ommaviy sozlamalar."""
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import ConcreteProduct, Project, SystemSetting
from app.schemas.product import PriceOut, ProductPublic, SpecItem
from app.schemas.project import ProjectImageOut, ProjectPublic
from app.services.pricing import current_prices


def _specs(raw: Any) -> list[SpecItem]:
    """JSONB'dagi xususiyatlarni [{label, value}] ko'rinishiga keltiradi (eski {k: v} formati ham qabul qilinadi)."""
    items: list[SpecItem] = []
    if isinstance(raw, list):
        for entry in raw:
            if isinstance(entry, dict) and entry.get("label") and entry.get("value") not in (None, ""):
                items.append(SpecItem(label=str(entry["label"]), value=str(entry["value"])))
    elif isinstance(raw, dict):
        items = [SpecItem(label=str(k), value=str(v)) for k, v in raw.items() if v not in (None, "")]
    return items


def list_public_products(db: Session) -> list[ProductPublic]:
    products = list(
        db.scalars(
            select(ConcreteProduct)
            .where(ConcreteProduct.is_active.is_(True))
            .order_by(ConcreteProduct.sort_order, ConcreteProduct.grade_class, ConcreteProduct.id)
        )
    )
    prices = current_prices(db, [p.id for p in products])
    result = []
    for p in products:
        price = prices.get(p.id)
        result.append(
            ProductPublic(
                id=p.id,
                slug=p.slug,
                name=p.name,
                grade_class=p.grade_class,
                description=p.description,
                specs=_specs(p.specs),
                is_available=p.is_available,
                is_demo=p.is_demo,
                price=PriceOut(price_per_m3=price.price_per_m3, currency=price.currency) if price else None,
            )
        )
    return result


def list_public_projects(db: Session) -> list[ProjectPublic]:
    projects = db.scalars(
        select(Project)
        .where(Project.is_published.is_(True))
        .options(selectinload(Project.images))
        .order_by(Project.sort_order, Project.completed_at.desc().nulls_last(), Project.id.desc())
    )
    return [
        ProjectPublic(
            id=p.id,
            slug=p.slug,
            title=p.title,
            description=p.description,
            location=p.location,
            volume_m3=p.volume_m3,
            completed_at=p.completed_at,
            cover_image=p.cover_image or (p.images[0].file_path if p.images else None),
            is_demo=p.is_demo,
            images=[ProjectImageOut(url=img.file_path, caption=img.caption) for img in p.images],
        )
        for p in projects
    ]


def public_settings(db: Session) -> dict[str, Any]:
    """Faqat is_public=true kalitlar. NULL qiymat — "kiritilmagan"."""
    rows = db.scalars(select(SystemSetting).where(SystemSetting.is_public.is_(True)))
    return {row.key: row.value for row in rows}
