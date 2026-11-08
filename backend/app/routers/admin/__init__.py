"""Admin panel API (/api/v1/admin/...). Har bir endpoint JWT va aniq ruxsatni talab qiladi."""
from fastapi import APIRouter

from app.routers.admin import (
    callbacks, customers, dashboard, fleet, inbox, orders, production, products, projects, settings, telegram, trips, users,
)

router = APIRouter(prefix="/api/v1/admin")
for module in (dashboard, orders, trips, products, customers, callbacks, fleet, production, projects, users, settings, telegram, inbox):
    router.include_router(module.router)
