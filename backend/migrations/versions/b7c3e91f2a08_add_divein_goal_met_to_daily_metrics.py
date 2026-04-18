"""Add divein_goal_met to daily_metrics

Revision ID: b7c3e91f2a08
Revises: d431aff678d1
Create Date: 2026-04-18 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c3e91f2a08'
down_revision: Union[str, None] = 'd431aff678d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('daily_metrics', sa.Column('divein_goal_met', sa.Boolean(), nullable=True, server_default='false'))


def downgrade() -> None:
    op.drop_column('daily_metrics', 'divein_goal_met')
