import base64
import os

import httpx
import pytest

from farm.db import migrate
from farm.db.engine import Database
from farm.db.models import AgentStatus, Device, Workspace
from farm.ops.doctor import run_doctor
from farm.timeutil import now, shift


@pytest.fixture
def db(settings):
    database = Database(settings.database_path)
    try:
        yield database
    finally:
        database.dispose()


@pytest.fixture
def tools(tmp_path, monkeypatch):
    folder = tmp_path / "fakebin"
    folder.mkdir()
    for name in ("adb", "maestro", "java", "git", "codex"):
        script = folder / name
        script.write_text(f"#!{os.sys.executable}\nimport os, sys\n"
                          f"tool = {name!r}\n"
                          "if tool == os.environ.get('BROKEN_TOOL'): sys.exit(1)\n"
                          "if tool == 'git' and 'ls-remote' in sys.argv:\n"
                          "    assert os.environ.get('GIT_TERMINAL_PROMPT') == '0'\n"
                          "    assert 'GIT_CONFIG_VALUE_0' in os.environ\n"
                          "    print('a' * 40 + '\\trefs/heads/main')\n"
                          "else: print(tool + ' version 1.0', file=sys.stderr if tool == 'java' else sys.stdout)\n")
        script.chmod(0o755)
    monkeypatch.setenv("PATH", str(folder))
    return folder


def ready(db, settings):
    migrate.upgrade(settings.database_path)
    with db.session() as s:
        s.add(Device(serial="fake-device", state="idle"))
        s.add(AgentStatus(id="test-agent", version="1", started_at=now(), last_heartbeat_at=now()))
        s.add(Workspace(name="test-workspace", repo="owner/repo", branch="main"))


def test_doctor_checks_versions_db_workspace_ai_heartbeat_disk_without_secrets(db, settings, tools, monkeypatch):
    # A2 may already have supplied a real jar when this test runs after integration.
    settings = settings.model_copy(update={"scrcpy_server_path": tools / "missing-scrcpy.jar"})
    ready(db, settings)
    token, api_key = "test-token-private", "test-openai-private"
    from pydantic import SecretStr
    settings.github_token = SecretStr(token)
    settings.openai_api_key = SecretStr(api_key)
    requests = []

    def github(request):
        requests.append(request)
        return httpx.Response(200, json={"login": "bot", "untrusted": token})

    checks = run_doctor(db, settings, github_transport=httpx.MockTransport(github))
    output = "\n".join(str(check) for check in checks)
    assert all(word in output for word in ("adb", "maestro", "java", "git", "DB", "scrcpy", "GitHub",
                                           "test-workspace", "AI", "fake-device", "test-agent", "disk"))
    assert any(check.status == "WARN" and "scrcpy" in str(check) for check in checks)
    assert not any(check.status == "FAIL" for check in checks)
    assert len(requests) == 1 and requests[0].url == "https://api.github.com/user"
    assert requests[0].headers["Authorization"] == f"Bearer {token}"
    assert token not in output and api_key not in output
    assert base64.b64encode(f"x-access-token:{token}".encode()).decode() not in output


def test_doctor_warns_for_stale_agent_offline_device_and_no_codex(db, settings, tools, monkeypatch):
    ready(db, settings)
    (tools / "codex").unlink()
    with db.session() as s:
        s.get(AgentStatus, "test-agent").last_heartbeat_at = shift(now(), -120)
        s.get(Device, "fake-device").state = "offline"
        s.query(Workspace).delete()
    checks = run_doctor(db, settings)
    assert any(c.status == "WARN" and "AI" in str(c) for c in checks)
    assert any(c.status == "WARN" and "test-agent" in str(c) for c in checks)
    assert any(c.status == "WARN" and "fake-device" in str(c) for c in checks)


def test_doctor_fails_for_missing_binary_unmigrated_db_and_invalid_github(db, settings, tools, monkeypatch):
    from pydantic import SecretStr
    settings.github_token = SecretStr("invalid-secret")
    (tools / "adb").unlink()
    checks = run_doctor(db, settings, github_transport=httpx.MockTransport(
        lambda request: httpx.Response(401, text="invalid-secret")))
    assert any(c.status == "FAIL" and "adb" in str(c) for c in checks)
    assert any(c.status == "FAIL" and "DB" in str(c) for c in checks)
    assert any(c.status == "FAIL" and "GitHub" in str(c) for c in checks)
    assert "invalid-secret" not in "\n".join(map(str, checks))


@pytest.mark.parametrize("broken,expected", [(None, 0), ("java", 1)])
def test_doctor_cli_exit_codes(db, settings, tools, monkeypatch, capsys, broken, expected):
    from farm.cli.farm import main
    ready(db, settings)
    with db.session() as s:
        s.query(Workspace).delete()
    monkeypatch.setenv("FARM_DATA_DIR", str(settings.data_dir))
    if broken:
        monkeypatch.setenv("BROKEN_TOOL", broken)
    assert main(["doctor"]) == expected
    output = capsys.readouterr().out
    assert "OK" in output and "WARN" in output
    assert ("FAIL" in output) == (expected == 1)


def test_ai_builder_is_used_and_closed_and_no_token_skips_github(db, settings, tools, monkeypatch):
    from farm.ai import client
    ready(db, settings)
    with db.session() as s:
        s.query(Workspace).delete()
    closed = []

    class Codex:
        provider = "codex"

        def close(self):
            closed.append(True)

    monkeypatch.setattr(client, "build_ai_client", lambda value: Codex(), raising=False)

    def unexpected_network(request):
        pytest.fail("GitHub must not be contacted without a token")

    checks = run_doctor(db, settings, github_transport=httpx.MockTransport(unexpected_network))
    assert any(c.name == "AI" and c.status == "OK" and "codex" in c.hint for c in checks)
    assert closed == [True]


def test_doctor_reports_git_failure_low_disk_and_provider_failure(db, settings, tools, monkeypatch):
    from farm.ai import client
    from farm.ops import doctor
    ready(db, settings)
    monkeypatch.setenv("BROKEN_TOOL", "git")
    usage = doctor.shutil.disk_usage(settings.data_dir)
    monkeypatch.setattr(doctor.shutil, "disk_usage", lambda path: usage._replace(free=10))

    def broken_provider(value):
        raise RuntimeError("private-provider-error")

    monkeypatch.setattr(client, "build_ai_client", broken_provider, raising=False)
    checks = run_doctor(db, settings)
    assert any(c.status == "FAIL" and "workspace" in c.name for c in checks)
    assert any(c.status == "WARN" and c.name == "disk" for c in checks)
    assert any(c.status == "WARN" and c.name == "AI" for c in checks)
    assert "private-provider-error" not in "\n".join(map(str, checks))


def test_doctor_reports_token_network_failure_without_leaking_error(db, settings, tools):
    from pydantic import SecretStr
    ready(db, settings)
    settings.github_token = SecretStr("private-token")

    def timeout(request):
        raise httpx.ConnectError("private-token", request=request)

    checks = run_doctor(db, settings, github_transport=httpx.MockTransport(timeout))
    assert any(c.status == "FAIL" and "GitHub" in c.name for c in checks)
    assert "private-token" not in "\n".join(map(str, checks))


def test_doctor_cli_reports_uncreatable_data_directory(settings, tmp_path, monkeypatch, capsys):
    from farm.cli.farm import main
    blocker = tmp_path / "file"
    blocker.write_text("not a directory")
    monkeypatch.setenv("FARM_DATA_DIR", str(blocker / "data"))
    assert main(["doctor"]) == 1
    assert "FAIL DB" in capsys.readouterr().out
