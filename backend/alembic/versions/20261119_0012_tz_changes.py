"""TZ: haydovchi Telegram manzili, oylik KPI foizlari, nakladnoy maydonlari, qaytgan beton

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-19 09:00:00+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0012'
down_revision: str | None = '0011'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("drivers", sa.Column("telegram", sa.String(64)))
    op.create_table(
        "customer_kpi_month_rates",
        sa.Column("month", sa.Date(), primary_key=True),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("customers.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("pct_10", sa.Numeric(5, 2), nullable=False),
        sa.Column("pct_20", sa.Numeric(5, 2), nullable=False),
        sa.Column("pct_30", sa.Numeric(5, 2), nullable=False),
        sa.Column("pct_over", sa.Numeric(5, 2), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("pct_10 BETWEEN 0 AND 100 AND pct_20 BETWEEN 0 AND 100 AND pct_30 BETWEEN 0 AND 100 AND pct_over BETWEEN 0 AND 100", name="ck_customer_kpi_month_rates_pct_range"),
    )
    op.add_column("production_records", sa.Column("customer_id", sa.Integer(), sa.ForeignKey("customers.id", ondelete="SET NULL")))
    op.add_column("production_records", sa.Column("vehicle_id", sa.Integer(), sa.ForeignKey("vehicles.id", ondelete="SET NULL")))
    op.add_column("production_records", sa.Column("waybill_no", sa.String(30)))
    op.create_unique_constraint("uq_production_records_waybill_no", "production_records", ["waybill_no"])
    op.add_column("stock_movements", sa.Column("production_record_id", sa.Integer(), sa.ForeignKey("production_records.id", ondelete="CASCADE")))
    op.create_index("ix_stock_movements_production_record_id", "stock_movements", ["production_record_id"])
    op.create_table(
        "concrete_returns",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("returned_on", sa.Date(), nullable=False),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id", ondelete="SET NULL")),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("customers.id", ondelete="SET NULL")),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("concrete_products.id", ondelete="SET NULL")),
        sa.Column("volume_m3", sa.Numeric(10, 2), nullable=False),
        sa.Column("reason", sa.Text()),
        sa.Column("outcome", sa.String(10), server_default="pending", nullable=False),
        sa.Column("resold_order_id", sa.Integer(), sa.ForeignKey("orders.id", ondelete="SET NULL")),
        sa.Column("note", sa.Text()),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("volume_m3 > 0", name="ck_concrete_returns_volume_positive"),
        sa.CheckConstraint("outcome IN ('pending', 'resold', 'brak')", name="ck_concrete_returns_outcome_valid"),
    )
    op.create_index("ix_concrete_returns_returned_on", "concrete_returns", ["returned_on"])
    op.create_index("ix_concrete_returns_order_id", "concrete_returns", ["order_id"])


def downgrade() -> None:
    op.drop_index("ix_concrete_returns_order_id", table_name="concrete_returns")
    op.drop_index("ix_concrete_returns_returned_on", table_name="concrete_returns")
    op.drop_table("concrete_returns")
    op.drop_index("ix_stock_movements_production_record_id", table_name="stock_movements")
    op.drop_column("stock_movements", "production_record_id")
    op.drop_constraint("uq_production_records_waybill_no", "production_records", type_="unique")
    op.drop_column("production_records", "waybill_no")
    op.drop_column("production_records", "vehicle_id")
    op.drop_column("production_records", "customer_id")
    op.drop_table("customer_kpi_month_rates")
    op.drop_column("drivers", "telegram")
