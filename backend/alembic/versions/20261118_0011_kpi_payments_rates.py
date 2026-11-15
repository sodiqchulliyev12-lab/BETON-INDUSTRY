"""KPI: buyurtma to'lovlari va mijoz bo'yicha bonus foizlari

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-18 09:00:00+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0011'
down_revision: str | None = '0010'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "order_payments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("paid_on", sa.Date(), nullable=False),
        sa.Column("note", sa.Text()),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_order_payments_amount_positive"),
    )
    op.create_index("ix_order_payments_order_id", "order_payments", ["order_id"])
    op.create_index("ix_order_payments_paid_on", "order_payments", ["paid_on"])
    op.create_table(
        "customer_kpi_rates",
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("customers.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("pct_10", sa.Numeric(5, 2), nullable=False),
        sa.Column("pct_20", sa.Numeric(5, 2), nullable=False),
        sa.Column("pct_30", sa.Numeric(5, 2), nullable=False),
        sa.Column("pct_over", sa.Numeric(5, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("pct_10 BETWEEN 0 AND 100 AND pct_20 BETWEEN 0 AND 100 AND pct_30 BETWEEN 0 AND 100 AND pct_over BETWEEN 0 AND 100", name="ck_customer_kpi_rates_pct_range"),
    )


def downgrade() -> None:
    op.drop_table("customer_kpi_rates")
    op.drop_index("ix_order_payments_paid_on", table_name="order_payments")
    op.drop_index("ix_order_payments_order_id", table_name="order_payments")
    op.drop_table("order_payments")
