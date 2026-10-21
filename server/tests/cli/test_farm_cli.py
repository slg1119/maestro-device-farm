import pytest

from farm.cli.farm import main
from farm.db.engine import Database
from tests.gitfixtures import SAMPLE_FILES, make_origin


@pytest.fixture(autouse=True)
def close_cli_databases(monkeypatch):
    databases = []

    def tracked_database(*args, **kwargs):
        database = Database(*args, **kwargs)
        databases.append(database)
        return database

    monkeypatch.setattr("farm.cli.farm.Database", tracked_database)
    yield
    for database in databases:
        database.dispose()


@pytest.fixture
def cli_env(tmp_path, monkeypatch):
    monkeypatch.setenv("FARM_DATA_DIR", str(tmp_path / "data"))
    assert main(["db", "upgrade"]) == 0


def test_token_lifecycle(cli_env, capsys):
    capsys.readouterr()
    assert main(["token", "create", "ci"]) == 0
    token = capsys.readouterr().out.strip()
    assert token.startswith("farm_")

    assert main(["token", "create", "ci"]) == 1
    assert "already exists" in capsys.readouterr().err

    assert main(["token", "list"]) == 0
    assert "ci" in capsys.readouterr().out

    assert main(["token", "revoke", "ci"]) == 0
    assert main(["token", "revoke", "ci"]) == 1


from farm.cli.farm import build_agent
from farm.devices.adb import AndroidAdbProvider
from farm.runner.fake import FakeRunner
from farm.runner.inspect import AdbInspector
from farm.runner.maestro import MaestroRunner


def test_build_agent_uses_real_components(settings):
    agent = build_agent(settings)
    assert isinstance(agent.provider, AndroidAdbProvider)
    assert isinstance(agent.runner, MaestroRunner) and agent.runner.min_battery == settings.min_battery
    assert isinstance(agent.inspector, AdbInspector)


def test_build_agent_with_fake_devices(settings):
    agent = build_agent(settings, fake_devices=3)
    assert isinstance(agent.runner, FakeRunner)
    assert [info.serial for info in agent.provider.infos] == ["fake-1", "fake-2", "fake-3"]


def test_agent_refuses_to_start_without_schema(tmp_path, monkeypatch, capsys):
    from farm.cli import farm
    elapsed = [0]
    monkeypatch.setattr(farm, "monotonic", lambda: elapsed[0])
    monkeypatch.setattr(farm, "sleep", lambda delay: elapsed.__setitem__(0, elapsed[0] + delay))
    monkeypatch.setenv("FARM_DATA_DIR", str(tmp_path / "empty"))
    assert main(["agent"]) == 2
    assert "farm db upgrade" in capsys.readouterr().err


def test_workspace_commands(cli_env, tmp_path, monkeypatch, capsys):
    remotes = tmp_path / "remotes"
    origin = make_origin(remotes, "acme/app", SAMPLE_FILES)
    monkeypatch.setenv("FARM_GIT_REMOTE_TEMPLATE", f"file://{remotes}/{{repo}}.git")
    capsys.readouterr()
    assert main(["workspace", "add", "--name", "app", "--repo", "acme/app", "--path", ".maestro"]) == 0
    assert f"workspace app added at {origin.head()[:7]}" in capsys.readouterr().out
    assert main(["workspace", "add", "--name", "app", "--repo", "acme/app"]) == 1
    assert "workspace_exists" in capsys.readouterr().err
    assert main(["workspace", "list"]) == 0
    assert f"app\tacme/app@main:.maestro\t{origin.head()[:7]}\tsynced" in capsys.readouterr().out
    assert main(["workspace", "remove", "app"]) == 0
    assert main(["workspace", "remove", "app"]) == 1


def test_agent_waits_for_api_migrations_before_recovery(settings, monkeypatch, caplog):
    from alembic import command
    from sqlalchemy import inspect

    from farm.cli import farm
    from farm.db import migrate

    settings.data_dir.mkdir(parents=True)
    command.upgrade(migrate.alembic_config(settings.database_path), "0004")
    monkeypatch.setenv("FARM_DATA_DIR", str(settings.data_dir))
    waits, starts = [], []

    def api_upgrade(delay):
        waits.append(delay)
        assert starts == []
        migrate.upgrade(settings.database_path)

    async def run_agent(agent):
        assert "interfered" in {c["name"] for c in inspect(agent.db.engine).get_columns("tasks")}
        await agent.start()
        starts.append(True)

    monkeypatch.setattr(farm, "sleep", api_upgrade, raising=False)
    monkeypatch.setattr(farm, "_run_agent", run_agent)
    with caplog.at_level("INFO"):
        assert main(["agent", "--fake", "1"]) == 0
    assert waits == [2] and starts == [True]
    assert caplog.text.count("waiting for database migrations (current 0004, head 0005)") == 1


def test_agent_times_out_at_120_seconds_without_migrating(settings, monkeypatch, caplog, capsys):
    from alembic import command
    from sqlalchemy import inspect, text

    from farm.cli import farm
    from farm.db import migrate

    settings.data_dir.mkdir(parents=True)
    command.upgrade(migrate.alembic_config(settings.database_path), "0004")
    monkeypatch.setenv("FARM_DATA_DIR", str(settings.data_dir))
    elapsed, waits = [0], []

    def advance(delay):
        elapsed[0] += delay
        waits.append(delay)

    monkeypatch.setattr(farm, "monotonic", lambda: elapsed[0], raising=False)
    monkeypatch.setattr(farm, "sleep", advance, raising=False)
    monkeypatch.setattr(farm, "build_agent", lambda *a, **k: pytest.fail("agent started before migrations"))
    with caplog.at_level("INFO"):
        assert main(["agent"]) == 2
    assert waits == [2] * 60 and elapsed == [120]
    assert caplog.text.count("waiting for database migrations (current 0004, head 0005)") == 1
    assert "120" in capsys.readouterr().err
    database = Database(settings.database_path)
    try:
        with database.engine.connect() as conn:
            assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0004"
        assert "interfered" not in {c["name"] for c in inspect(database.engine).get_columns("tasks")}
    finally:
        database.dispose()
