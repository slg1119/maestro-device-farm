import asyncio
import socket
import threading
import time
import xml.etree.ElementTree as ET
from types import SimpleNamespace

import pytest
import uvicorn
from sqlalchemy import func, select

from farm.agent.main import Agent
from farm.api.app import create_app
from farm.auth import create_token
from farm.cli import farmctl
from farm.db.models import Device
from farm.devices.fake import FakeProvider
from farm.devices.provider import DeviceInfo
from farm.runner.fake import FakeInspector, FakeRunner
from tests.factories import flow_yaml, write_flows
from tests.fakes import FakeApkParser, fake_apk_bytes


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _wait(predicate, timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise RuntimeError("timed out")
        time.sleep(0.05)


@pytest.fixture
def live_farm(settings, db):
    with db.session() as s:
        token = create_token(s, "e2e")
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(create_app(settings, db=db, apk_parser=FakeApkParser()),
                                           host="127.0.0.1", port=port, log_level="warning"))
    server_thread = threading.Thread(target=server.run, daemon=True)
    server_thread.start()
    _wait(lambda: server.started)

    runner = FakeRunner(delay=0.2)
    provider = FakeProvider([DeviceInfo(f"fake-{i}", "device", model="Fake Pixel", manufacturer="Fake",
                                        os_version="14", sdk_int=34, battery=100) for i in (1, 2)])
    agent = Agent(settings, db, provider, runner, FakeInspector(), agent_id="e2e-agent", poll_sec=0.2,
                  sweep_sec=1.0, heartbeat_sec=0.5, unhealthy_recheck_sec=1.0, worker_idle_sleep=0.05,
                  cancel_poll_sec=0.1)
    loop = asyncio.new_event_loop()
    agent_thread = threading.Thread(target=loop.run_until_complete, args=(agent.run(),), daemon=True)
    agent_thread.start()

    def two_devices_available() -> bool:
        with db.session() as s:
            return s.scalar(select(func.count()).select_from(Device).where(Device.state == "available")) == 2

    _wait(two_devices_available)
    yield SimpleNamespace(url=f"http://127.0.0.1:{port}", token=token, runner=runner)
    loop.call_soon_threadsafe(agent.request_stop)
    agent_thread.join(10)
    loop.close()
    server.should_exit = True
    server_thread.join(10)


@pytest.fixture
def project(tmp_path):
    flows = write_flows(tmp_path / ".maestro", {"login.yaml": flow_yaml("smoke"), "search.yaml": flow_yaml("smoke"),
                                                "checkout.yaml": flow_yaml()})
    apk = tmp_path / "app.apk"
    apk.write_bytes(fake_apk_bytes())
    return flows, apk


def _farmctl(farm, *argv: str) -> int:
    return farmctl.main(["--server", farm.url, "--token", farm.token, *argv])


def test_split_run_end_to_end(live_farm, project, tmp_path, capsys):
    flows, apk = project
    junit = tmp_path / "out" / "junit.xml"
    code = _farmctl(live_farm, "run", "--flows", str(flows), "--apk", str(apk), "--mode", "split", "--wait",
                    "--wait-timeout", "60", "--junit", str(junit))
    assert code == 0
    root = ET.parse(junit).getroot()
    assert (root.get("tests"), root.get("failures")) == ("3", "0")
    out = capsys.readouterr().out
    assert "finished: passed" in out and "  task " in out


def test_failed_flow_exits_1(live_farm, project):
    live_farm.runner.fail_flows = {"checkout"}
    flows, apk = project
    assert _farmctl(live_farm, "run", "--flows", str(flows), "--apk", str(apk), "--wait", "--wait-timeout", "60") == 1


def test_matrix_runs_on_every_device(live_farm, project, tmp_path):
    flows, apk = project
    junit = tmp_path / "matrix.xml"
    assert _farmctl(live_farm, "run", "--flows", str(flows), "--apk", str(apk), "--mode", "matrix",
                    "--include-tags", "smoke", "--wait", "--wait-timeout", "60", "--junit", str(junit)) == 0
    suites = ET.parse(junit).getroot().findall("testsuite")
    assert sorted(s.get("name") for s in suites) == ["Fake Pixel (fake-1)", "Fake Pixel (fake-2)"]
    assert {s.get("tests") for s in suites} == {"2"}


def test_wait_timeout_exits_3(live_farm, project):
    live_farm.runner.delay = 30
    flows, apk = project
    assert _farmctl(live_farm, "run", "--flows", str(flows), "--apk", str(apk), "--flow", "login.yaml", "--wait",
                    "--wait-timeout", "1") == 3
