"""Rollar va ruxsatlar. Har bir admin endpoint aniq ruxsatni talab qiladi."""
from enum import StrEnum

from app.models.enums import OrderStatus, UserRole


class Perm(StrEnum):
    DASHBOARD = "dashboard.read"
    ORDERS_READ = "orders.read"
    ORDERS_MANAGE = "orders.manage"      # narx, sana, manzil, tasdiqlash, bekor qilish
    ORDERS_STATUS = "orders.status"      # ishlab chiqarish/logistika holatlarini o'zgartirish
    CATALOG_MANAGE = "catalog.manage"    # beton markalari va narxlar
    CUSTOMERS_READ = "customers.read"
    CUSTOMERS_MANAGE = "customers.manage"
    CALLBACKS_MANAGE = "callbacks.manage"
    USERS_MANAGE = "users.manage"
    SETTINGS_READ = "settings.read"
    SETTINGS_WRITE = "settings.write"
    FLEET_READ = "fleet.read"              # transport va haydovchilarni ko'rish
    FLEET_MANAGE = "fleet.manage"          # transport va haydovchilarni qo'shish/tahrirlash
    TRIPS_MANAGE = "trips.manage"          # buyurtmaga qatnov biriktirish, qatnov holati
    PRODUCTION_READ = "production.read"
    PRODUCTION_MANAGE = "production.manage"  # reja, ishlab chiqarish yozuvlari, sifat nazorati
    PROJECTS_MANAGE = "projects.manage"    # saytdagi loyihalar va galereya


ROLE_PERMISSIONS: dict[UserRole, frozenset[Perm]] = {
    UserRole.ADMIN: frozenset(Perm),
    UserRole.MANAGER: frozenset({
        Perm.DASHBOARD, Perm.ORDERS_READ, Perm.ORDERS_MANAGE, Perm.ORDERS_STATUS, Perm.CATALOG_MANAGE,
        Perm.CUSTOMERS_READ, Perm.CUSTOMERS_MANAGE, Perm.CALLBACKS_MANAGE, Perm.SETTINGS_READ,
        Perm.FLEET_READ, Perm.FLEET_MANAGE, Perm.TRIPS_MANAGE, Perm.PRODUCTION_READ, Perm.PRODUCTION_MANAGE,
        Perm.PROJECTS_MANAGE,
    }),
    UserRole.DISPATCHER: frozenset({
        Perm.DASHBOARD, Perm.ORDERS_READ, Perm.ORDERS_STATUS, Perm.CUSTOMERS_READ, Perm.CALLBACKS_MANAGE,
        Perm.FLEET_READ, Perm.FLEET_MANAGE, Perm.TRIPS_MANAGE, Perm.PRODUCTION_READ,
    }),
    UserRole.PRODUCTION: frozenset({
        Perm.DASHBOARD, Perm.ORDERS_READ, Perm.ORDERS_STATUS, Perm.FLEET_READ,
        Perm.PRODUCTION_READ, Perm.PRODUCTION_MANAGE,
    }),
    UserRole.VIEWER: frozenset({
        Perm.DASHBOARD, Perm.ORDERS_READ, Perm.CUSTOMERS_READ, Perm.SETTINGS_READ,
        Perm.FLEET_READ, Perm.PRODUCTION_READ,
    }),
}

# ORDERS_STATUS ruxsati bor, lekin ORDERS_MANAGE yo'q rollar faqat shu holatlarga o'tkaza oladi
LIMITED_STATUS_TARGETS: dict[UserRole, frozenset[OrderStatus]] = {
    UserRole.DISPATCHER: frozenset({
        OrderStatus.SCHEDULED, OrderStatus.LOADED, OrderStatus.IN_TRANSIT, OrderStatus.DELIVERED,
    }),
    UserRole.PRODUCTION: frozenset({
        OrderStatus.IN_PRODUCTION, OrderStatus.QUALITY_CHECK, OrderStatus.LOADED,
    }),
}


def has_perm(role: UserRole, perm: Perm) -> bool:
    return perm in ROLE_PERMISSIONS.get(role, frozenset())


def can_set_status(role: UserRole, target: OrderStatus) -> bool:
    if has_perm(role, Perm.ORDERS_MANAGE):
        return True
    return has_perm(role, Perm.ORDERS_STATUS) and target in LIMITED_STATUS_TARGETS.get(role, frozenset())


def permissions_for(role: UserRole) -> list[str]:
    return sorted(p.value for p in ROLE_PERMISSIONS.get(role, frozenset()))
