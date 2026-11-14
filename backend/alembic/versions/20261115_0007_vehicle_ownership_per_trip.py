"""Transport egaligiga "per_trip" (reys bay — qatnov uchun to'lov) qo'shildi

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-15 10:00:00+00:00
"""
from collections.abc import Sequence

from alembic import op

revision: str = '0007'
down_revision: str | None = '0006'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE vehicle_ownership ADD VALUE IF NOT EXISTS 'per_trip' AFTER 'rented'")


def downgrade() -> None:
    # PostgreSQL ENUM'dan qiymatni o'chirib bo'lmaydi — tur qayta yaratiladi; reys bay transport "rented" bo'ladi
    op.execute("UPDATE vehicles SET ownership = 'rented' WHERE ownership = 'per_trip'")
    op.execute("ALTER TYPE vehicle_ownership RENAME TO vehicle_ownership_old")
    op.execute("CREATE TYPE vehicle_ownership AS ENUM ('own', 'rented')")
    op.execute("ALTER TABLE vehicles ALTER COLUMN ownership TYPE vehicle_ownership USING ownership::text::vehicle_ownership")
    op.execute("DROP TYPE vehicle_ownership_old")
