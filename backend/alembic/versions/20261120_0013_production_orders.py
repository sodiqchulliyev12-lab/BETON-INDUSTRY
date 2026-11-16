"""Ishlab chiqarish: haydovchi, operator, izoh; marka nomlari M-100 ko'rinishida

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-20 09:00:00+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0013'
down_revision: str | None = '0012'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("production_records", sa.Column("driver_id", sa.Integer(), sa.ForeignKey("drivers.id", ondelete="SET NULL")))
    op.add_column("production_records", sa.Column("operator_name", sa.String(150)))
    op.add_column("production_records", sa.Column("operator_phone", sa.String(30)))
    op.add_column("production_records", sa.Column("notes", sa.Text()))
    # «Beton M100» -> «Beton M-100» (katalog va eski buyurtmalardagi nomlar)
    op.execute(r"UPDATE concrete_products SET name = regexp_replace(name, 'M(\d{2,3})', 'M-\1') WHERE name ~ 'M\d{2,3}'")
    op.execute(r"UPDATE order_items SET product_name = regexp_replace(product_name, 'M(\d{2,3})', 'M-\1') WHERE product_name ~ 'M\d{2,3}'")


def downgrade() -> None:
    op.drop_column("production_records", "notes")
    op.drop_column("production_records", "operator_phone")
    op.drop_column("production_records", "operator_name")
    op.drop_column("production_records", "driver_id")
