"""Yoqilg'i turlari (gaz, dizel, benzin), miqdor va nasos operatori

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-17 09:00:00+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0010'
down_revision: str | None = '0009'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("vehicle_expenses", sa.Column("fuel_type", sa.String(8)))
    op.add_column("vehicle_expenses", sa.Column("quantity", sa.Numeric(12, 2)))
    op.create_check_constraint("ck_vehicle_expenses_fuel_type_valid", "vehicle_expenses", "fuel_type IS NULL OR fuel_type IN ('gas', 'diesel', 'petrol')")
    op.create_check_constraint("ck_vehicle_expenses_quantity_positive", "vehicle_expenses", "quantity IS NULL OR quantity > 0")
    op.add_column("vehicles", sa.Column("fuel_type", sa.String(8)))
    op.create_check_constraint("ck_vehicles_fuel_type_valid", "vehicles", "fuel_type IS NULL OR fuel_type IN ('gas', 'diesel', 'petrol')")
    op.add_column("vehicle_work_logs", sa.Column("driver_id", sa.Integer(), sa.ForeignKey("drivers.id", ondelete="SET NULL")))


def downgrade() -> None:
    op.drop_column("vehicle_work_logs", "driver_id")
    op.drop_constraint("ck_vehicles_fuel_type_valid", "vehicles", type_="check")
    op.drop_column("vehicles", "fuel_type")
    op.drop_constraint("ck_vehicle_expenses_quantity_positive", "vehicle_expenses", type_="check")
    op.drop_constraint("ck_vehicle_expenses_fuel_type_valid", "vehicle_expenses", type_="check")
    op.drop_column("vehicle_expenses", "quantity")
    op.drop_column("vehicle_expenses", "fuel_type")
