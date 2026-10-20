from alembic import context
from sqlalchemy import create_engine, pool

from farm.db.models import Base

config = context.config
target_metadata = Base.metadata

connectable = create_engine(config.get_main_option("sqlalchemy.url"), poolclass=pool.NullPool)
with connectable.connect() as connection:
    context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()
