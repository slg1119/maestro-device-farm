import pytest

from farm.cli.farm import main


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
    monkeypatch.setenv("FARM_DATA_DIR", str(tmp_path / "empty"))
    assert main(["agent"]) == 2
    assert "farm db upgrade" in capsys.readouterr().err
