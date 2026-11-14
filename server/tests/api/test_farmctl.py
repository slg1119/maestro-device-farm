import io
import zipfile
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select

from farm.cli import farmctl
from farm.db.models import Run, Task
from tests.factories import add_device, flow_yaml, write_flows
from tests.fakes import fake_apk_bytes


@pytest.fixture
def project(tmp_path):
    flows = write_flows(tmp_path / ".maestro", {"a.yaml": flow_yaml("smoke"), "b.yaml": flow_yaml(),
                                                ".DS_Store": "junk"})
    apk = tmp_path / "app.apk"
    apk.write_bytes(fake_apk_bytes())
    return flows, apk


def _args(*argv: str):
    return farmctl.build_parser().parse_args(list(argv))


def test_build_options_from_flags(project):
    flows, _ = project
    args = _args("--token", "t", "run", "--flows", str(flows), "--app", "com.x@latest", "--mode", "matrix",
                 "--flow", "a.yaml", "--device-tags", "smoke, tablet", "--min-sdk", "29", "--include-tags", "smoke",
                 "-e", "A=1", "-e", "B=x=y", "--ci-branch", "main", "--timeout", "600")
    assert farmctl.build_options(args) == {
        "mode": "matrix", "device_selector": {"tags": ["smoke", "tablet"], "min_sdk": 29},
        "include_tags": ["smoke"], "exclude_tags": [], "env": {"A": "1", "B": "x=y"}, "ci_meta": {"branch": "main"},
        "origin": "ci", "flow_paths": ["a.yaml"], "app": "com.x@latest", "task_timeout_sec": 600,
    }


def test_workspace_options():
    args = _args("--token", "t", "run", "--workspace", "example-app", "--ref", "abc", "--app", "com.x@latest")
    options = farmctl.build_options(args)
    assert (options["flow_source"], options["workspace"], options["ref"]) == ("workspace", "example-app", "abc")
    no_ref = farmctl.build_options(_args("run", "--workspace", "example-app", "--app", "com.x@latest"))
    assert "ref" not in no_ref


def test_flows_and_workspace_are_exclusive():
    with pytest.raises(SystemExit):
        _args("run", "--flows", "x", "--workspace", "w", "--app", "a@latest")
    with pytest.raises(SystemExit):
        _args("run", "--app", "a@latest")


def test_ref_without_workspace_returns_2(client, token, project, capsys):
    flows, apk = project
    assert farmctl.dispatch(_args("--token", token, "run", "--flows", str(flows), "--apk", str(apk), "--ref", "x"),
                            client) == 2
    assert "--ref needs --workspace" in capsys.readouterr().err


def test_bad_env_flag_is_rejected():
    with pytest.raises(SystemExit):
        _args("run", "--flows", "x", "--apk", "y", "-e", "NOEQUALS")


def test_zip_dir_skips_hidden_files(project):
    flows, _ = project
    assert sorted(zipfile.ZipFile(io.BytesIO(farmctl.zip_dir(flows))).namelist()) == ["a.yaml", "b.yaml"]


def test_submit_without_wait(client, db, token, project, capsys):
    with db.session() as s:
        add_device(s, "d1")
    flows, apk = project
    assert farmctl.dispatch(_args("--token", token, "run", "--flows", str(flows), "--apk", str(apk)), client) == 0
    assert "submitted" in capsys.readouterr().out
    with db.session() as s:
        run = s.scalars(select(Run)).one()
        assert len(list(s.scalars(select(Task).where(Task.run_id == run.id)))) == 2


def test_submit_failure_returns_2(client, token, project, capsys):
    flows, apk = project  # no devices registered
    assert farmctl.dispatch(_args("--token", token, "run", "--flows", str(flows), "--apk", str(apk)), client) == 2
    assert "no_matching_devices" in capsys.readouterr().err


def test_submit_without_token_uses_user_name(client, db, project, monkeypatch):
    monkeypatch.delenv("FARM_TOKEN", raising=False)
    with db.session() as s:
        add_device(s, "d1")
    flows, apk = project
    assert farmctl.dispatch(_args("--user", "Deployment Bot", "run", "--flows", str(flows), "--apk", str(apk)), client) == 0
    with db.session() as s:
        assert s.scalars(select(Run)).one().created_by == "Deployment Bot"


def test_missing_token_is_rejected_when_the_farm_requires_one(secured_client, project, monkeypatch, capsys):
    monkeypatch.delenv("FARM_TOKEN", raising=False)
    flows, apk = project
    assert farmctl.dispatch(_args("run", "--flows", str(flows), "--apk", str(apk)), secured_client) == 2
    assert "unauthorized" in capsys.readouterr().err


def test_apps_upload(client, token, project, capsys):
    _, apk = project
    assert farmctl.dispatch(_args("--token", token, "apps", "upload", str(apk)), client) == 0
    assert "com.example.app" in capsys.readouterr().out


def test_sse_parser():
    parser = farmctl.SseParser()
    lines = [": connected", "", "id: 7", "event: run.updated", 'data: {"payload": {"status": "passed"}}', "",
             ": ping", ""]
    events = [event for event in (parser.feed(line) for line in lines) if event]
    assert events == [("7", "run.updated", '{"payload": {"status": "passed"}}')]


def test_wait_for_run_uses_current_stdout(capsys):
    def handle_request(request):
        if request.url.path == "/api/v1/runs/run-1":
            return httpx.Response(200, json={"status": "running"})
        assert request.url.path == "/api/v1/events"
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, text=(
            'id: 1\nevent: task.updated\n'
            'data: {"payload": {"id": "task-1", "status": "passed", "device_serial": "fake-1", "attempt": 1}}\n\n'
            'id: 2\nevent: run.updated\n'
            'data: {"payload": {"status": "passed"}}\n\n'
        ))

    with httpx.Client(transport=httpx.MockTransport(handle_request), base_url="http://farm") as client:
        assert farmctl.wait_for_run(client, "run-1", 10) == "passed"
    assert capsys.readouterr().out == "  task task-1 passed on fake-1 attempt 1\n  run passed\n"


def test_exit_codes():
    assert [farmctl.STATUS_EXIT[s] for s in ("passed", "failed", "error", "cancelled")] == [0, 1, 2, 3]


def test_farmctl_depends_only_on_stdlib_and_httpx():
    source = Path(farmctl.__file__).read_text()
    assert "from farm" not in source and "import farm" not in source
