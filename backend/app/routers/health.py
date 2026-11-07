from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import __version__
from app.database import get_db

router = APIRouter(prefix="/api/v1", tags=["Tizim"])


@router.get("/health", summary="Server va baza holati")
def health(db: Session = Depends(get_db)) -> JSONResponse:
    try:
        db.execute(text("SELECT 1"))
        database = "ok"
    except Exception:
        database = "unavailable"
    ok = database == "ok"
    return JSONResponse(
        status_code=200 if ok else 503,
        content={"status": "ok" if ok else "degraded", "database": database, "version": __version__},
    )
