"""Telegram guruhi vazifasiga "orders" (Zayafka — buyurtmalar) qo'shildi

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-14 17:30:00+00:00
"""
from collections.abc import Sequence

from alembic import op

revision: str = '0006'
down_revision: str | None = '0005'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE chat_purpose ADD VALUE IF NOT EXISTS 'orders' AFTER 'materials'")


def downgrade() -> None:
    # PostgreSQL ENUM'dan qiymatni o'chirib bo'lmaydi — tur qayta yaratiladi
    op.execute("UPDATE telegram_chats SET purpose = NULL WHERE purpose = 'orders'")
    op.execute("ALTER TYPE chat_purpose RENAME TO chat_purpose_old")
    op.execute("CREATE TYPE chat_purpose AS ENUM ('production', 'cash', 'materials', 'other', 'ignore')")
    op.execute("ALTER TABLE telegram_chats ALTER COLUMN purpose TYPE chat_purpose USING purpose::text::chat_purpose")
    op.execute("DROP TYPE chat_purpose_old")
