"""Ombor, laboratoriya, transport xarajatlari, transport bo'limi (kind) va yaxshilash choralari

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-16 09:00:00+00:00
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0008'
down_revision: str | None = '0007'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ts() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    # --- Transport bo'limi va xarajatlar ---
    op.add_column("vehicles", sa.Column("kind", sa.String(10), server_default="mixer", nullable=False))
    op.create_check_constraint("ck_vehicles_kind_valid", "vehicles", "kind IN ('mixer', 'pump', 'other')")
    op.execute("UPDATE vehicles SET kind = 'pump' WHERE lower(vehicle_type) LIKE '%nasos%'")
    op.execute(
        "UPDATE vehicles SET kind = 'other' WHERE kind = 'mixer' AND lower(vehicle_type) NOT LIKE '%mikser%' "
        "AND lower(vehicle_type) NOT LIKE '%mixer%' AND lower(vehicle_type) NOT LIKE '%beton%'"
    )

    op.create_table(
        "vehicle_expenses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("vehicle_id", sa.Integer(), sa.ForeignKey("vehicles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expense_date", sa.Date(), nullable=False),
        sa.Column("category", sa.String(15), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("note", sa.Text()),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_vehicle_expenses_amount_positive"),
    )
    op.create_index("ix_vehicle_expenses_vehicle_id", "vehicle_expenses", ["vehicle_id"])
    op.create_index("ix_vehicle_expenses_expense_date", "vehicle_expenses", ["expense_date"])

    # --- Ombor ---
    op.create_table(
        "warehouses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False, unique=True),
        sa.Column("notes", sa.Text()),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        *_ts(),
    )
    op.create_table(
        "suppliers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("phone", sa.String(13)),
        sa.Column("notes", sa.Text()),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        *_ts(),
    )
    op.create_table(
        "materials",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sku", sa.String(30), nullable=False, unique=True),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("unit", sa.String(10), nullable=False),
        sa.Column("min_stock", sa.Numeric(14, 3)),
        sa.Column("norm_per_m3", sa.Numeric(12, 3)),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("notes", sa.Text()),
        *_ts(),
        sa.CheckConstraint("min_stock IS NULL OR min_stock >= 0", name="ck_materials_min_stock_non_negative"),
        sa.CheckConstraint("norm_per_m3 IS NULL OR norm_per_m3 >= 0", name="ck_materials_norm_non_negative"),
    )
    op.create_table(
        "stock_movements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("material_id", sa.Integer(), sa.ForeignKey("materials.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("warehouse_id", sa.Integer(), sa.ForeignKey("warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("kind", sa.String(15), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 3), nullable=False),
        sa.Column("movement_date", sa.Date(), nullable=False),
        sa.Column("supplier_id", sa.Integer(), sa.ForeignKey("suppliers.id", ondelete="SET NULL")),
        sa.Column("unit_price", sa.Numeric(14, 2)),
        sa.Column("transfer_group", sa.String(36)),
        sa.Column("document_no", sa.String(50)),
        sa.Column("note", sa.Text()),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("quantity <> 0", name="ck_stock_movements_quantity_non_zero"),
        sa.CheckConstraint("unit_price IS NULL OR unit_price >= 0", name="ck_stock_movements_unit_price_non_negative"),
    )
    op.create_index("ix_stock_movements_material_wh", "stock_movements", ["material_id", "warehouse_id"])
    op.create_index("ix_stock_movements_date", "stock_movements", ["movement_date"])
    # Asosiy ombor — tuzilma (ma'lumot emas); qo'shimcha omborlar admin paneldan qo'shiladi
    op.execute("INSERT INTO warehouses (name) VALUES ('Asosiy ombor')")

    # --- Laboratoriya ---
    op.create_table(
        "lab_samples",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sample_no", sa.String(30), nullable=False, unique=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("concrete_products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("orders.id", ondelete="SET NULL")),
        sa.Column("production_record_id", sa.Integer(), sa.ForeignKey("production_records.id", ondelete="SET NULL")),
        sa.Column("sampled_on", sa.Date(), nullable=False),
        sa.Column("operator", sa.String(100)),
        sa.Column("slump_cm", sa.Numeric(5, 1)),
        sa.Column("notes", sa.Text()),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        *_ts(),
        sa.CheckConstraint("slump_cm IS NULL OR slump_cm >= 0", name="ck_lab_samples_slump_non_negative"),
    )
    op.create_index("ix_lab_samples_product_id", "lab_samples", ["product_id"])
    op.create_index("ix_lab_samples_sampled_on", "lab_samples", ["sampled_on"])
    op.create_table(
        "lab_tests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("sample_id", sa.Integer(), sa.ForeignKey("lab_samples.id", ondelete="CASCADE"), nullable=False),
        sa.Column("age_days", sa.Integer(), nullable=False),
        sa.Column("tested_on", sa.Date(), nullable=False),
        sa.Column("force_kn", sa.Numeric(8, 1), nullable=False),
        sa.Column("strength_mpa", sa.Numeric(6, 2), nullable=False),
        sa.Column("operator", sa.String(100)),
        sa.Column("notes", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("sample_id", "age_days", name="uq_lab_tests_sample_age"),
        sa.CheckConstraint("age_days BETWEEN 1 AND 365", name="ck_lab_tests_age_range"),
        sa.CheckConstraint("force_kn > 0", name="ck_lab_tests_force_positive"),
    )
    op.create_index("ix_lab_tests_sample_id", "lab_tests", ["sample_id"])

    # --- Yaxshilash choralari ---
    op.create_table(
        "improvement_actions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("assignee", sa.String(100)),
        sa.Column("status", sa.String(12), server_default="planned", nullable=False),
        sa.Column("due_date", sa.Date()),
        sa.Column("note", sa.Text()),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        *_ts(),
    )


def downgrade() -> None:
    for table in ("improvement_actions", "lab_tests", "lab_samples", "stock_movements", "materials", "suppliers",
                  "warehouses", "vehicle_expenses"):
        op.drop_table(table)
    op.drop_constraint("ck_vehicles_kind_valid", "vehicles", type_="check")
    op.drop_column("vehicles", "kind")
