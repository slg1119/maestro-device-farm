import json
from pathlib import Path
from types import SimpleNamespace
from xml.sax.saxutils import escape

import pytest
from sqlalchemy import select

from farm.agent.worker import DeviceWorker
from farm.ai.context import failure_context
from farm.db.models import Run, Task
from farm.devices.adb import Adb
from farm.results import TaskOutcome
from farm.runner.base import CancelToken, TaskSpec
from farm.runner.junit import parse_junit
from farm.runner.maestro import MaestroRunner
from farm.runner.procs import ProcResult
from tests.factories import add_app, add_device, flow_yaml, submit, write_flows

SECRET = "fixture-login-password"
TEXT_PATHS = (
    "maestro.log", "logcat.txt", "junit.xml", "extra.out",
    "maestro/session/login/commands.json", "maestro/session/other/commands.json",
    "maestro/session/logs/maestro.log", "maestro/session/logs/trace.txt",
)
BINARY_PATHS = {
    "screen.png": b"\x89PNG\r\n\x1a\n" + SECRET.encode(),
    "video.mp4": b"\x00\x00ftyp" + SECRET.encode(),
    "utf8-fixture.png": b"fake-png " + SECRET.encode(),
    "unknown.bin": b"\xff\xfe" + SECRET.encode(),
}


def write_attempt(root, secret=SECRET, *, ensure_ascii=True):
    for relative in TEXT_PATHS:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.name == "commands.json":
            text = json.dumps([{
                "command": {"inputTextCommand": {"text": "${APP_PASSWORD}"}},
                "metadata": {"status": "FAILED", "evaluatedCommand": {
                    "inputTextCommand": {"text": secret}}},
            }], ensure_ascii=ensure_ascii)
        elif path.name == "junit.xml":
            text = ('<testsuites><testsuite><testcase name="login">'
                    f'<failure>password={escape(secret)}</failure></testcase></testsuite></testsuites>')
        else:
            text = f"password={secret}; short=123; boundary=four\r\n"
        path.write_bytes(text.encode())
    for relative, content in BINARY_PATHS.items():
        (root / relative).write_bytes(content)


@pytest.fixture
def env_task(db, tmp_path):
    flows = write_flows(tmp_path / "flows", {"login.yaml": flow_yaml()})
    with db.session() as s:
        add_device(s, "d1")
        run = submit(s, app=add_app(s), flows_dir=flows,
                     env={"APP_PASSWORD": SECRET, "PREFIX": "fixture-login", "SHORT": "123",
                          "BOUNDARY": "four", "EMPTY": ""})
    return run


@pytest.mark.parametrize("status", ["passed", "failed", "error", "cancelled", "crashed", "shutdown"])
async def test_worker_redacts_all_attempt_text_before_finishing(db, settings, env_task, status):
    class ArtifactRunner:
        async def run(self, spec, cancel):
            self.spec = spec
            write_attempt(spec.artifacts_dir)
            outside = spec.artifacts_dir.parent / "outside.txt"
            outside.write_text(SECRET)
            (spec.artifacts_dir / "linked.txt").symlink_to(outside)
            if status == "crashed":
                raise RuntimeError("fake runner crash")
            if status == "shutdown":
                cancel.cancel("shutdown")
                return TaskOutcome("cancelled")
            return TaskOutcome(status)

    runner = ArtifactRunner()
    worker = DeviceWorker("d1", db, settings, runner)
    assert await worker.step()
    root = runner.spec.artifacts_dir
    for relative in TEXT_PATHS:
        text = (root / relative).read_text()
        assert SECRET not in text, relative
        assert "***" in text, relative
    assert (root / "extra.out").read_bytes() == b"password=***; short=123; boundary=***\r\n"
    for relative, content in BINARY_PATHS.items():
        assert (root / relative).read_bytes() == content
    assert (root.parent / "outside.txt").read_text() == SECRET


async def test_maestro_redacts_junit_before_classifying(fakebin, tmp_path, monkeypatch):
    root = tmp_path / "attempt-1"
    spec = TaskSpec(task_id="task", run_id="run", serial="d1", attempt=1, apk_path=tmp_path / "app.apk",
                    package_name="com.example.app", flows_dir=tmp_path, flows=["login.yaml"],
                    include_tags=[], exclude_tags=[], env={"APP_PASSWORD": SECRET}, timeout_sec=10,
                    artifacts_dir=root, first_run_on_device=True)

    async def fake_maestro(*args, **kwargs):
        write_attempt(root)
        return ProcResult(1)

    monkeypatch.setattr("farm.runner.maestro.run_process", fake_maestro)
    outcome = await MaestroRunner(Adb(), min_battery=20).run(spec, CancelToken())
    assert outcome.status == "failed"
    assert outcome.cases[0].failure_message == "password=***"
    for relative in TEXT_PATHS:
        assert SECRET not in (root / relative).read_text()
    for relative, content in BINARY_PATHS.items():
        assert (root / relative).read_bytes() == content


@pytest.fixture
def legacy_task(db, env_task, tmp_path):
    root = tmp_path / "legacy-attempt"
    write_attempt(root)
    with db.session() as s:
        task = s.scalar(select(Task).where(Task.run_id == env_task.id))
        task.artifacts_dir = str(root)
    return task


@pytest.mark.parametrize("relative", TEXT_PATHS)
def test_legacy_text_downloads_are_redacted_without_rewriting(client, legacy_task, relative):
    path = Path(legacy_task.artifacts_dir) / relative
    original, modified = path.read_bytes(), path.stat().st_mtime_ns
    response = client.get(f"/api/v1/tasks/{legacy_task.id}/artifacts/{relative}")
    assert response.status_code == 200
    assert SECRET not in response.text
    assert "***" in response.text
    if relative == "extra.out":
        assert response.content == b"password=***; short=123; boundary=***\r\n"
    assert (path.read_bytes(), path.stat().st_mtime_ns) == (original, modified)


@pytest.mark.parametrize("relative", BINARY_PATHS)
def test_legacy_binary_downloads_are_byte_identical(client, legacy_task, relative):
    response = client.get(f"/api/v1/tasks/{legacy_task.id}/artifacts/{relative}")
    assert response.status_code == 200
    assert response.content == BINARY_PATHS[relative]


def test_legacy_steps_hide_resolved_env_without_rewriting(client, legacy_task):
    commands = Path(legacy_task.artifacts_dir) / "maestro/session/login/commands.json"
    original = commands.read_bytes()
    response = client.get(f"/api/v1/tasks/{legacy_task.id}/steps")
    assert response.status_code == 200
    assert SECRET not in response.text
    assert response.json()["flows"][0]["steps"][0]["label"] == "inputText ***"
    assert commands.read_bytes() == original


def test_ai_failure_parsers_only_receive_redacted_legacy_commands(settings, db, legacy_task, monkeypatch):
    original_loads = json.loads

    def read_redacted(text):
        assert SECRET not in text
        return original_loads(text)

    # Observe the JSON parsing boundary without changing the on-disk legacy evidence.
    monkeypatch.setattr("farm.runner.steps.json", SimpleNamespace(loads=read_redacted, dumps=json.dumps))
    root = Path(legacy_task.artifacts_dir)
    original = {relative: (root / relative).read_bytes() for relative in TEXT_PATHS}
    context, _ = failure_context(settings, legacy_task, db=db)
    assert SECRET not in context
    assert "maestro.log" in context
    assert all((root / relative).read_bytes() == content for relative, content in original.items())


@pytest.mark.parametrize("ensure_ascii", [True, False])
async def test_worker_redacts_escaped_values_and_keeps_json_xml_valid(db, settings, env_task, ensure_ascii):
    secret = 'secret🔑"\\password\n&<value>'
    with db.session() as s:
        s.get(Run, env_task.id).env = {"APP_PASSWORD": secret}

    class EscapedRunner:
        async def run(self, spec, cancel):
            self.spec = spec
            write_attempt(spec.artifacts_dir, secret, ensure_ascii=ensure_ascii)
            return TaskOutcome("failed")

    runner = EscapedRunner()
    assert await DeviceWorker("d1", db, settings, runner).step()
    root = runner.spec.artifacts_dir
    command = json.loads((root / "maestro/session/login/commands.json").read_text())[0]
    assert command["metadata"]["evaluatedCommand"]["inputTextCommand"]["text"] == "***"
    assert parse_junit(root / "junit.xml")[0].failure_message == "password=***"


@pytest.mark.parametrize("ensure_ascii", [True, False])
def test_legacy_reads_redact_escaped_values(client, db, legacy_task, ensure_ascii):
    secret = 'secret🔑"\\password\n&<value>'
    with db.session() as s:
        s.get(Run, legacy_task.run_id).env = {"APP_PASSWORD": secret}
    root = Path(legacy_task.artifacts_dir)
    write_attempt(root, secret, ensure_ascii=ensure_ascii)
    response = client.get(f"/api/v1/tasks/{legacy_task.id}/steps")
    assert response.json()["flows"][0]["steps"][0]["label"] == "inputText ***"
    response = client.get(f"/api/v1/tasks/{legacy_task.id}/artifacts/junit.xml")
    assert response.status_code == 200
    assert "password=***" in response.text
