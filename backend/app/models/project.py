from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKey, Integer, Numeric, String, Text, false, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, CreatedAtMixin, TimestampMixin


class Project(TimestampMixin, Base):
    """Loyihalar va galereya (saytdagi portfolio)."""

    __tablename__ = "projects"
    __table_args__ = (CheckConstraint("volume_m3 IS NULL OR volume_m3 > 0", name="volume_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(220), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(String(255))
    volume_m3: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    completed_at: Mapped[date | None] = mapped_column(Date)
    cover_image: Mapped[str | None] = mapped_column(String(500))
    is_published: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, server_default=text("0"), nullable=False)

    images: Mapped[list["ProjectImage"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by=lambda: (ProjectImage.sort_order, ProjectImage.id),
    )


class ProjectImage(CreatedAtMixin, Base):
    __tablename__ = "project_images"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    caption: Mapped[str | None] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(Integer, server_default=text("0"), nullable=False)

    project: Mapped[Project] = relationship(back_populates="images")
