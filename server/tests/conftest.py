import os

import pytest

from farm.config import Settings
from farm.db.engine import Database


@pytest.fixture
def settings(tmp_path, monkeypatch) -> Settings:
    for key in [k for k in os.environ if k.startswith("FARM_")]:
        monkeypatch.delenv(key)
    return Settings(data_dir=tmp_path / "data")


@pytest.fixture
def db(settings) -> Database:
    database = Database(settings.database_path)
    database.create_all()
    return database
