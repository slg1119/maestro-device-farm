import json
import os
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest

from farm.config import Settings
from farm.db.engine import Database


@pytest.fixture
def settings(tmp_path, monkeypatch) -> Settings:
    for key in [k for k in os.environ if k.startswith("FARM_")]:
        monkeypatch.delenv(key)
    # web_dist points nowhere so API tests never depend on a local web build.
    return Settings(data_dir=tmp_path / "data", web_dist=tmp_path / "web-dist")


@pytest.fixture
def db(settings) -> Iterator[Database]:
    database = Database(settings.database_path)
    try:
        database.create_all()
        yield database
    finally:
        database.dispose()


FAKEBIN = Path(__file__).parent / "fakebin"
FAKE_ENV = ("FAKE_ADB_DEVICES", "FAKE_ADB_STATE", "FAKE_ADB_BATTERY", "FAKE_ADB_INSTALL", "FAKE_MAESTRO_MODE")


@dataclass
class FakeBin:
    log: Path
    state_dir: Path

    def calls(self, tool: str) -> list[list[str]]:
        if not self.log.exists():
            return []
        entries = [json.loads(line) for line in self.log.read_text().splitlines()]
        return [entry["argv"] for entry in entries if entry["tool"] == tool]


@pytest.fixture
def fakebin(tmp_path, monkeypatch) -> FakeBin:
    for script in FAKEBIN.iterdir():
        script.chmod(0o755)
    monkeypatch.setenv("PATH", f"{FAKEBIN}{os.pathsep}{os.environ['PATH']}")
    log = tmp_path / "fake-calls.jsonl"
    state = tmp_path / "fake-state"
    state.mkdir()
    monkeypatch.setenv("FAKE_LOG", str(log))
    monkeypatch.setenv("FAKE_STATE_DIR", str(state))
    for key in FAKE_ENV:
        monkeypatch.delenv(key, raising=False)
    return FakeBin(log, state)
