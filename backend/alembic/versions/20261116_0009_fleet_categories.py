"""Transport: yengil avtomobillar, texnik ko'rik, buzilishlar, ish soatlari va taksi

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-16 12:00:00+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0009'
down_revision: str | None = '0008'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_vehicles_kind_valid", "vehicles", type_="check")
    op.create_check_constraint("ck_vehicles_kind_valid", "vehicles", "kind IN ('mixer', 'pump', 'other', 'car')")
    op.add_column("vehicles", sa.Column("inspection_date", sa.Date()))
    op.add_column("vehicles", sa.Column("inspection_due", sa.Date()))

    op.create_table(
        "vehicle_breakdowns",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("vehicle_id", sa.Integer(), sa.ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("description", sa.String(300), nullable=False),
        sa.Column("resolved_on", sa.Date()),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_vehicle_breakdowns_vehicle_id", "vehicle_breakdowns", ["vehicle_id"])
    op.create_index("ix_vehicle_breakdowns_occurred_on", "vehicle_breakdowns", ["occurred_on"])

    op.create_table(
        "vehicle_work_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("vehicle_id", sa.Integer(), sa.ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("hours", sa.Numeric(5, 2), nullable=False),
        sa.Column("billed_to", sa.String(10), nullable=False),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id", ondelete="SET NULL")),
        sa.Column("note", sa.Text()),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("hours > 0 AND hours <= 24", name="ck_vehicle_work_logs_hours_range"),
        sa.CheckConstraint("billed_to IN ('company', 'client')", name="ck_vehicle_work_logs_billed_to_valid"),
    )
    op.create_index("ix_vehicle_work_logs_vehicle_id", "vehicle_work_logs", ["vehicle_id"])
    op.create_index("ix_vehicle_work_logs_work_date", "vehicle_work_logs", ["work_date"])

    op.create_table(
        "taxi_rides",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ride_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("purpose", sa.String(300)),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_taxi_rides_amount_positive"),
    )
    op.create_index("ix_taxi_rides_ride_date", "taxi_rides", ["ride_date"])


def downgrade() -> None:
    for table in ("taxi_rides", "vehicle_work_logs", "vehicle_breakdowns"):
        op.drop_table(table)
    op.drop_column("vehicles", "inspection_due")
    op.drop_column("vehicles", "inspection_date")
    op.execute("UPDATE vehicles SET kind = 'other' WHERE kind = 'car'")
    op.drop_constraint("ck_vehicles_kind_valid", "vehicles", type_="check")
    op.create_check_constraint("ck_vehicles_kind_valid", "vehicles", "kind IN ('mixer', 'pump', 'other')")
