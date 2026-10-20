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
