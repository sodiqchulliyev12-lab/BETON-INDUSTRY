"""Admin panel API (/api/v1/admin/...). Har bir endpoint JWT va aniq ruxsatni talab qiladi."""
from fastapi import APIRouter

from app.routers.admin import (
    callbacks, customers, dashboard, fleet, fleet_extra, fleet_kinds, inbox, kpi, lab, orders, panels, production, products, projects, sales, settings, telegram, trips, users, warehouse,
)

router = APIRouter(prefix="/api/v1/admin")
for module in (dashboard, orders, trips, products, customers, callbacks, fleet, fleet_extra, fleet_kinds, production, projects, users, settings, telegram, inbox, warehouse, lab, panels, kpi, sales):
    router.include_router(module.router)
