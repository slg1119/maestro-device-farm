import os

import pytest

from farm.config import Settings


@pytest.fixture
def settings(tmp_path, monkeypatch) -> Settings:
    for key in [k for k in os.environ if k.startswith("FARM_")]:
        monkeypatch.delenv(key)
    return Settings(data_dir=tmp_path / "data")
