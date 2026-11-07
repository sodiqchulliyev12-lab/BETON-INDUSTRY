from datetime import date

from pydantic import BaseModel

from app.schemas.common import JsonDecimal


class ProjectImageOut(BaseModel):
    url: str
    caption: str | None


class ProjectPublic(BaseModel):
    id: int
    slug: str
    title: str
    description: str | None
    location: str | None
    volume_m3: JsonDecimal | None
    completed_at: date | None
    cover_image: str | None
    is_demo: bool
    images: list[ProjectImageOut]
