"""increase status_message length

Revision ID: 13abce7853b5
Revises: 0003_agent_layer
Create Date: 2026-07-26 16:04:16.292729
"""

from __future__ import annotations

from typing import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '13abce7853b5'
down_revision: str | None = '0003_agent_layer'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        'monitoring_sessions',
        'status_message',
        existing_type=sa.String(length=500),
        type_=sa.String(length=2000),
        existing_nullable=True
    )


def downgrade() -> None:
    op.alter_column(
        'monitoring_sessions',
        'status_message',
        existing_type=sa.String(length=2000),
        type_=sa.String(length=500),
        existing_nullable=True
    )
