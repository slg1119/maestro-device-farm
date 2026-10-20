import tempfile
from pathlib import Path

from alembic import command
from alembic.config import Config

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def alembic_config(db_path: Path) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db_path}")
    return cfg


def upgrade(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    command.upgrade(alembic_config(db_path), "head")


def autogenerate(message: str, rev_id: str | None = None) -> None:
    """Writes a new revision diffing the models against a scratch DB at head."""
    with tempfile.TemporaryDirectory() as tmp:
        cfg = alembic_config(Path(tmp) / "scratch.db")
        command.upgrade(cfg, "head")
        command.revision(cfg, message=message, autogenerate=True, rev_id=rev_id)
