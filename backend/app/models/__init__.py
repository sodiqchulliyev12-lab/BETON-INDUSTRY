"""Barcha modellar shu yerdan import qilinadi (Alembic metadata'ni to'liq ko'rishi uchun)."""
from app.models.base import Base
from app.models.callback import CallbackRequest
from app.models.customer import Customer
from app.models.fleet import Driver, OrderTrip, Vehicle, VehicleExpense
from app.models.improvement import ImprovementAction
from app.models.lab import LabSample, LabTest
from app.models.notification import NotificationLog
from app.models.order import Order, OrderItem, OrderStatusHistory, order_number_seq
from app.models.product import ConcreteProduct, ConcretePrice
from app.models.production import ProductionPlan, ProductionRecord
from app.models.project import Project, ProjectImage
from app.models.settings import SystemSetting, TelegramSettings
from app.models.telegram_inbox import TelegramChat, TelegramMessage
from app.models.user import User
from app.models.warehouse import Material, StockMovement, Supplier, Warehouse

__all__ = [
    "Base",
    "CallbackRequest",
    "ConcretePrice",
    "ConcreteProduct",
    "Customer",
    "Driver",
    "ImprovementAction",
    "LabSample",
    "LabTest",
    "Material",
    "NotificationLog",
    "Order",
    "OrderItem",
    "OrderStatusHistory",
    "OrderTrip",
    "ProductionPlan",
    "ProductionRecord",
    "StockMovement",
    "Supplier",
    "Project",
    "ProjectImage",
    "SystemSetting",
    "TelegramChat",
    "TelegramMessage",
    "TelegramSettings",
    "User",
    "Vehicle",
    "VehicleExpense",
    "Warehouse",
    "order_number_seq",
]
