"""PostgreSQL ulanishi va sessiyalar."""
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,  # uzilib qolgan ulanishlarni avtomatik almashtiradi
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: har bir so'rov uchun alohida sessiya."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
