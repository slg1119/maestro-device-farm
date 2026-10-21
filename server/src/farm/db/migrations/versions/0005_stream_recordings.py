"""Stream tickets, task interference and recording storage.

Revision ID: 0005
Revises: 0004
"""
import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("interfered", sa.Boolean(), server_default=sa.text("0"), nullable=False))
    op.create_table(
        "stream_tickets",
        sa.Column("ticket_hash", sa.String(), primary_key=True),
        sa.Column("device_serial", sa.String(), nullable=False),
        sa.Column("actor", sa.String(), nullable=False),
        sa.Column("author_name", sa.String(), nullable=False),
        sa.Column("expires_at", sa.String(), nullable=False),
        sa.Column("used_at", sa.String(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_table(
        "recordings",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("device_serial", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("include_launch_app", sa.Boolean(), nullable=False),
        sa.Column("app_package", sa.String(), nullable=True),
        sa.Column("workspace_id", sa.String(), nullable=True),
        sa.Column("steps", sa.JSON(), nullable=False),
        sa.Column("yaml", sa.Text(), nullable=True),
        sa.Column("ai_job_id", sa.String(), nullable=True),
        sa.Column("created_by", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("finished_at", sa.String(), nullable=True),
    )
    op.create_index(
        "uq_recordings_active_device", "recordings", ["device_serial"], unique=True,
        sqlite_where=sa.text("status IN ('active', 'stopping')"),
    )


def downgrade() -> None:
    op.drop_index("uq_recordings_active_device", table_name="recordings")
    op.drop_table("recordings")
    op.drop_table("stream_tickets")
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.drop_column("interfered")
