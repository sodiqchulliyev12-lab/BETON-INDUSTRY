from pydantic import BaseModel

from app.schemas.common import JsonDecimal


class SpecItem(BaseModel):
    label: str
    value: str


class PriceOut(BaseModel):
    price_per_m3: JsonDecimal
    currency: str


class ProductPublic(BaseModel):
    """Saytdagi katalog uchun beton markasi.

    Narx ataylab YO'Q: zavod narxlarni ochiq saytda ko'rsatmaydi (raqobatchilar bilmasligi uchun),
    narx mijoz bilan telefon orqali kelishiladi. Narxlar faqat admin panelda.
    """

    id: int
    slug: str
    name: str
    grade_class: str
    description: str | None
    specs: list[SpecItem]
    is_available: bool
    is_demo: bool
