from sqlalchemy import create_engine, inspect

from farm.db.migrate import upgrade
from farm.db.models import Base


def test_upgrade_matches_models(tmp_path):
    db_path = tmp_path / "farm.db"
    upgrade(db_path)
    engine = create_engine(f"sqlite:///{db_path}")
    try:
        insp = inspect(engine)
        assert set(insp.get_table_names()) - {"alembic_version"} == set(Base.metadata.tables)
        for name, table in Base.metadata.tables.items():
            assert {c["name"] for c in insp.get_columns(name)} == {c.name for c in table.columns}, name
        assert "uq_reservations_active_device" in {i["name"] for i in insp.get_indexes("reservations")}
    finally:
        engine.dispose()


def test_upgrade_is_idempotent(tmp_path):
    db_path = tmp_path / "farm.db"
    upgrade(db_path)
    upgrade(db_path)
