import asyncio
import time

import pytest

from farm.devices.adb import Adb
from farm.runner.base import CancelToken, PrecheckFailed, TaskSpec
from farm.runner.maestro import MaestroRunner
from tests.factories import flow_yaml, write_flows


def _spec(tmp_path, *, flows=("login.yaml",), first=True, env=None, include=(), timeout=30) -> TaskSpec:
    flows_dir = write_flows(tmp_path / "flows", {"login.yaml": flow_yaml("smoke"), "pay.yaml": flow_yaml(),
                                                 "config.yaml": "flows:\n  - '*'\n"})
    return TaskSpec(task_id="t1", run_id="r1", serial="A1", attempt=1, apk_path=tmp_path / "app.apk",
                    package_name="com.example.app", flows_dir=flows_dir, flows=list(flows), include_tags=list(include),
                    exclude_tags=[], env=env or {}, timeout_sec=timeout, artifacts_dir=tmp_path / "art",
                    first_run_on_device=first)


def _runner() -> MaestroRunner:
    return MaestroRunner(Adb(), min_battery=20, term_grace=1)


async def test_passing_run(fakebin, tmp_path):
    spec = _spec(tmp_path, env={"B": "2", "A": "1"})
    outcome = await _runner().run(spec, CancelToken())
    assert outcome.status == "passed" and [c.name for c in outcome.cases] == ["login"]
    flows_dir, art = spec.flows_dir, spec.artifacts_dir
    assert fakebin.calls("maestro") == [[
        "--device", "A1", "test", f"{flows_dir}/login.yaml", "--config", f"{flows_dir}/config.yaml",
        "--format", "JUNIT", "--output", f"{art}/junit.xml", "--test-output-dir", f"{art}/maestro",
        "-e", "A=1", "-e", "B=2",
    ]]
    assert (art / "maestro.log").is_file() and (art / "logcat.txt").is_file()
    adb_calls = fakebin.calls("adb")
    assert ["-s", "A1", "install", "-r", "-d", "-g", str(spec.apk_path)] in adb_calls
    assert ["-s", "A1", "shell", "input", "keyevent", "KEYCODE_WAKEUP"] in adb_calls
    assert ["-s", "A1", "logcat", "-c"] in adb_calls


async def test_matrix_target_uses_dir_tags_and_reuses_driver(fakebin, tmp_path):
    spec = _spec(tmp_path, flows=(), first=False, include=("smoke",))
    outcome = await _runner().run(spec, CancelToken())
    argv = fakebin.calls("maestro")[0]
    assert argv[3] == str(spec.flows_dir) and "--config" not in argv
    assert argv[argv.index("--include-tags") + 1] == "smoke"
    assert argv[-1] == "--no-reinstall-driver"
    assert sorted(c.name for c in outcome.cases) == ["login", "pay"]


async def test_failing_flow(fakebin, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_MAESTRO_MODE", "fail")
    outcome = await _runner().run(_spec(tmp_path), CancelToken())
    assert (outcome.status, outcome.exit_code) == ("failed", 1)
    assert outcome.cases[0].failure_message == "Assertion is false: fake failure"


async def test_missing_junit_is_an_infra_error(fakebin, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_MAESTRO_MODE", "nojunit")
    outcome = await _runner().run(_spec(tmp_path), CancelToken())
    assert (outcome.status, outcome.error_code) == ("error", "no_junit")
    assert "driver failed to start" in outcome.error_message


async def test_maestro_not_connected_is_a_disconnect(fakebin, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_MAESTRO_MODE", "notconnected")
    spec = _spec(tmp_path)
    outcome = await _runner().run(spec, CancelToken())
    assert (outcome.status, outcome.error_code) == ("error", "device_disconnected")
    assert outcome.exit_code == 1
    assert "Device A1 was requested, but it is not connected." in outcome.error_message
    assert not (spec.artifacts_dir / "junit.xml").exists()


async def test_device_lost_during_run(fakebin, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_MAESTRO_MODE", "disconnect")
    outcome = await _runner().run(_spec(tmp_path), CancelToken())
    assert (outcome.status, outcome.error_code) == ("error", "device_disconnected")


async def test_timeout_kills_maestro(fakebin, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_MAESTRO_MODE", "hang")
    started = time.monotonic()
    outcome = await _runner().run(_spec(tmp_path, timeout=1), CancelToken())
    assert (outcome.status, outcome.error_code) == ("error", "timeout")
    assert time.monotonic() - started < 10


@pytest.mark.parametrize(("reason", "status", "code"), [("user", "cancelled", None),
                                                        ("disconnected", "error", "device_disconnected")])
async def test_cancellation(fakebin, tmp_path, monkeypatch, reason, status, code):
    monkeypatch.setenv("FAKE_MAESTRO_MODE", "hang")
    token = CancelToken()
    task = asyncio.create_task(_runner().run(_spec(tmp_path), token))
    await asyncio.sleep(1.0)
    token.cancel(reason)
    outcome = await asyncio.wait_for(task, 10)
    assert (outcome.status, outcome.error_code) == (status, code)


async def test_install_failure(fakebin, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_ADB_INSTALL", "fail")
    outcome = await _runner().run(_spec(tmp_path), CancelToken())
    assert (outcome.status, outcome.error_code) == ("error", "install_failed")
    assert "INSUFFICIENT_STORAGE" in outcome.error_message
    assert fakebin.calls("maestro") == []


async def test_signature_mismatch_reinstalls(fakebin, tmp_path, monkeypatch):
    monkeypatch.setenv("FAKE_ADB_INSTALL", "incompatible")
    outcome = await _runner().run(_spec(tmp_path), CancelToken())
    assert outcome.status == "passed"
    assert ["-s", "A1", "uninstall", "com.example.app"] in fakebin.calls("adb")


@pytest.mark.parametrize(("env", "value", "reason"), [("FAKE_ADB_BATTERY", "5", "battery 5% below 20%"),
                                                      ("FAKE_ADB_STATE", "unauthorized", "adb state is unauthorized")])
async def test_precheck_failures(fakebin, tmp_path, monkeypatch, env, value, reason):
    monkeypatch.setenv(env, value)
    assert await _runner().precheck("A1") == reason
    with pytest.raises(PrecheckFailed):
        await _runner().run(_spec(tmp_path), CancelToken())
