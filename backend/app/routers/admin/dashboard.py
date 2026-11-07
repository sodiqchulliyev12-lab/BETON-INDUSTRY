from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import require
from app.models import User
from app.permissions import Perm
from app.services.dashboard import dashboard

router = APIRouter(prefix="/dashboard", tags=["Admin: dashboard"])


@router.get("")
def get_dashboard(db: Session = Depends(get_db), _: User = Depends(require(Perm.DASHBOARD))) -> dict[str, Any]:
    return dashboard(db)
