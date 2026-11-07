"""Saytdagi «Loyihalarimiz» bo'limi: loyihalar va fotosuratlar."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.deps import require
from app.models import Project, ProjectImage, User
from app.permissions import Perm
from app.schemas.admin_projects import CoverIn, ImageUpdate, ProjectAdmin, ProjectIn
from app.schemas.common import clean_text
from app.services import uploads
from app.services.catalog_admin import slugify
from app.services.orders import OrderError

router = APIRouter(prefix="/projects", tags=["Admin: loyihalar va galereya"])

MAX_IMAGES = 30


def _out(project: Project) -> ProjectAdmin:
    return ProjectAdmin.model_validate(project, from_attributes=True)


def _load(db: Session, project_id: int) -> Project:
    # populate_existing: commit'dan keyin rasmlar ro'yxati sessiya keshidan emas, bazadan qayta o'qiladi
    project = db.scalar(
        select(Project).where(Project.id == project_id)
        .options(selectinload(Project.images))
        .execution_options(populate_existing=True)
    )
    if project is None:
        raise HTTPException(status_code=404, detail="Loyiha topilmadi.")
    return project


def _unique_slug(db: Session, base: str, exclude_id: int | None = None) -> str:
    slug, n = base, 2
    while True:
        stmt = select(Project.id).where(Project.slug == slug)
        if exclude_id:
            stmt = stmt.where(Project.id != exclude_id)
        if not db.scalar(stmt):
            return slug
        slug, n = f"{base}-{n}", n + 1


def _apply(db: Session, project: Project, data: ProjectIn) -> None:
    if data.slug:
        if _unique_slug(db, data.slug, project.id) != data.slug:
            raise OrderError("Bu slug band.", field="slug")
        project.slug = data.slug
    elif not project.slug:
        project.slug = _unique_slug(db, slugify(data.title), project.id)
    for key in ("title", "description", "location", "volume_m3", "completed_at", "is_published", "is_demo", "sort_order"):
        setattr(project, key, getattr(data, key))
    project.title = data.title.strip()


@router.get("", response_model=list[ProjectAdmin])
def list_projects(db: Session = Depends(get_db), _: User = Depends(require(Perm.PROJECTS_MANAGE))):
    projects = db.scalars(
        select(Project).options(selectinload(Project.images)).order_by(Project.sort_order, Project.id.desc())
    ).all()
    return [_out(p) for p in projects]


@router.get("/{project_id}", response_model=ProjectAdmin)
def get_project(project_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.PROJECTS_MANAGE))):
    return _out(_load(db, project_id))


@router.post("", response_model=ProjectAdmin, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.PROJECTS_MANAGE))):
    project = Project(slug="")
    _apply(db, project, payload)
    db.add(project)
    db.commit()
    return _out(_load(db, project.id))


@router.put("/{project_id}", response_model=ProjectAdmin)
def update_project(project_id: int, payload: ProjectIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.PROJECTS_MANAGE))):
    project = _load(db, project_id)
    _apply(db, project, payload)
    db.commit()
    return _out(_load(db, project_id))


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.PROJECTS_MANAGE))):
    project = _load(db, project_id)
    files = [img.file_path for img in project.images]
    db.delete(project)
    db.commit()
    for path in files:  # fayllar baza tranzaksiyasi muvaffaqiyatli tugagandan keyin o'chiriladi
        uploads.delete_file(path)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{project_id}/images", response_model=ProjectAdmin, status_code=status.HTTP_201_CREATED)
def upload_image(
    project_id: int,
    file: UploadFile = File(...),
    caption: str | None = Form(default=None, max_length=255),
    db: Session = Depends(get_db),
    _: User = Depends(require(Perm.PROJECTS_MANAGE)),
):
    project = _load(db, project_id)
    if len(project.images) >= MAX_IMAGES:
        raise OrderError(f"Bitta loyihaga ko‘pi bilan {MAX_IMAGES} ta rasm.", field="file")
    url = uploads.save_image(file.file, "projects")
    next_order = (db.scalar(select(func.max(ProjectImage.sort_order)).where(ProjectImage.project_id == project.id)) or 0) + 1
    db.add(ProjectImage(project_id=project.id, file_path=url, caption=clean_text(caption), sort_order=next_order))
    if not project.cover_image:
        project.cover_image = url  # birinchi rasm avtomatik muqova bo'ladi
    try:
        db.commit()
    except Exception:
        db.rollback()
        uploads.delete_file(url)
        raise
    return _out(_load(db, project_id))


def _image(project: Project, image_id: int) -> ProjectImage:
    image = next((i for i in project.images if i.id == image_id), None)
    if image is None:
        raise HTTPException(status_code=404, detail="Rasm topilmadi.")
    return image


@router.patch("/{project_id}/images/{image_id}", response_model=ProjectAdmin)
def update_image(
    project_id: int, image_id: int, payload: ImageUpdate, db: Session = Depends(get_db),
    _: User = Depends(require(Perm.PROJECTS_MANAGE)),
):
    project = _load(db, project_id)
    image = _image(project, image_id)
    if "caption" in payload.model_fields_set:
        image.caption = payload.caption
    if "sort_order" in payload.model_fields_set and payload.sort_order is not None:
        image.sort_order = payload.sort_order
    db.commit()
    return _out(_load(db, project_id))


@router.delete("/{project_id}/images/{image_id}", response_model=ProjectAdmin)
def delete_image(project_id: int, image_id: int, db: Session = Depends(get_db), _: User = Depends(require(Perm.PROJECTS_MANAGE))):
    project = _load(db, project_id)
    image = _image(project, image_id)
    path = image.file_path
    if project.cover_image == path:
        others = [i for i in project.images if i.id != image_id]
        project.cover_image = others[0].file_path if others else None
    db.delete(image)
    db.commit()
    uploads.delete_file(path)
    return _out(_load(db, project_id))


@router.post("/{project_id}/cover", response_model=ProjectAdmin)
def set_cover(project_id: int, payload: CoverIn, db: Session = Depends(get_db), _: User = Depends(require(Perm.PROJECTS_MANAGE))):
    project = _load(db, project_id)
    project.cover_image = _image(project, payload.image_id).file_path if payload.image_id else None
    db.commit()
    return _out(_load(db, project_id))
