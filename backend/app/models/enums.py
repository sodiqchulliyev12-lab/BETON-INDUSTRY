"""Barcha holat (status) va tur ro'yxatlari. O'zbekcha nomlar admin panel uchun LABELS'da."""
from enum import StrEnum


class UserRole(StrEnum):
    ADMIN = "admin"
    MANAGER = "manager"
    DISPATCHER = "dispatcher"
    PRODUCTION = "production"
    VIEWER = "viewer"


class OrderStatus(StrEnum):
    NEW = "new"
    CONFIRMED = "confirmed"
    SCHEDULED = "scheduled"
    IN_PRODUCTION = "in_production"
    QUALITY_CHECK = "quality_check"
    LOADED = "loaded"
    IN_TRANSIT = "in_transit"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"


class DeliveryPriceStatus(StrEnum):
    PENDING = "pending"            # menejer hali tasdiqlamagan — 0 deb hisoblanmaydi
    CONFIRMED = "confirmed"
    NOT_REQUIRED = "not_required"  # mijoz o'zi olib ketadi


class OrderSource(StrEnum):
    WEBSITE = "website"
    ADMIN = "admin"


class VehicleOwnership(StrEnum):
    OWN = "own"
    RENTED = "rented"


class VehicleStatus(StrEnum):
    FREE = "free"
    BUSY = "busy"
    REPAIR = "repair"


class DriverEmployment(StrEnum):
    STAFF = "staff"
    CONTRACTOR = "contractor"


class TripStatus(StrEnum):
    PLANNED = "planned"
    LOADING = "loading"
    LOADED = "loaded"
    EN_ROUTE = "en_route"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"


class PlanStatus(StrEnum):
    PLANNED = "planned"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class QcStatus(StrEnum):
    PENDING = "pending"
    PASSED = "passed"
    FAILED = "failed"


class CallbackStatus(StrEnum):
    NEW = "new"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    SPAM = "spam"


class ChatPurpose(StrEnum):
    """Telegram guruhining vazifasi — xabarlar Google Sheets'ning qaysi varag'iga yozilishini belgilaydi."""

    PRODUCTION = "production"   # ishlab chiqarilgan beton
    CASH = "cash"               # kassa va bank
    MATERIALS = "materials"     # xomashyo kirimi
    ORDERS = "orders"           # zayafka (mijoz buyurtmalari)
    OTHER = "other"
    IGNORE = "ignore"           # saqlanmaydi


LABELS: dict[type[StrEnum], dict[str, str]] = {
    UserRole: {
        "admin": "Administrator",
        "manager": "Menejer",
        "dispatcher": "Dispetcher",
        "production": "Ishlab chiqarish",
        "viewer": "Kuzatuvchi",
    },
    OrderStatus: {
        "new": "Yangi",
        "confirmed": "Tasdiqlandi",
        "scheduled": "Rejalashtirildi",
        "in_production": "Ishlab chiqarilmoqda",
        "quality_check": "Sifat nazoratida",
        "loaded": "Yuklandi",
        "in_transit": "Yo‘lda",
        "delivered": "Yetkazib berildi",
        "cancelled": "Bekor qilindi",
    },
    DeliveryPriceStatus: {
        "pending": "Menejer tasdiqlaydi",
        "confirmed": "Tasdiqlangan",
        "not_required": "Kerak emas",
    },
    VehicleOwnership: {"own": "O‘zimizniki", "rented": "Ijaraga olingan"},
    VehicleStatus: {"free": "Bo‘sh", "busy": "Band", "repair": "Ta’mirda"},
    TripStatus: {
        "planned": "Rejalashtirilgan",
        "loading": "Yuklanmoqda",
        "loaded": "Yuklandi",
        "en_route": "Yo‘lda",
        "delivered": "Yetkazildi",
        "cancelled": "Bekor qilindi",
    },
    QcStatus: {"pending": "Kutilmoqda", "passed": "O‘tdi", "failed": "O‘tmadi"},
}
